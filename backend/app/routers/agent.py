"""Agent Mode narration (optional, cosmetic only): a vision LLM describes
what's on screen and a judge LLM guesses which region a persona would look
at, purely to produce HUD flavor text + an audit-trail "reason" string.

This endpoint does NOT drive the agent's actual movement or the gaze
coordinates that get logged as zone_dwell/product_interaction events - that
is 100% deterministic, persona-driven logic in
frontend/src/components/Agent/personaNavigation.ts (see
AgentSimulationController.tsx and useAgentSimulation.ts for how the two are
kept separate). If this endpoint times out, errors, or returns a malformed/
out-of-range index, the caller (useAgentSimulation.ts) just drops the
narration for that tick and the simulation continues identically - nothing
here can corrupt movement, analytics, or purchase decisions.
"""
import base64
import binascii
import io
import json
import re

from azure.ai.inference.models import (
    ImageContentItem,
    ImageUrl,
    SystemMessage,
    TextContentItem,
    UserMessage,
)
from fastapi import APIRouter, HTTPException
from PIL import Image

from ..llm_gateway import LLMGatewayError, get_client, get_settings, run_with_timeout
from ..schemas import AgentFocus, AgentGazeRequest, AgentGazeResponse, AgentGridCell

router = APIRouter(prefix="/api/agent", tags=["agent"])

MAX_IMAGE_DIMENSION = 1280

VISION_SYSTEM_PROMPT = (
    "You are Luna, a precise visual description assistant analyzing cropped sections of a single wide "
    "shot inside a convenience store. For each numbered image you are given, in the exact order given, "
    "respond with one short factual sentence describing what is visible (shelving, products, signage, "
    "aisles, empty space, etc). Respond ONLY with a JSON array like "
    '[{"index": 0, "description": "..."}, ...] with exactly one object per image, in the same order and '
    "using the index values provided in the prompt."
)

JUDGE_SYSTEM_PROMPT = (
    "You are an impartial behavioral judge. Given a shopper persona and short descriptions of numbered "
    "regions of their current field of view inside a convenience store, decide which single region they "
    "would most likely focus their gaze on right now. Respond ONLY with compact JSON: "
    '{"index": <int>, "reason": "<short reason>"}. The index MUST exactly match one of the provided indices.'
)


def _decode_image(data_url: str) -> Image.Image:
    payload = data_url.split(",", 1)[-1] if data_url.strip().startswith("data:") else data_url
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid image data") from exc
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not decode image") from exc

    image = image.convert("RGB")
    if image.width > MAX_IMAGE_DIMENSION or image.height > MAX_IMAGE_DIMENSION:
        image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION))
    return image


def _encode_image(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _slice_grid(image: Image.Image, rows: int, cols: int) -> list[dict]:
    width, height = image.size
    xs = [round(c * width / cols) for c in range(cols + 1)]
    ys = [round(r * height / rows) for r in range(rows + 1)]

    cells: list[dict] = []
    index = 0
    for row in range(rows):
        for col in range(cols):
            box = (xs[col], ys[row], xs[col + 1], ys[row + 1])
            cells.append({"index": index, "row": row, "col": col, "image": image.crop(box)})
            index += 1
    return cells


def _extract_json_array(text: str) -> list:
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _extract_json_object(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _describe_subimages(cells: list[dict]) -> dict[int, str]:
    settings = get_settings()
    content: list = [
        TextContentItem(
            text="Describe each of the following store sub-images. Image order and indices: "
            + ", ".join(str(cell["index"]) for cell in cells)
        )
    ]
    for cell in cells:
        content.append(ImageContentItem(image_url=ImageUrl(url=_encode_image(cell["image"]))))

    response = run_with_timeout(
        lambda: get_client().complete(
            messages=[SystemMessage(content=VISION_SYSTEM_PROMPT), UserMessage(content=content)],
            model=settings.model,
            headers={"Authorization": settings.api_key},
        )
    )
    raw = response.choices[0].message.content or ""

    descriptions: dict[int, str] = {}
    for item in _extract_json_array(raw):
        try:
            descriptions[int(item["index"])] = str(item["description"])
        except (KeyError, TypeError, ValueError):
            continue
    return descriptions


def _judge_focus(
    persona_description: str,
    shopper_name: str,
    shopper_age: int,
    cells: list[AgentGridCell],
) -> tuple[int, str]:
    settings = get_settings()
    lines = [
        f"Shopper: {shopper_name}, age {shopper_age}",
        f"Persona: {persona_description}",
        "",
        "Regions currently in view:",
    ]
    for cell in cells:
        lines.append(f"[{cell.index}] row {cell.row}, col {cell.col}: {cell.description or '(no description)'}")

    response = run_with_timeout(
        lambda: get_client().complete(
            messages=[
                SystemMessage(content=JUDGE_SYSTEM_PROMPT),
                UserMessage(content="\n".join(lines)),
            ],
            model=settings.model,
            headers={"Authorization": settings.api_key},
        )
    )
    raw = response.choices[0].message.content or ""

    parsed = _extract_json_object(raw)
    index = parsed.get("index")
    reason = str(parsed.get("reason", "")).strip()

    valid_indices = {cell.index for cell in cells}
    if not isinstance(index, int) or index not in valid_indices:
        fallback = cells[len(cells) // 2] if cells else None
        index = fallback.index if fallback else 0
        reason = reason or "Fallback: judge response was invalid, defaulted to a central region."
    return index, reason


@router.post("/gaze", response_model=AgentGazeResponse)
def agent_gaze(request: AgentGazeRequest) -> AgentGazeResponse:
    image = _decode_image(request.image_base64)
    raw_cells = _slice_grid(image, request.grid_rows, request.grid_cols)

    try:
        descriptions = _describe_subimages(raw_cells)
    except LLMGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    cells = [
        AgentGridCell(
            index=cell["index"],
            row=cell["row"],
            col=cell["col"],
            description=descriptions.get(cell["index"], ""),
        )
        for cell in raw_cells
    ]

    try:
        focus_index, reason = _judge_focus(
            request.persona_description, request.shopper_name, request.shopper_age, cells
        )
    except LLMGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    focus_cell = next((cell for cell in cells if cell.index == focus_index), cells[0])
    return AgentGazeResponse(
        cells=cells,
        focus=AgentFocus(index=focus_cell.index, row=focus_cell.row, col=focus_cell.col, reason=reason),
    )

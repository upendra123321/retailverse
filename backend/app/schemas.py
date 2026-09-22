"""Pydantic schemas shared across routers."""
from typing import Any, List, Literal, Optional
from pydantic import BaseModel, Field, model_validator


class CalibrationCoefficients(BaseModel):
    """Least-squares polynomial regression coefficients mapping
    normalized iris features -> screen coordinates.
    """

    x: List[float] = Field(..., description="Coefficients predicting screen X")
    y: List[float] = Field(..., description="Coefficients predicting screen Y")


class CalibrationProfile(BaseModel):
    profile_id: str = Field(..., min_length=1, max_length=64)
    coefficients: CalibrationCoefficients
    sample_count: int = Field(..., ge=0)
    screen_width: int = Field(..., gt=0)
    screen_height: int = Field(..., gt=0)


class CalibrationSaveResponse(BaseModel):
    status: str
    profile: CalibrationProfile


MAX_GRID_DIMENSION = 12
MAX_GRID_CELLS = 100


class AgentGridCell(BaseModel):
    index: int = Field(..., ge=0)
    row: int = Field(..., ge=0)
    col: int = Field(..., ge=0)
    description: str = ""


class AgentFocus(BaseModel):
    index: int = Field(..., ge=0)
    row: int = Field(..., ge=0)
    col: int = Field(..., ge=0)
    reason: str = ""


class AgentGazeRequest(BaseModel):
    persona_description: str = Field(..., min_length=1, max_length=4000)
    shopper_name: str = Field(..., min_length=1, max_length=120)
    shopper_age: int = Field(..., ge=1, le=120)
    grid_rows: int = Field(..., ge=2, le=MAX_GRID_DIMENSION)
    grid_cols: int = Field(..., ge=2, le=MAX_GRID_DIMENSION)
    image_base64: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _check_grid_size(self) -> "AgentGazeRequest":
        if self.grid_rows * self.grid_cols > MAX_GRID_CELLS:
            raise ValueError(f"grid_rows * grid_cols must not exceed {MAX_GRID_CELLS}")
        return self


class AgentGazeResponse(BaseModel):
    cells: List[AgentGridCell]
    focus: AgentFocus


# --- Sessions / behavioral events -----------------------------------------

SubjectType = Literal["real", "agent"]
EventType = Literal[
    "zone_dwell", "product_interaction", "purchase", "navigation_sample", "ad_view", "agent_thought"
]


class SessionCreateRequest(BaseModel):
    subject_type: SubjectType
    persona_key: Optional[str] = Field(default=None, max_length=64)
    persona_label: Optional[str] = Field(default=None, max_length=120)
    variant_id: Optional[str] = Field(default=None, max_length=64)
    meta: dict[str, Any] = Field(default_factory=dict)


class SessionResponse(BaseModel):
    id: str
    created_at: str
    subject_type: SubjectType
    persona_key: Optional[str] = None
    persona_label: Optional[str] = None
    variant_id: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict)


class BehaviorEvent(BaseModel):
    event_type: EventType
    ts_ms: int = Field(..., ge=0)
    zone_id: Optional[str] = Field(default=None, max_length=128)
    product_key: Optional[str] = Field(default=None, max_length=128)
    duration_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)
    payload: dict[str, Any] = Field(default_factory=dict)


class EventBatchRequest(BaseModel):
    events: List[BehaviorEvent] = Field(..., min_length=1, max_length=500)


class EventBatchResponse(BaseModel):
    inserted: int


class SessionEndResponse(BaseModel):
    session_id: str
    ended_at: str
    summary: dict[str, Any]


# --- Personas ---------------------------------------------------------------

NavigationStyle = Literal["direct", "explore", "compare"]


class Persona(BaseModel):
    persona_key: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z0-9_]+$")
    label: str = Field(..., min_length=1, max_length=120)
    description: str = Field(..., min_length=1, max_length=2000)
    navigation_style: NavigationStyle
    target_categories: List[str] = Field(default_factory=list)
    preferred_product_keys: List[str] = Field(default_factory=list)
    patience_seconds: float = Field(..., ge=5, le=600)
    browse_probability: float = Field(..., ge=0, le=1)
    ad_attention_bias: float = Field(..., ge=0, le=1)
    price_sensitivity: Literal["low", "medium", "high"] = "medium"
    purchase_likelihood: float = Field(..., ge=0, le=1)


class PersonaListResponse(BaseModel):
    personas: List[Persona]


# --- Population-scale batch simulation --------------------------------------

MAX_BATCH_SIMULATION_COUNT = 500


class BatchSimulateRequest(BaseModel):
    count: int = Field(..., ge=1, le=MAX_BATCH_SIMULATION_COUNT)
    persona_keys: Optional[List[str]] = Field(
        default=None, description="Subset of persona_key values to sample from; omit/empty = whole library"
    )
    variant_id: Optional[str] = Field(default=None, max_length=64)


class BatchSimulateResponse(BaseModel):
    created: int
    session_ids: List[str]
    per_persona_counts: dict[str, int]
    per_persona_purchase_sessions: dict[str, int]
    elapsed_ms: float

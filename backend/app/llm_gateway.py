"""Shared LLM gateway used by application agents."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from functools import lru_cache
import os
from typing import Literal, Sequence

from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import AssistantMessage, SystemMessage, UserMessage
from azure.core.credentials import AzureKeyCredential
from dotenv import load_dotenv

load_dotenv()

MessageRole = Literal["system", "user", "assistant"]

# Hard wall-clock cap on every outbound LLM call. Without this, an unreachable
# endpoint, a revoked/placeholder API key that the server retries against, or
# a network blip hangs the request (and the calling FastAPI worker) forever -
# every caller in this app (Agent Mode gaze, insights generation) needs a fast,
# predictable failure so it can fall back gracefully instead of freezing the UI.
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "15"))
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm-gateway")


class LLMGatewayError(RuntimeError):
    """Raised when the shared LLM gateway cannot complete a request."""


@dataclass(frozen=True)
class LLMMessage:
    role: MessageRole
    content: str


@dataclass(frozen=True)
class LLMSettings:
    endpoint: str
    api_key: str
    model: str
    api_version: str

    @classmethod
    def from_environment(cls) -> "LLMSettings":
        endpoint = (
            os.getenv("LITE_LLM_ENDPOINT") or os.getenv("lite_llm_endpoint") or ""
        ).strip().rstrip("/")
        api_key = (os.getenv("LITE_LLM_API_KEY") or os.getenv("api_key") or "").strip()
        model = os.getenv("LITE_LLM_MODEL", "hack-fest-gpt-5.6-luna").strip()
        api_version = os.getenv("LITE_LLM_API_VERSION", "2025-03-01-preview").strip()

        missing = [
            name
            for name, value in {
                "LITE_LLM_ENDPOINT": endpoint,
                "LITE_LLM_API_KEY": api_key,
                "LITE_LLM_MODEL": model,
            }.items()
            if not value
        ]
        if missing:
            raise LLMGatewayError(
                "Missing LLM configuration: " + ", ".join(missing)
            )
        return cls(endpoint, api_key, model, api_version)


@lru_cache(maxsize=1)
def get_settings() -> LLMSettings:
    """Load and validate gateway settings once per process."""
    return LLMSettings.from_environment()


@lru_cache(maxsize=1)
def get_client() -> ChatCompletionsClient:
    """Create the shared Azure inference client lazily."""
    settings = get_settings()
    return ChatCompletionsClient(
        endpoint=settings.endpoint,
        credential=AzureKeyCredential(settings.api_key),
        api_version=settings.api_version,
    )


def run_with_timeout(fn, *, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS):
    """Run a blocking callable with a hard timeout, raising LLMGatewayError
    instead of letting a hung network call block the request indefinitely.
    Shared by complete_chat() and any router that needs to call the raw SDK
    client directly (e.g. the vision/multi-image Agent Mode calls).
    """
    future = _executor.submit(fn)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError as exc:
        raise LLMGatewayError(f"LLM request timed out after {timeout_seconds}s") from exc
    except Exception as exc:
        raise LLMGatewayError("LLM request failed") from exc


def _to_sdk_message(message: LLMMessage):
    message_types = {
        "system": SystemMessage,
        "user": UserMessage,
        "assistant": AssistantMessage,
    }
    return message_types[message.role](content=message.content)


def complete_chat(
    messages: Sequence[LLMMessage],
    *,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> str:
    """Route one agent conversation through the configured LLM service."""
    if not messages:
        raise ValueError("messages must contain at least one message")

    settings = get_settings()
    request = {
        "messages": [_to_sdk_message(message) for message in messages],
        "model": model or settings.model,
        "headers": {"Authorization": settings.api_key},
    }
    if max_tokens is not None:
        request["max_tokens"] = max_tokens
    if temperature is not None:
        request["temperature"] = temperature

    response = run_with_timeout(lambda: get_client().complete(**request))
    content = response.choices[0].message.content

    if not content:
        raise LLMGatewayError("LLM returned an empty response")
    return content


def call_llm(
    prompt: str,
    *,
    system_prompt: str | None = None,
    model: str | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> str:
    """Convenience wrapper for agents that need one user prompt."""
    messages: list[LLMMessage] = []
    if system_prompt:
        messages.append(LLMMessage(role="system", content=system_prompt))
    messages.append(LLMMessage(role="user", content=prompt))
    return complete_chat(
        messages,
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
    )
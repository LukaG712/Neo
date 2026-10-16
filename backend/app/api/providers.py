from json import dumps
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.providers import ProviderError, ProviderRegistry
from app.ollama.client import OllamaUnavailable

router = APIRouter(prefix="/api/providers", tags=["providers"])


class ProviderChatRequest(BaseModel):
    provider: str = "ollama"
    model: str = Field(min_length=1, max_length=160)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    temperature: float = 0.7
    max_tokens: int = 4096
    system_prompt: str | None = None


@router.get("")
def list_providers(request: Request) -> dict:
    registry: ProviderRegistry = request.app.state.providers
    return {"providers": registry.list()}


@router.get("/models")
async def all_provider_models(request: Request) -> dict:
    registry: ProviderRegistry = request.app.state.providers
    models = await registry.list_all_models()
    return {"models": models}


@router.get("/{provider_id}/models")
async def provider_models(provider_id: str, request: Request) -> dict:
    registry: ProviderRegistry = request.app.state.providers
    provider = registry.get(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    if not registry.is_configured(provider_id):
        raise HTTPException(status_code=403, detail=f"Provider '{provider_id}' is not configured.")
    try:
        ollama_mock = getattr(request.app.state, "ollama", None)
        if provider_id == "ollama" and ollama_mock and hasattr(ollama_mock, "list_models"):
            models = await ollama_mock.list_models()
        else:
            models = await provider.list_models()
    except (ProviderError, OllamaUnavailable) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"models": models}


@router.post("/chat/stream")
async def provider_chat_stream(body: ProviderChatRequest, request: Request):
    registry: ProviderRegistry = request.app.state.providers
    provider = registry.get(body.provider)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{body.provider}' not found.")
    if not registry.is_configured(body.provider):
        raise HTTPException(status_code=403, detail=f"Provider '{body.provider}' is not configured.")

    def event(payload: dict) -> str:
        return f"data: {dumps(payload, ensure_ascii=False)}\n\n"

    async def generate():
        try:
            async for chunk in provider.chat_stream(
                body.model,
                body.messages,
                temperature=body.temperature,
                max_tokens=body.max_tokens,
                system_prompt=body.system_prompt,
            ):
                message = chunk.get("message", {})
                token = message.get("content", "")
                if token:
                    yield event({"type": "token", "content": token})
                if chunk.get("done"):
                    yield event({
                        "type": "done",
                        "eval_count": chunk.get("eval_count"),
                        "total_duration": chunk.get("total_duration"),
                    })
        except ProviderError as exc:
            yield event({"type": "error", "message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
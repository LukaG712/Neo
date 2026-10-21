from json import dumps

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.providers import ProviderError, ProviderRegistry

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("")
def list_providers(request: Request) -> dict:
    registry: ProviderRegistry = request.app.state.providers
    return {"providers": registry.list()}


@router.get("/{provider_id}/models")
async def provider_models(provider_id: str, request: Request) -> dict:
    registry: ProviderRegistry = request.app.state.providers
    provider = registry.get(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    if not registry.is_configured(provider_id):
        raise HTTPException(status_code=403, detail=f"Provider '{provider_id}' is not configured.")
    try:
        models = await provider.list_models()
    except ProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"models": models}


@router.post("/chat/stream")
async def provider_chat_stream(request: Request) -> dict:
    registry: ProviderRegistry = request.app.state.providers
    body = await request.json()
    provider_id = body.get("provider", "ollama")
    model = body.get("model", "")
    messages = body.get("messages", [])
    temperature = body.get("temperature", 0.7)
    max_tokens = body.get("max_tokens", 4096)

    provider = registry.get(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found.")
    if not registry.is_configured(provider_id):
        raise HTTPException(status_code=403, detail=f"Provider '{provider_id}' is not configured.")

    def event(payload: dict) -> str:
        return f"data: {dumps(payload, ensure_ascii=False)}\n\n"

    async def generate():
        try:
            async for chunk in provider.chat_stream(model, messages, temperature=temperature, max_tokens=max_tokens):
                message = chunk.get("message", {})
                token = message.get("content", "")
                if token:
                    yield event({"type": "token", "content": token})
                if chunk.get("done"):
                    yield event({"type": "done"})
        except ProviderError as exc:
            yield event({"type": "error", "message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
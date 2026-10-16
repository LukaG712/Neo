import asyncio
import time

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.core.providers import ProviderError, ProviderRegistry
from app.ollama.client import OllamaUnavailable

router = APIRouter(prefix="/api/playground", tags=["playground"])


class CompareRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
    models: list[str] = Field(min_length=2, max_length=4)
    temperature: float = 0.7
    max_tokens: int = 4096

    @field_validator("models")
    @classmethod
    def unique_models(cls, models: list[str]) -> list[str]:
        if len(set(models)) != len(models):
            raise ValueError("Choose each model only once.")
        return models


@router.post("/compare")
async def compare_models(body: CompareRequest, request: Request):
    registry: ProviderRegistry = request.app.state.providers
    ollama_mock = getattr(request.app.state, "ollama", None)

    # Validate models
    installed_ollama = set()
    if ollama_mock and hasattr(ollama_mock, "list_models"):
        try:
            installed_ollama = {
                m.get("name") for m in await ollama_mock.list_models() if isinstance(m, dict) and m.get("name")
            }
        except OllamaUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    for model_name in body.models:
        provider_inst, actual_model = registry.resolve_provider_and_model(model_name)
        if provider_inst.provider_id == "ollama":
            if installed_ollama and actual_model not in installed_ollama and model_name not in installed_ollama:
                raise HTTPException(status_code=422, detail=f"Model is not installed: {model_name}")
        elif not registry.is_configured(provider_inst.provider_id):
            raise HTTPException(
                status_code=422,
                detail=f"Provider '{provider_inst.name}' is not configured for model '{model_name}'.",
            )

    async def run(model_spec: str) -> dict:
        start_time = time.perf_counter()
        provider_inst, actual_model = registry.resolve_provider_and_model(model_spec)

        try:
            if provider_inst.provider_id == "ollama" and ollama_mock and hasattr(ollama_mock, "generate"):
                result = await ollama_mock.generate(actual_model, body.prompt)
            else:
                result = await provider_inst.generate(
                    actual_model,
                    body.prompt,
                    temperature=body.temperature,
                    max_tokens=body.max_tokens,
                )

            elapsed_ns = int((time.perf_counter() - start_time) * 1e9)
            return {
                "model": model_spec,
                "provider": provider_inst.provider_id,
                "response": result.get("response", ""),
                "total_duration": result.get("total_duration") or elapsed_ns,
                "prompt_eval_duration": result.get("prompt_eval_duration"),
                "eval_count": result.get("eval_count"),
                "eval_duration": result.get("eval_duration"),
            }
        except (OllamaUnavailable, ProviderError) as exc:
            return {"model": model_spec, "error": str(exc)}
        except (httpx.HTTPError, ValueError, RuntimeError) as exc:
            return {"model": model_spec, "error": f"Failed: {exc}"}

    results = await asyncio.gather(*(run(model) for model in body.models))
    return {"results": results}

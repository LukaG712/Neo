"""API provider abstraction for Orbis.

Supports Ollama (local) and cloud providers (OpenAI, Anthropic, Google Gemini).
API keys are configured server-side via environment variables and are never
exposed to the frontend.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

import httpx


class ProviderError(Exception):
    """Raised when a provider cannot be reached or returns an error."""


class BaseProvider(ABC):
    """Abstract base class for AI providers."""

    def __init__(self, name: str, base_url: str | None = None, timeout: float = 10.0) -> None:
        self.name = name
        self.base_url = base_url
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") if base_url else None,
            timeout=httpx.Timeout(timeout, read=300.0),
        ) if base_url else None

    @abstractmethod
    async def list_models(self) -> list[dict[str, Any]]:
        """Return a list of available models."""

    @abstractmethod
    async def chat_stream(self, model: str, messages: list[dict[str, Any]], temperature: float = 0.7, max_tokens: int = 4096) -> AsyncIterator[dict[str, Any]]:
        """Stream chat responses from the provider."""

    @abstractmethod
    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 4096) -> dict[str, Any]:
        """Generate a single response (non-streaming)."""

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()


class OllamaProvider(BaseProvider):
    """Ollama local provider."""

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        super().__init__("ollama", base_url, timeout)

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get("/api/tags")
            response.raise_for_status()
            return response.json().get("models", [])
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Could not connect to Ollama.") from exc

    async def chat_stream(self, model: str, messages: list[dict[str, Any]], temperature: float = 0.7, max_tokens: int = 4096) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        try:
            async with self._client.stream(
                "POST",
                "/api/chat",
                json={"model": model, "messages": messages, "stream": True, "options": {"temperature": temperature, "num_predict": max_tokens}},
            ) as response:
                response.raise_for_status()
                import json
                async for line in response.aiter_lines():
                    if line:
                        yield json.loads(line)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ProviderError("Ollama could not find that model.") from exc
            raise ProviderError("Ollama could not complete the chat request.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Ollama could not complete the chat request.") from exc

    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 4096) -> dict[str, Any]:
        assert self._client is not None
        try:
            response = await self._client.post(
                "/api/generate",
                json={"model": model, "prompt": prompt, "stream": False, "options": {"temperature": temperature, "num_predict": max_tokens}},
            )
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ProviderError("Ollama could not find that model.") from exc
            raise ProviderError("Ollama could not complete this model response.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Ollama could not complete this model response.") from exc
        return {
            "response": result.get("response", ""),
            "total_duration": result.get("total_duration"),
            "prompt_eval_duration": result.get("prompt_eval_duration"),
            "eval_count": result.get("eval_count"),
            "eval_duration": result.get("eval_duration"),
        }


class OpenAIProvider(BaseProvider):
    """OpenAI cloud provider."""

    def __init__(self, api_key: str, timeout: float = 10.0) -> None:
        super().__init__("openai", "https://api.openai.com", timeout)
        self.api_key = api_key

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get(
                "/v1/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            data = response.json()
            models = data.get("data", [])
            return [
                {"id": m.get("id", ""), "name": m.get("id", ""), "provider": "openai"}
                for m in models
                if m.get("id", "").startswith(("gpt-", "o1", "o3", "o4"))
            ]
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Could not connect to OpenAI.") from exc

    async def chat_stream(self, model: str, messages: list[dict[str, Any]], temperature: float = 0.7, max_tokens: int = 4096) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        try:
            async with self._client.stream(
                "POST",
                "/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            ) as response:
                response.raise_for_status()
                import json
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choice = chunk.get("choices", [{}])[0]
                        delta = choice.get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            yield {"message": {"content": content}}
                        if choice.get("finish_reason"):
                            yield {"done": True}
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"OpenAI error: {exc.response.status_code}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("OpenAI chat request failed.") from exc

    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 4096) -> dict[str, Any]:
        assert self._client is not None
        try:
            response = await self._client.post(
                "/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("OpenAI generation failed.") from exc
        choice = result.get("choices", [{}])[0]
        return {
            "response": choice.get("message", {}).get("content", ""),
            "total_duration": None,
            "prompt_eval_duration": None,
            "eval_count": result.get("usage", {}).get("completion_tokens"),
            "eval_duration": None,
        }


class GoogleProvider(BaseProvider):
    """Google Gemini cloud provider."""

    def __init__(self, api_key: str, timeout: float = 10.0) -> None:
        super().__init__("google", "https://generativelanguage.googleapis.com", timeout)
        self.api_key = api_key

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get(
                f"/v1beta/models?key={self.api_key}",
            )
            response.raise_for_status()
            data = response.json()
            return [
                {
                    "id": m.get("name", "").replace("models/", ""),
                    "name": m.get("name", "").replace("models/", ""),
                    "provider": "google",
                }
                for m in data.get("models", [])
                if "generateContent" in (m.get("supportedGenerationMethods") or [])
            ]
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Could not connect to Google Gemini.") from exc

    async def chat_stream(self, model: str, messages: list[dict[str, Any]], temperature: float = 0.7, max_tokens: int = 4096) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            if msg["role"] == "system":
                continue
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
        try:
            async with self._client.stream(
                "POST",
                f"/v1beta/models/{model}:streamGenerateContent?key={self.api_key}",
                headers={"Content-Type": "application/json"},
                json={"contents": contents, "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}},
            ) as response:
                response.raise_for_status()
                import json
                async for line in response.aiter_lines():
                    if line:
                        try:
                            if line.startswith("data: "):
                                chunk = json.loads(line[6:])
                            else:
                                chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        candidates = chunk.get("candidates", [])
                        if candidates:
                            content = candidates[0].get("content", {})
                            parts = content.get("parts", [])
                            for part in parts:
                                text = part.get("text", "")
                                if text:
                                    yield {"message": {"content": text}}
                            if candidates[0].get("finishReason"):
                                yield {"done": True}
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"Google Gemini error: {exc.response.status_code}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Google Gemini chat request failed.") from exc

    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 4096) -> dict[str, Any]:
        assert self._client is not None
        try:
            response = await self._client.post(
                f"/v1beta/models/{model}:generateContent?key={self.api_key}",
                headers={"Content-Type": "application/json"},
                json={"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}},
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Google Gemini generation failed.") from exc
        candidates = result.get("candidates", [])
        text = ""
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                text += part.get("text", "")
        return {
            "response": text,
            "total_duration": None,
            "prompt_eval_duration": None,
            "eval_count": None,
            "eval_duration": None,
        }


class AnthropicProvider(BaseProvider):
    """Anthropic cloud provider."""

    def __init__(self, api_key: str, timeout: float = 10.0) -> None:
        super().__init__("anthropic", "https://api.anthropic.com", timeout)
        self.api_key = api_key

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get(
                "/v1/models",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            response.raise_for_status()
            data = response.json()
            return [
                {"id": m.get("id", ""), "name": m.get("id", ""), "provider": "anthropic"}
                for m in data.get("data", [])
            ]
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Could not connect to Anthropic.") from exc

    async def chat_stream(self, model: str, messages: list[dict[str, Any]], temperature: float = 0.7, max_tokens: int = 4096) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        system = ""
        anthropic_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system = msg["content"]
            else:
                anthropic_messages.append(msg)
        try:
            async with self._client.stream(
                "POST",
                "/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "system": system,
                    "messages": anthropic_messages,
                    "stream": True,
                },
            ) as response:
                response.raise_for_status()
                import json
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        chunk_type = chunk.get("type", "")
                        if chunk_type == "content_block_delta":
                            delta = chunk.get("delta", {})
                            text = delta.get("text", "")
                            if text:
                                yield {"message": {"content": text}}
                        elif chunk_type == "message_stop":
                            yield {"done": True}
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"Anthropic error: {exc.response.status_code}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Anthropic chat request failed.") from exc

    async def generate(self, model: str, prompt: str, temperature: float = 0.7, max_tokens: int = 4096) -> dict[str, Any]:
        assert self._client is not None
        try:
            response = await self._client.post(
                "/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Anthropic generation failed.") from exc
        content_blocks = result.get("content", [])
        text = ""
        for block in content_blocks:
            if block.get("type") == "text":
                text += block.get("text", "")
        return {
            "response": text,
            "total_duration": None,
            "prompt_eval_duration": None,
            "eval_count": result.get("usage", {}).get("output_tokens"),
            "eval_duration": None,
        }


class ProviderRegistry:
    """Manages available AI providers."""

    def __init__(self, settings: Any) -> None:
        self.settings = settings
        self._providers: dict[str, BaseProvider] = {}
        self._configured: dict[str, bool] = {}
        self._initialize()

    def _initialize(self) -> None:
        self._providers["ollama"] = OllamaProvider(
            self.settings.ollama_base_url,
            self.settings.request_timeout_seconds,
        )
        self._configured["ollama"] = True

        if self.settings.openai_api_key:
            self._providers["openai"] = OpenAIProvider(
                self.settings.openai_api_key,
                self.settings.request_timeout_seconds,
            )
            self._configured["openai"] = True
        else:
            self._configured["openai"] = False

        if self.settings.anthropic_api_key:
            self._providers["anthropic"] = AnthropicProvider(
                self.settings.anthropic_api_key,
                self.settings.request_timeout_seconds,
            )
            self._configured["anthropic"] = True
        else:
            self._configured["anthropic"] = False

        if self.settings.gemini_api_key:
            self._providers["google"] = GoogleProvider(
                self.settings.gemini_api_key,
                self.settings.request_timeout_seconds,
            )
            self._configured["google"] = True
        else:
            self._configured["google"] = False

    def get(self, name: str) -> BaseProvider | None:
        return self._providers.get(name)

    def list(self) -> list[dict[str, Any]]:
        result = []
        for name, provider in self._providers.items():
            result.append({
                "id": name,
                "name": provider.name,
                "configured": self._configured.get(name, False),
            })
        return result

    def is_configured(self, name: str) -> bool:
        return self._configured.get(name, False)

    async def close(self) -> None:
        for provider in self._providers.values():
            await provider.close()
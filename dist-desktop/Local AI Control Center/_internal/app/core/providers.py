"""API provider abstraction for Local AI Control Center.

Supports Ollama (local) and cloud providers (OpenAI, Anthropic, Google Gemini, OpenRouter, Groq).
API keys are configured server-side via environment variables and are never
exposed to the frontend.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.ollama.client import OllamaUnavailable


class ProviderError(Exception):
    """Raised when a provider cannot be reached or returns an error."""


class ProviderUnavailable(ProviderError, OllamaUnavailable):
    """Raised when a provider service is offline or unreachable."""


class BaseProvider(ABC):
    """Abstract base class for AI providers."""

    def __init__(
        self,
        provider_id: str,
        display_name: str,
        base_url: str | None = None,
        timeout: float = 10.0,
        read_timeout: float = 300.0,
        is_local: bool = False,
    ) -> None:
        self.provider_id = provider_id
        self.name = display_name
        self.base_url = base_url
        self.is_local = is_local
        self._client: httpx.AsyncClient | None = None
        if base_url:
            self._client = httpx.AsyncClient(
                base_url=base_url.rstrip("/"),
                timeout=httpx.Timeout(timeout, read=read_timeout),
            )

    @abstractmethod
    async def list_models(self) -> list[dict[str, Any]]:
        """Return a list of available models."""

    @abstractmethod
    async def chat_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Stream chat responses from the provider."""

    @abstractmethod
    async def generate(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Generate a single response (non-streaming)."""

    async def status(self) -> dict[str, Any]:
        """Check provider connection status."""
        return {"connected": True}

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()


class OllamaProvider(BaseProvider):
    """Ollama local provider."""

    def __init__(self, base_url: str, timeout: float = 10.0, read_timeout: float = 300.0) -> None:
        super().__init__(
            provider_id="ollama",
            display_name="Ollama",
            base_url=base_url,
            timeout=timeout,
            read_timeout=read_timeout,
            is_local=True,
        )

    async def status(self) -> dict[str, Any]:
        assert self._client is not None
        try:
            response = await self._client.get("/api/version")
            response.raise_for_status()
            version = response.json().get("version")
            return {"connected": True, "version": version}
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("Could not connect to Ollama.") from exc

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get("/api/tags")
            response.raise_for_status()
            raw_models = response.json().get("models", [])
            models = []
            for m in raw_models:
                models.append({
                    "id": m.get("name", ""),
                    "name": m.get("name", ""),
                    "provider": "ollama",
                    "size": m.get("size"),
                    "details": m.get("details", {}),
                    "modified_at": m.get("modified_at"),
                })
            return models
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("Could not connect to Ollama.") from exc

    async def chat_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        req_messages = []
        if system_prompt:
            req_messages.append({"role": "system", "content": system_prompt})
        req_messages.extend(messages)

        options: dict[str, Any] = {"temperature": temperature}
        if max_tokens > 0:
            options["num_predict"] = max_tokens

        try:
            async with self._client.stream(
                "POST",
                "/api/chat",
                json={
                    "model": model,
                    "messages": req_messages,
                    "stream": True,
                    "options": options,
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        chunk = json.loads(line)
                        yield chunk
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ProviderUnavailable(
                    f"Ollama could not find model '{model}'. Check that it is installed."
                ) from exc
            raise ProviderUnavailable("Ollama could not complete the chat request.") from exc
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise ProviderUnavailable("Ollama could not complete the chat request.") from exc

    async def generate(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        assert self._client is not None
        options: dict[str, Any] = {"temperature": temperature}
        if max_tokens > 0:
            options["num_predict"] = max_tokens

        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": options,
        }
        if system_prompt:
            payload["system"] = system_prompt

        try:
            response = await self._client.post("/api/generate", json=payload)
            response.raise_for_status()
            result = response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ProviderUnavailable(
                    f"Ollama could not find model '{model}'. Check that it is installed."
                ) from exc
            raise ProviderUnavailable("Ollama could not complete this model response.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("Ollama could not complete this model response.") from exc

        return {
            "response": result.get("response", ""),
            "total_duration": result.get("total_duration"),
            "prompt_eval_duration": result.get("prompt_eval_duration"),
            "eval_count": result.get("eval_count"),
            "eval_duration": result.get("eval_duration"),
        }


class OpenAIProvider(BaseProvider):
    """OpenAI and OpenAI-compatible cloud provider."""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        provider_id: str = "openai",
        display_name: str = "OpenAI",
        timeout: float = 10.0,
        read_timeout: float = 300.0,
    ) -> None:
        super().__init__(
            provider_id=provider_id,
            display_name=display_name,
            base_url=base_url,
            timeout=timeout,
            read_timeout=read_timeout,
        )
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get("/models", headers=self._headers())
            response.raise_for_status()
            data = response.json()
            models = data.get("data", [])
            results = []
            for m in models:
                mid = m.get("id", "")
                if mid.startswith(("gpt-", "o1", "o3", "o4", "chatgpt")) or self.provider_id != "openai":
                    results.append({
                        "id": mid,
                        "name": mid,
                        "provider": self.provider_id,
                    })
            if not results and self.provider_id == "openai":
                results = [
                    {"id": "gpt-4o", "name": "gpt-4o", "provider": "openai"},
                    {"id": "gpt-4o-mini", "name": "gpt-4o-mini", "provider": "openai"},
                    {"id": "o1-mini", "name": "o1-mini", "provider": "openai"},
                    {"id": "o3-mini", "name": "o3-mini", "provider": "openai"},
                ]
            return results
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError(f"Could not connect to {self.name}: {exc}") from exc

    async def chat_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        req_messages = []
        if system_prompt:
            req_messages.append({"role": "system", "content": system_prompt})
        req_messages.extend(messages)

        payload: dict[str, Any] = {
            "model": model,
            "messages": req_messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if not model.startswith(("o1", "o3")):
            payload["temperature"] = temperature
            payload["max_tokens"] = max_tokens

        try:
            async with self._client.stream(
                "POST",
                "/chat/completions",
                headers=self._headers(),
                json=payload,
            ) as response:
                response.raise_for_status()
                eval_count = 0
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        usage = chunk.get("usage")
                        if usage:
                            eval_count = usage.get("completion_tokens", eval_count)

                        choices = chunk.get("choices", [])
                        if choices:
                            choice = choices[0]
                            delta = choice.get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                eval_count += 1
                                yield {"message": {"content": content}}
                            if choice.get("finish_reason"):
                                yield {"done": True, "eval_count": eval_count}
                yield {"done": True, "eval_count": eval_count}
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"{self.name} error: {exc.response.status_code}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError(f"{self.name} chat request failed.") from exc

    async def generate(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        assert self._client is not None
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if not model.startswith(("o1", "o3")):
            payload["temperature"] = temperature
            payload["max_tokens"] = max_tokens

        try:
            response = await self._client.post(
                "/chat/completions",
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError(f"{self.name} generation failed: {exc}") from exc

        choice = result.get("choices", [{}])[0]
        usage = result.get("usage", {})
        return {
            "response": choice.get("message", {}).get("content", ""),
            "total_duration": None,
            "prompt_eval_duration": None,
            "eval_count": usage.get("completion_tokens"),
            "eval_duration": None,
        }


class GoogleProvider(BaseProvider):
    """Google Gemini cloud provider."""

    def __init__(
        self,
        api_key: str,
        timeout: float = 10.0,
        read_timeout: float = 300.0,
    ) -> None:
        super().__init__(
            provider_id="google",
            display_name="Google Gemini",
            base_url="https://generativelanguage.googleapis.com",
            timeout=timeout,
            read_timeout=read_timeout,
        )
        self.api_key = api_key

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get(f"/v1beta/models?key={self.api_key}")
            response.raise_for_status()
            data = response.json()
            return [
                {
                    "id": m.get("name", "").replace("models/", ""),
                    "name": m.get("displayName") or m.get("name", "").replace("models/", ""),
                    "provider": "google",
                }
                for m in data.get("models", [])
                if "generateContent" in (m.get("supportedGenerationMethods") or [])
            ]
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Could not connect to Google Gemini.") from exc

    async def chat_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            if msg["role"] == "system":
                continue
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})

        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        try:
            async with self._client.stream(
                "POST",
                f"/v1beta/models/{model}:streamGenerateContent?key={self.api_key}",
                headers={"Content-Type": "application/json"},
                json=body,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        raw = line.removeprefix("data: ")
                        try:
                            chunk = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        candidates = chunk.get("candidates", [])
                        if candidates:
                            cand = candidates[0]
                            parts = cand.get("content", {}).get("parts", [])
                            for part in parts:
                                text = part.get("text", "")
                                if text:
                                    yield {"message": {"content": text}}
                            if cand.get("finishReason"):
                                yield {"done": True}
                yield {"done": True}
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"Google Gemini error: {exc.response.status_code}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Google Gemini chat request failed.") from exc

    async def generate(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        assert self._client is not None
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
            },
        }
        if system_prompt:
            body["systemInstruction"] = {"parts": [{"text": system_prompt}]}

        try:
            response = await self._client.post(
                f"/v1beta/models/{model}:generateContent?key={self.api_key}",
                headers={"Content-Type": "application/json"},
                json=body,
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

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.anthropic.com",
        timeout: float = 10.0,
        read_timeout: float = 300.0,
    ) -> None:
        super().__init__(
            provider_id="anthropic",
            display_name="Anthropic Claude",
            base_url=base_url,
            timeout=timeout,
            read_timeout=read_timeout,
        )
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

    async def list_models(self) -> list[dict[str, Any]]:
        assert self._client is not None
        try:
            response = await self._client.get("/v1/models", headers=self._headers())
            if response.status_code == 200:
                data = response.json()
                return [
                    {"id": m.get("id", ""), "name": m.get("display_name") or m.get("id", ""), "provider": "anthropic"}
                    for m in data.get("data", [])
                ]
        except (httpx.HTTPError, ValueError):
            pass
        # Fallback list of modern Anthropic models
        return [
            {"id": "claude-3-7-sonnet-20250219", "name": "claude-3-7-sonnet", "provider": "anthropic"},
            {"id": "claude-3-5-sonnet-20241022", "name": "claude-3-5-sonnet", "provider": "anthropic"},
            {"id": "claude-3-5-haiku-20241022", "name": "claude-3-5-haiku", "provider": "anthropic"},
            {"id": "claude-3-opus-20240229", "name": "claude-3-opus", "provider": "anthropic"},
        ]

    async def chat_stream(
        self,
        model: str,
        messages: list[dict[str, Any]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        assert self._client is not None
        sys = system_prompt or ""
        anthropic_messages = []
        for msg in messages:
            if msg["role"] == "system":
                sys = (sys + "\n\n" + msg["content"]).strip() if sys else msg["content"]
            else:
                anthropic_messages.append({"role": msg["role"], "content": msg["content"]})

        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthropic_messages,
            "stream": True,
        }
        if sys:
            payload["system"] = sys

        try:
            async with self._client.stream(
                "POST",
                "/v1/messages",
                headers=self._headers(),
                json=payload,
            ) as response:
                response.raise_for_status()
                eval_count = 0
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        raw = line[6:].strip()
                        try:
                            chunk = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        chunk_type = chunk.get("type", "")
                        if chunk_type == "content_block_delta":
                            delta = chunk.get("delta", {})
                            text = delta.get("text", "")
                            if text:
                                eval_count += 1
                                yield {"message": {"content": text}}
                        elif chunk_type == "message_delta":
                            usage = chunk.get("usage", {})
                            if "output_tokens" in usage:
                                eval_count = usage["output_tokens"]
                        elif chunk_type == "message_stop":
                            yield {"done": True, "eval_count": eval_count}
                yield {"done": True, "eval_count": eval_count}
        except httpx.HTTPStatusError as exc:
            raise ProviderError(f"Anthropic error: {exc.response.status_code}") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Anthropic chat request failed.") from exc

    async def generate(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        assert self._client is not None
        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            payload["system"] = system_prompt

        try:
            response = await self._client.post(
                "/v1/messages",
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderError("Anthropic generation failed.") from exc

        content_blocks = result.get("content", [])
        text = "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")
        return {
            "response": text,
            "total_duration": None,
            "prompt_eval_duration": None,
            "eval_count": result.get("usage", {}).get("output_tokens"),
            "eval_duration": None,
        }


class ProviderRegistry:
    """Manages all available AI providers."""

    def __init__(self, settings: Any) -> None:
        self.settings = settings
        self._providers: dict[str, BaseProvider] = {}
        self._configured: dict[str, bool] = {}
        self._initialize()

    def _initialize(self) -> None:
        # 1. Ollama (Local)
        self._providers["ollama"] = OllamaProvider(
            self.settings.ollama_base_url,
            self.settings.request_timeout_seconds,
            self.settings.read_timeout_seconds,
        )
        self._configured["ollama"] = True

        # 2. OpenAI
        if self.settings.openai_api_key:
            self._providers["openai"] = OpenAIProvider(
                api_key=self.settings.openai_api_key,
                base_url=self.settings.openai_base_url,
                timeout=self.settings.request_timeout_seconds,
                read_timeout=self.settings.read_timeout_seconds,
            )
            self._configured["openai"] = True
        else:
            self._configured["openai"] = False

        # 3. Anthropic
        if self.settings.anthropic_api_key:
            self._providers["anthropic"] = AnthropicProvider(
                api_key=self.settings.anthropic_api_key,
                base_url=self.settings.anthropic_base_url,
                timeout=self.settings.request_timeout_seconds,
                read_timeout=self.settings.read_timeout_seconds,
            )
            self._configured["anthropic"] = True
        else:
            self._configured["anthropic"] = False

        # 4. Google Gemini
        if self.settings.gemini_api_key:
            self._providers["google"] = GoogleProvider(
                api_key=self.settings.gemini_api_key,
                timeout=self.settings.request_timeout_seconds,
                read_timeout=self.settings.read_timeout_seconds,
            )
            self._configured["google"] = True
        else:
            self._configured["google"] = False

        # 5. OpenRouter
        if self.settings.openrouter_api_key:
            self._providers["openrouter"] = OpenAIProvider(
                api_key=self.settings.openrouter_api_key,
                base_url="https://openrouter.ai/api/v1",
                provider_id="openrouter",
                display_name="OpenRouter",
                timeout=self.settings.request_timeout_seconds,
                read_timeout=self.settings.read_timeout_seconds,
            )
            self._configured["openrouter"] = True
        else:
            self._configured["openrouter"] = False

        # 6. Groq
        if self.settings.groq_api_key:
            self._providers["groq"] = OpenAIProvider(
                api_key=self.settings.groq_api_key,
                base_url="https://api.groq.com/openai/v1",
                provider_id="groq",
                display_name="Groq",
                timeout=self.settings.request_timeout_seconds,
                read_timeout=self.settings.read_timeout_seconds,
            )
            self._configured["groq"] = True
        else:
            self._configured["groq"] = False

    def get(self, name: str) -> BaseProvider | None:
        return self._providers.get(name)

    def is_configured(self, name: str) -> bool:
        return self._configured.get(name, False)

    def resolve_provider_and_model(self, model_spec: str, default_provider: str = "ollama") -> tuple[BaseProvider, str]:
        """Resolves a model spec like 'openai:gpt-4o' or 'qwen2.5:7b' to (provider, model_name)."""
        if ":" in model_spec:
            prefix, rest = model_spec.split(":", 1)
            if prefix in self._providers and self.is_configured(prefix):
                return self._providers[prefix], rest

        # Check default provider
        provider = self.get(default_provider)
        if provider and self.is_configured(default_provider):
            return provider, model_spec

        # Fallback to Ollama
        ollama = self._providers["ollama"]
        return ollama, model_spec

    def list(self) -> list[dict[str, Any]]:
        result = []
        for name, provider in self._providers.items():
            result.append({
                "id": name,
                "name": provider.name,
                "is_local": provider.is_local,
                "configured": self._configured.get(name, False),
            })
        return result

    async def list_all_models(self) -> list[dict[str, Any]]:
        all_models = []
        for name, provider in self._providers.items():
            if self.is_configured(name):
                try:
                    models = await provider.list_models()
                    all_models.extend(models)
                except (ProviderError, httpx.HTTPError, ValueError):
                    pass
        return all_models

    async def close(self) -> None:
        for provider in self._providers.values():
            await provider.close()
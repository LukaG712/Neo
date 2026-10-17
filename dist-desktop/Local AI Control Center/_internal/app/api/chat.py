import time
from datetime import UTC, datetime
from json import dumps
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.providers import ProviderError, ProviderRegistry
from app.db.database import get_db
from app.ollama.client import OllamaUnavailable

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    conversation_id: str
    model: str = Field(min_length=1, max_length=160)
    provider: str | None = None
    message: str = Field(min_length=1, max_length=100_000)
    temperature: float = 0.7
    max_tokens: int = 4096
    system_prompt: str | None = None


def timestamp() -> str:
    return datetime.now(UTC).isoformat()


def event(payload: dict) -> str:
    return f"data: {dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def stream_chat(body: ChatRequest, request: Request):
    with get_db() as db:
        conversation = db.execute(
            "SELECT id, title, provider, model, system_prompt FROM conversations WHERE id = ?",
            (body.conversation_id,),
        ).fetchone()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        existing = db.execute(
            "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid",
            (body.conversation_id,),
        ).fetchall()
        current_time = timestamp()

        # Save user message
        db.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
            (str(uuid4()), body.conversation_id, body.message, current_time),
        )

        # Auto-title if new conversation
        title = (
            body.message.strip().splitlines()[0][:72]
            if conversation["title"] == "New conversation"
            else conversation["title"]
        )
        provider_name = body.provider or conversation["provider"] or "ollama"

        db.execute(
            "UPDATE conversations SET title = ?, model = ?, provider = ?, updated_at = ? WHERE id = ?",
            (title or "New conversation", body.model, provider_name, current_time, body.conversation_id),
        )

    messages = [{"role": row["role"], "content": row["content"]} for row in existing]
    messages.append({"role": "user", "content": body.message})

    registry: ProviderRegistry = request.app.state.providers
    provider_inst, actual_model = registry.resolve_provider_and_model(body.model, provider_name)

    async def generate():
        answer = ""
        stats: dict = {}
        start_time = time.perf_counter()
        token_count = 0

        try:
            # If Ollama client is directly mocked on app.state (e.g. in test suite)
            ollama_mock = getattr(request.app.state, "ollama", None)
            use_ollama_client = (
                provider_inst.provider_id == "ollama"
                and ollama_mock is not None
                and hasattr(ollama_mock, "chat_stream")
            )

            stream_iter = (
                ollama_mock.chat_stream(actual_model, messages)
                if use_ollama_client
                else provider_inst.chat_stream(
                    actual_model,
                    messages,
                    temperature=body.temperature,
                    max_tokens=body.max_tokens,
                    system_prompt=body.system_prompt or conversation["system_prompt"],
                )
            )

            async for chunk in stream_iter:
                message = chunk.get("message", {})
                token = message.get("content", "")
                if token:
                    answer += token
                    token_count += 1
                    yield event({"type": "token", "content": token})
                if chunk.get("done"):
                    elapsed_ns = int((time.perf_counter() - start_time) * 1e9)
                    stats = {
                        "total_duration": chunk.get("total_duration") or elapsed_ns,
                        "prompt_eval_duration": chunk.get("prompt_eval_duration"),
                        "eval_count": chunk.get("eval_count") or token_count,
                        "eval_duration": chunk.get("eval_duration"),
                    }
                    yield event({"type": "done", **stats})

            if not stats and answer:
                elapsed_ns = int((time.perf_counter() - start_time) * 1e9)
                stats = {
                    "total_duration": elapsed_ns,
                    "eval_count": token_count,
                }
                yield event({"type": "done", **stats})

        except (OllamaUnavailable, ProviderError) as exc:
            yield event({"type": "error", "message": str(exc)})
        finally:
            if answer:
                completed = timestamp()
                with get_db() as db:
                    db.execute(
                        """INSERT INTO messages (id, conversation_id, role, content, created_at,
                        total_duration_ns, prompt_duration_ns, eval_count, eval_duration_ns)
                        VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)""",
                        (
                            str(uuid4()),
                            body.conversation_id,
                            answer,
                            completed,
                            stats.get("total_duration"),
                            stats.get("prompt_eval_duration"),
                            stats.get("eval_count") or token_count,
                            stats.get("eval_duration"),
                        ),
                    )
                    db.execute(
                        "UPDATE conversations SET updated_at = ? WHERE id = ?",
                        (completed, body.conversation_id),
                    )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

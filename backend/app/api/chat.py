from datetime import UTC, datetime
from json import dumps
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.db.database import connect
from app.ollama.client import OllamaUnavailable

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    conversation_id: str
    model: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=100_000)
    system_prompt: str | None = None
    edit_message_id: str | None = None  # If set, edit this message instead of creating new
    regenerate: bool = False  # If True, regenerate the last assistant response

class RegenerateRequest(BaseModel):
    conversation_id: str
    model: str = Field(min_length=1, max_length=160)
    system_prompt: str | None = None


def timestamp() -> str:
    return datetime.now(UTC).isoformat()


def event(payload: dict) -> str:
    return f"data: {dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/regenerate")
async def regenerate_chat(body: RegenerateRequest, request: Request):
    """Regenerate the last assistant response in a conversation."""
    with connect() as db:
        conversation = db.execute(
            "SELECT id, title FROM conversations WHERE id = ?", (body.conversation_id,)
        ).fetchone()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        # Get all messages and find the last user message
        all_messages = db.execute(
            "SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY rowid",
            (body.conversation_id,),
        ).fetchall()
        if not all_messages:
            raise HTTPException(status_code=400, detail="No messages to regenerate.")
        # Find last user message
        last_user = None
        for msg in reversed(all_messages):
            if msg["role"] == "user":
                last_user = msg
                break
        if not last_user:
            raise HTTPException(status_code=400, detail="No user message found to regenerate.")
        # Delete all messages after the last user message
        db.execute(
            "DELETE FROM messages WHERE conversation_id = ? AND id > ?",
            (body.conversation_id, last_user["id"]),
        )
    # Build message list with system prompt
    messages = []
    system_prompt = body.system_prompt
    for row in all_messages:
        if row["role"] == "system":
            system_prompt = row["content"]
        elif row["id"] <= last_user["id"]:
            messages.append({"role": row["role"], "content": row["content"]})
    if system_prompt:
        messages.insert(0, {"role": "system", "content": system_prompt})
    
    ollama = request.app.state.ollama

    async def generate():
        answer = ""
        stats = {}
        try:
            async for chunk in ollama.chat_stream(body.model, messages):
                message = chunk.get("message", {})
                token = message.get("content", "")
                if token:
                    answer += token
                    yield event({"type": "token", "content": token})
                if chunk.get("done"):
                    stats = {
                        key: chunk.get(key)
                        for key in (
                            "total_duration",
                            "prompt_eval_duration",
                            "eval_count",
                            "eval_duration",
                        )
                    }
                    yield event({"type": "done", **stats})
        except OllamaUnavailable as exc:
            yield event({"type": "error", "message": str(exc)})
        finally:
            if answer:
                completed = timestamp()
                with connect() as db:
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
                            stats.get("eval_count"),
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


@router.post("/stream")
async def stream_chat(body: ChatRequest, request: Request):
    with connect() as db:
        conversation = db.execute(
            "SELECT id, title FROM conversations WHERE id = ?", (body.conversation_id,)
        ).fetchone()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        existing = db.execute(
            "SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY rowid",
            (body.conversation_id,),
        ).fetchall()
        current_time = timestamp()
        db.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
            (str(uuid4()), body.conversation_id, body.message, current_time),
        )
        title = (
            body.message.strip().splitlines()[0][:72]
            if conversation["title"] == "New conversation"
            else conversation["title"]
        )
        db.execute(
            "UPDATE conversations SET title = ?, model = ?, updated_at = ? WHERE id = ?",
            (title or "New conversation", body.model, current_time, body.conversation_id),
        )
    # Build message list with system prompt if provided
    messages = []
    system_prompt = body.system_prompt
    for row in existing:
        if row["role"] == "system":
            system_prompt = row["content"]
        else:
            messages.append({"role": row["role"], "content": row["content"]})
    
    # Add system message if provided
    if system_prompt:
        messages.insert(0, {"role": "system", "content": system_prompt})
    
    # Handle edit or regenerate
    if body.edit_message_id:
        # Edit mode: replace the message with edited content
        messages = []
        for row in existing:
            if row["id"] == body.edit_message_id:
                messages.append({"role": row["role"], "content": body.message})
            elif row["role"] != "system":
                messages.append({"role": row["role"], "content": row["content"]})
    elif body.regenerate:
        # Regenerate mode: remove last assistant message and re-send last user message
        user_messages = [msg for msg in messages if msg["role"] == "user"]
        if user_messages:
            last_user_msg = user_messages[-1]["content"]
            # Get all messages up to and including the last user message
            cutoff_idx = None
            for i, row in enumerate(existing):
                if row["role"] == "user" and row["content"] == last_user_msg:
                    cutoff_idx = i
            if cutoff_idx is not None:
                messages = []
                for row in existing[:cutoff_idx + 1]:
                    if row["role"] != "system":
                        messages.append({"role": row["role"], "content": row["content"]})
            messages.append({"role": "user", "content": last_user_msg})
        else:
            messages.append({"role": "user", "content": body.message})
    else:
        messages.append({"role": "user", "content": body.message})
    
    ollama = request.app.state.ollama

    async def generate():
        answer = ""
        stats = {}
        try:
            async for chunk in ollama.chat_stream(body.model, messages):
                message = chunk.get("message", {})
                token = message.get("content", "")
                if token:
                    answer += token
                    yield event({"type": "token", "content": token})
                if chunk.get("done"):
                    stats = {
                        key: chunk.get(key)
                        for key in (
                            "total_duration",
                            "prompt_eval_duration",
                            "eval_count",
                            "eval_duration",
                        )
                    }
                    yield event({"type": "done", **stats})
        except OllamaUnavailable as exc:
            yield event({"type": "error", "message": str(exc)})
        finally:
            if answer:
                completed = timestamp()
                with connect() as db:
                    if body.edit_message_id:
                        # Update the edited message
                        db.execute(
                            "UPDATE messages SET content = ?, created_at = ? WHERE id = ?",
                            (answer, completed, body.edit_message_id),
                        )
                    else:
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
                                stats.get("eval_count"),
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

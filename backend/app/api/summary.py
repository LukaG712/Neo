from datetime import UTC, datetime
from json import dumps
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.db.database import connect
from app.ollama.client import OllamaUnavailable

router = APIRouter(prefix="/api/summary", tags=["summary"])


class SummaryRequest(BaseModel):
    conversation_id: str
    model: str = Field(min_length=1, max_length=160)


def timestamp() -> str:
    return datetime.now(UTC).isoformat()


def event(payload: dict) -> str:
    return f"data: {dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def summarize_conversation(body: SummaryRequest, request: Request):
    """Generate a summary of a conversation using the AI model."""
    with connect() as db:
        conversation = db.execute(
            "SELECT id, title FROM conversations WHERE id = ?", (body.conversation_id,)
        ).fetchone()
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        messages = db.execute(
            "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY rowid",
            (body.conversation_id,),
        ).fetchall()

        if not messages:
            raise HTTPException(status_code=400, detail="No messages to summarize.")

    # Build a summary prompt
    conversation_text = "\n".join(
        f"{msg['role']}: {msg['content']}" for msg in messages
    )

    summary_prompt = (
        "Summarize the following conversation in 3-5 bullet points. "
        "Focus on the key topics discussed and any conclusions reached.\n\n"
        f"{conversation_text}"
    )

    ollama = request.app.state.ollama

    async def generate():
        answer = ""
        try:
            async for chunk in ollama.chat_stream(
                body.model,
                [{"role": "user", "content": summary_prompt}],
            ):
                message = chunk.get("message", {})
                token = message.get("content", "")
                if token:
                    answer += token
                    yield event({"type": "token", "content": token})
                if chunk.get("done"):
                    yield event({"type": "done"})
        except OllamaUnavailable as exc:
            yield event({"type": "error", "message": str(exc)})
        finally:
            if answer:
                with connect() as db:
                    # Store the summary in the messages table as a system message
                    db.execute(
                        """INSERT INTO messages (id, conversation_id, role, content, created_at)
                        VALUES (?, ?, 'system', ?, ?)""",
                        (
                            str(uuid4()),
                            body.conversation_id,
                            f"[SUMMARY] {answer}",
                            timestamp(),
                        ),
                    )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

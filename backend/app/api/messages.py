from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.database import get_db

router = APIRouter(prefix="/api/conversations/{conversation_id}/messages", tags=["messages"])


class MessageCreate(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1, max_length=100_000)
    total_duration_ns: int | None = None
    prompt_duration_ns: int | None = None
    eval_count: int | None = None
    eval_duration_ns: int | None = None


@router.post("", status_code=201)
def create_message(conversation_id: str, body: MessageCreate):
    timestamp = datetime.now(UTC).isoformat()
    with get_db() as db:
        if not db.execute(
            "SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone():
            raise HTTPException(status_code=404, detail="Conversation not found.")
        message_id = str(uuid4())
        db.execute(
            """
            INSERT INTO messages (id, conversation_id, role, content, created_at,
                                 total_duration_ns, prompt_duration_ns, eval_count, eval_duration_ns)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                conversation_id,
                body.role,
                body.content,
                timestamp,
                body.total_duration_ns,
                body.prompt_duration_ns,
                body.eval_count,
                body.eval_duration_ns,
            ),
        )
        db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?", (timestamp, conversation_id)
        )
        row = db.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    return dict(row)


@router.delete("/{message_id}", status_code=204)
def delete_message(conversation_id: str, message_id: str):
    with get_db() as db:
        result = db.execute(
            "DELETE FROM messages WHERE id = ? AND conversation_id = ?",
            (message_id, conversation_id),
        )
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Message not found.")
        db.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?",
            (datetime.now(UTC).isoformat(), conversation_id),
        )

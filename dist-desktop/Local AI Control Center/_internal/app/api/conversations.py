from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db.database import get_db

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def now() -> str:
    return datetime.now(UTC).isoformat()


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=120)
    model: str | None = None
    provider: str = "ollama"
    system_prompt: str | None = None
    temperature: float = 0.7
    max_tokens: int = 4096


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model: str | None = None
    provider: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


# Backward compatibility alias
class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=120)


@router.get("")
def list_conversations(search: str | None = Query(default=None, max_length=200)):
    with get_db() as db:
        if search:
            term = f"%{search}%"
            rows = db.execute(
                """
                SELECT DISTINCT c.id, c.title, c.model, c.provider, c.created_at, c.updated_at,
                       (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                WHERE c.title LIKE ? OR m.content LIKE ?
                ORDER BY c.updated_at DESC
                """,
                (term, term),
            ).fetchall()
        else:
            rows = db.execute(
                """
                SELECT c.id, c.title, c.model, c.provider, c.created_at, c.updated_at,
                       (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
                FROM conversations c
                ORDER BY c.updated_at DESC
                """
            ).fetchall()
        return {"conversations": [dict(row) for row in rows]}


@router.post("", status_code=201)
def create_conversation(body: ConversationCreate):
    identifier, timestamp = str(uuid4()), now()
    with get_db() as db:
        db.execute(
            """
            INSERT INTO conversations (id, title, model, provider, system_prompt, temperature, max_tokens, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                identifier,
                body.title.strip(),
                body.model,
                body.provider or "ollama",
                body.system_prompt,
                body.temperature,
                body.max_tokens,
                timestamp,
                timestamp,
            ),
        )
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (identifier,)).fetchone()
    return dict(row)


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str):
    with get_db() as db:
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        messages = db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid", (conversation_id,)
        ).fetchall()
    return {**dict(row), "messages": [dict(message) for message in messages]}


@router.patch("/{conversation_id}")
def update_conversation(conversation_id: str, body: ConversationUpdate | ConversationRename):
    with get_db() as db:
        existing = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        title = body.title.strip() if body.title else existing["title"]
        model = getattr(body, "model", None) or existing["model"]
        provider = getattr(body, "provider", None) or existing["provider"]
        system_prompt = (
            getattr(body, "system_prompt", None)
            if hasattr(body, "system_prompt") and body.system_prompt is not None
            else existing["system_prompt"]
        )
        temperature = getattr(body, "temperature", None) if getattr(body, "temperature", None) is not None else existing["temperature"]
        max_tokens = getattr(body, "max_tokens", None) if getattr(body, "max_tokens", None) is not None else existing["max_tokens"]
        timestamp = now()

        db.execute(
            """
            UPDATE conversations
            SET title = ?, model = ?, provider = ?, system_prompt = ?, temperature = ?, max_tokens = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, model, provider, system_prompt, temperature, max_tokens, timestamp, conversation_id),
        )
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
    return dict(row)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str):
    with get_db() as db:
        result = db.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")


@router.delete("/{conversation_id}/messages", status_code=204)
def clear_conversation_messages(conversation_id: str):
    with get_db() as db:
        existing = db.execute("SELECT id FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        db.execute("DELETE FROM messages WHERE conversation_id = ?", (conversation_id,))
        db.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now(), conversation_id))


@router.get("/{conversation_id}/export")
def export_conversation(conversation_id: str, format: str = Query(default="markdown", pattern="^(markdown|json)$")):
    with get_db() as db:
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        messages = db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid", (conversation_id,)
        ).fetchall()

    conv_data = {**dict(row), "messages": [dict(m) for m in messages]}

    if format == "json":
        import json
        content = json.dumps(conv_data, indent=2, ensure_ascii=False)
        filename = f"conversation-{conversation_id[:8]}.json"
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # Markdown export
    lines = [
        f"# {conv_data['title']}",
        "",
        f"- **Model:** `{conv_data.get('model') or 'Default'}`",
        f"- **Provider:** `{conv_data.get('provider') or 'ollama'}`",
        f"- **Created:** {conv_data['created_at']}",
        "",
        "---",
        "",
    ]
    for msg in conv_data["messages"]:
        role_label = "User" if msg["role"] == "user" else ("Assistant" if msg["role"] == "assistant" else "System")
        lines.append(f"### {role_label}")
        lines.append("")
        lines.append(msg["content"])
        lines.append("")

    content = "\n".join(lines)
    safe_title = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in conv_data["title"])[:30]
    filename = f"{safe_title or 'conversation'}-{conversation_id[:8]}.md"
    return Response(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

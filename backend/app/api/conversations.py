from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db.database import connect

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def now() -> str:
    return datetime.now(UTC).isoformat()


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=120)
    model: str | None = None
    system_prompt: str | None = None


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    system_prompt: str | None = None


class ConversationImport(BaseModel):
    title: str = Field(default="Imported conversation", min_length=1, max_length=120)
    model: str | None = None
    system_prompt: str | None = None
    messages: list[dict] = Field(default_factory=list)


@router.get("")
def list_conversations(search: str | None = Query(default=None, max_length=200)):
    with connect() as db:
        if search:
            # Search in titles and message content
            rows = db.execute(
                "SELECT DISTINCT c.* FROM conversations c "
                "LEFT JOIN messages m ON c.id = m.conversation_id "
                "WHERE c.title LIKE ? OR m.content LIKE ? "
                "ORDER BY c.pinned DESC, c.updated_at DESC",
                (f"%{search}%", f"%{search}%"),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC"
            ).fetchall()
        return {"conversations": [dict(row) for row in rows]}


@router.post("/import", status_code=201)
def import_conversation(body: ConversationImport):
    """Import a conversation from JSON data."""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be empty.")
    identifier = str(uuid4())
    timestamp = now()
    with connect() as db:
        db.execute(
            "INSERT INTO conversations (id, title, model, system_prompt, created_at, updated_at, pinned) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            (identifier, title, body.model, body.system_prompt, timestamp, timestamp),
        )
        # Import messages if provided
        for msg in body.messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant", "system") and content:
                db.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (str(uuid4()), identifier, role, content, timestamp),
                )
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (identifier,)).fetchone()
    return dict(row)


@router.post("", status_code=201)
def create_conversation(body: ConversationCreate):
    identifier, timestamp = str(uuid4()), now()
    with connect() as db:
        db.execute(
            "INSERT INTO conversations (id, title, model, system_prompt, created_at, updated_at, pinned) "
            "VALUES (?, ?, ?, ?, ?, ?, 0)",
            (identifier, body.title.strip(), body.model, body.system_prompt, timestamp, timestamp),
        )
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (identifier,)).fetchone()
    return dict(row)


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str):
    with connect() as db:
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        messages = db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid", (conversation_id,)
        ).fetchall()
    return {**dict(row), "messages": [dict(message) for message in messages]}


@router.patch("/{conversation_id}")
def rename_conversation(conversation_id: str, body: ConversationRename):
    with connect() as db:
        if body.system_prompt is not None:
            result = db.execute(
                "UPDATE conversations SET title = ?, system_prompt = ?, updated_at = ? WHERE id = ?",
                (body.title.strip(), body.system_prompt, now(), conversation_id),
            )
        else:
            result = db.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                (body.title.strip(), now(), conversation_id),
            )
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
    return dict(row)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str):
    with connect() as db:
        result = db.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")


@router.post("/{conversation_id}/pin", status_code=204)
def pin_conversation(conversation_id: str):
    """Pin a conversation to the top of the list."""
    with connect() as db:
        result = db.execute(
            "UPDATE conversations SET pinned = 1 WHERE id = ?",
            (conversation_id,),
        )
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")


@router.post("/{conversation_id}/unpin", status_code=204)
def unpin_conversation(conversation_id: str):
    """Unpin a conversation."""
    with connect() as db:
        result = db.execute(
            "UPDATE conversations SET pinned = 0 WHERE id = ?",
            (conversation_id,),
        )
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")


@router.get("/{conversation_id}/export")
def export_conversation(conversation_id: str, format: str = Query(default="markdown", pattern="^(markdown|json)$")):
    """Export a conversation in Markdown or JSON format."""
    with connect() as db:
        row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        messages = db.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid", (conversation_id,)
        ).fetchall()
    
    conv = dict(row)
    msgs = [dict(msg) for msg in messages]
    
    if format == "json":
        return {"conversation": conv, "messages": msgs}
    
    # Markdown export
    lines = [f"# {conv['title']}\n"]
    if conv.get('model'):
        lines.append(f"**Model:** {conv['model']}\n")
    if conv.get('system_prompt'):
        lines.append(f"**System Prompt:** {conv['system_prompt']}\n")
    lines.append(f"**Created:** {conv['created_at']}\n---\n")
    
    for msg in msgs:
        role_label = "You" if msg['role'] == 'user' else "Assistant"
        lines.append(f"## {role_label}\n")
        lines.append(msg['content'] + "\n")
        lines.append("---\n")
    
    return {"content": "\n".join(lines), "filename": f"{conv['title'].replace(' ', '_')}.md"}

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.database import connect

router = APIRouter(prefix="/api/tags", tags=["tags"])


def now() -> str:
    return datetime.now(UTC).isoformat()


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    color: str = Field(default="#6b7280", max_length=7)


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


@router.get("")
def list_tags():
    """List all tags."""
    with connect() as db:
        rows = db.execute(
            "SELECT t.*, COUNT(ct.conversation_id) as conversation_count "
            "FROM tags t LEFT JOIN conversation_tags ct ON t.id = ct.tag_id "
            "GROUP BY t.id ORDER BY t.name"
        ).fetchall()
    return {"tags": [dict(row) for row in rows]}


@router.post("", status_code=201)
def create_tag(body: TagCreate):
    """Create a new tag."""
    tag_id = str(uuid4())
    timestamp = now()
    with connect() as db:
        try:
            db.execute(
                "INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)",
                (tag_id, body.name.strip().lower(), body.color, timestamp),
            )
        except Exception as e:
            if "UNIQUE constraint failed" in str(e):
                raise HTTPException(status_code=409, detail="Tag with this name already exists.")
            raise
        row = db.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()
    return dict(row)


@router.put("/{tag_id}")
def update_tag(tag_id: str, body: TagUpdate):
    """Update a tag."""
    with connect() as db:
        row = db.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Tag not found.")

        data = body.model_dump(exclude_unset=True)
        if not data:
            return dict(row)

        set_clauses = []
        values = []
        for key, value in data.items():
            if key == "name":
                value = value.strip().lower()
            set_clauses.append(f"{key} = ?")
            values.append(value)

        try:
            db.execute(
                f"UPDATE tags SET {', '.join(set_clauses)} WHERE id = ?",
                values + [tag_id],
            )
        except Exception as e:
            if "UNIQUE constraint failed" in str(e):
                raise HTTPException(status_code=409, detail="Tag with this name already exists.")
            raise
        row = db.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone()
    return dict(row)


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: str):
    """Delete a tag and remove it from all conversations."""
    with connect() as db:
        result = db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Tag not found.")


# ---- Conversation-Tag Associations ----


class ConversationTagRequest(BaseModel):
    tag_ids: list[str]


@router.post("/{conversation_id}/tags")
def set_conversation_tags(conversation_id: str, body: ConversationTagRequest):
    """Set tags for a conversation (replaces existing tags)."""
    with connect() as db:
        # Verify conversation exists
        if not db.execute("SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Conversation not found.")

        # Verify all tags exist
        if body.tag_ids:
            placeholders = ",".join("?" for _ in body.tag_ids)
            existing = db.execute(
                f"SELECT id FROM tags WHERE id IN ({placeholders})",
                body.tag_ids,
            ).fetchall()
            existing_ids = {row["id"] for row in existing}
            for tag_id in body.tag_ids:
                if tag_id not in existing_ids:
                    raise HTTPException(status_code=404, detail=f"Tag '{tag_id}' not found.")

        # Remove existing tags
        db.execute("DELETE FROM conversation_tags WHERE conversation_id = ?", (conversation_id,))

        # Add new tags
        for tag_id in body.tag_ids:
            db.execute(
                "INSERT INTO conversation_tags (conversation_id, tag_id) VALUES (?, ?)",
                (conversation_id, tag_id),
            )

    # Return the updated tags
    with connect() as db:
        rows = db.execute(
            "SELECT t.* FROM tags t JOIN conversation_tags ct ON t.id = ct.tag_id "
            "WHERE ct.conversation_id = ?",
            (conversation_id,),
        ).fetchall()
    return {"tags": [dict(row) for row in rows]}


@router.get("/{conversation_id}/tags")
def get_conversation_tags(conversation_id: str):
    """Get tags for a conversation."""
    with connect() as db:
        if not db.execute("SELECT 1 FROM conversations WHERE id = ?", (conversation_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Conversation not found.")
        rows = db.execute(
            "SELECT t.* FROM tags t JOIN conversation_tags ct ON t.id = ct.tag_id "
            "WHERE ct.conversation_id = ?",
            (conversation_id,),
        ).fetchall()
    return {"tags": [dict(row) for row in rows]}


@router.get("/conversations/{tag_name}")
def list_conversations_by_tag(tag_name: str):
    """List conversations with a specific tag."""
    with connect() as db:
        rows = db.execute(
            "SELECT c.* FROM conversations c "
            "JOIN conversation_tags ct ON c.id = ct.conversation_id "
            "JOIN tags t ON ct.tag_id = t.id "
            "WHERE t.name = ? "
            "ORDER BY c.updated_at DESC",
            (tag_name.lower(),),
        ).fetchall()
    return {"conversations": [dict(row) for row in rows]}

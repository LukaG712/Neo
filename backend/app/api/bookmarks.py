from fastapi import APIRouter, HTTPException

from app.db.database import connect

router = APIRouter(prefix="/api/bookmarks", tags=["bookmarks"])


@router.get("/conversations/{conversation_id}")
def get_bookmarks(conversation_id: str):
    """Get all bookmarked messages for a conversation."""
    with connect() as db:
        # Check conversation exists
        conv = db.execute(
            "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        bookmarks = db.execute(
            """SELECT m.id, m.role, m.content, m.created_at, bm.created_at as bookmarked_at
            FROM bookmarks bm
            JOIN messages m ON bm.message_id = m.id
            WHERE bm.conversation_id = ?
            ORDER BY bm.created_at DESC""",
            (conversation_id,),
        ).fetchall()

    return {
        "bookmarks": [
            {
                "message_id": row["id"],
                "role": row["role"],
                "content": row["content"][:200],  # Truncate for list view
                "created_at": row["created_at"],
                "bookmarked_at": row["bookmarked_at"],
            }
            for row in bookmarks
        ]
    }


@router.post("/conversations/{conversation_id}/messages/{message_id}")
def bookmark_message(conversation_id: str, message_id: str):
    """Bookmark a message in a conversation."""
    with connect() as db:
        # Check message exists
        msg = db.execute(
            "SELECT id FROM messages WHERE id = ? AND conversation_id = ?",
            (message_id, conversation_id),
        ).fetchone()
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found.")

        # Check if already bookmarked
        existing = db.execute(
            "SELECT id FROM bookmarks WHERE conversation_id = ? AND message_id = ?",
            (conversation_id, message_id),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Message already bookmarked.")

        from datetime import UTC, datetime
        from uuid import uuid4

        db.execute(
            """INSERT INTO bookmarks (id, conversation_id, message_id, created_at)
            VALUES (?, ?, ?, ?)""",
            (str(uuid4()), conversation_id, message_id, datetime.now(UTC).isoformat()),
        )

    return {"status": "bookmarked"}


@router.delete("/conversations/{conversation_id}/messages/{message_id}")
def remove_bookmark(conversation_id: str, message_id: str):
    """Remove a bookmark from a message."""
    with connect() as db:
        bookmark = db.execute(
            "SELECT id FROM bookmarks WHERE conversation_id = ? AND message_id = ?",
            (conversation_id, message_id),
        ).fetchone()
        if not bookmark:
            raise HTTPException(status_code=404, detail="Bookmark not found.")

        db.execute(
            "DELETE FROM bookmarks WHERE conversation_id = ? AND message_id = ?",
            (conversation_id, message_id),
        )

    return {"status": "removed"}

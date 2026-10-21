from fastapi import APIRouter, HTTPException

from app.db.database import connect

router = APIRouter(prefix="/api/stats", tags=["statistics"])


@router.get("/conversations/{conversation_id}")
def conversation_stats(conversation_id: str):
    """Get statistics for a conversation."""
    with connect() as db:
        # Check conversation exists
        conv = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        # Message counts by role
        user_count = db.execute(
            "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND role = 'user'",
            (conversation_id,),
        ).fetchone()["count"]

        assistant_count = db.execute(
            "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ? AND role = 'assistant'",
            (conversation_id,),
        ).fetchone()["count"]

        # Total tokens (eval_count sum)
        token_stats = db.execute(
            "SELECT SUM(eval_count) as total_tokens, SUM(eval_duration_ns) as total_eval_duration "
            "FROM messages WHERE conversation_id = ? AND role = 'assistant'",
            (conversation_id,),
        ).fetchone()

        total_tokens = token_stats["total_tokens"] or 0
        total_eval_duration = token_stats["total_eval_duration"] or 0

        # Average tokens per response
        avg_tokens = total_tokens // assistant_count if assistant_count > 0 else 0

        # Average speed (tokens per second)
        avg_speed = 0.0
        if total_eval_duration > 0 and total_tokens > 0:
            avg_speed = total_tokens / (total_eval_duration / 1e9)

        # Total characters in all messages
        char_stats = db.execute(
            "SELECT SUM(LENGTH(content)) as total_chars FROM messages WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
        total_chars = char_stats["total_chars"] or 0

    return {
        "conversation_id": conversation_id,
        "user_messages": user_count,
        "assistant_messages": assistant_count,
        "total_messages": user_count + assistant_count,
        "total_tokens": total_tokens,
        "average_tokens_per_response": avg_tokens,
        "average_speed_tokens_per_second": round(avg_speed, 1),
        "total_characters": total_chars,
    }


@router.get("/overview")
def overview_stats():
    """Get overview statistics for all conversations."""
    with connect() as db:
        # Total conversations
        conv_count = db.execute("SELECT COUNT(*) as count FROM conversations").fetchone()["count"]

        # Total messages
        msg_count = db.execute("SELECT COUNT(*) as count FROM messages").fetchone()["count"]

        # Total tokens generated
        token_stats = db.execute(
            "SELECT SUM(eval_count) as total_tokens FROM messages WHERE role = 'assistant'"
        ).fetchone()
        total_tokens = token_stats["total_tokens"] or 0

        # Total documents
        doc_count = db.execute("SELECT COUNT(*) as count FROM documents").fetchone()["count"]

        # Total presets
        preset_count = db.execute("SELECT COUNT(*) as count FROM presets").fetchone()["count"]

        # Total quick prompts
        prompt_count = db.execute("SELECT COUNT(*) as count FROM quick_prompts").fetchone()["count"]

    return {
        "conversations": conv_count,
        "messages": msg_count,
        "total_tokens": total_tokens,
        "documents": doc_count,
        "presets": preset_count,
        "quick_prompts": prompt_count,
    }

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db.database import connect

router = APIRouter(prefix="/api/prompts", tags=["quick_prompts"])


def now() -> str:
    return datetime.now(UTC).isoformat()


class PromptCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=5000)
    category: str = Field(default="general", max_length=50)


class PromptUpdate(BaseModel):
    title: str | None = None
    prompt: str | None = None
    category: str | None = None


@router.get("")
def list_prompts(category: str | None = Query(default=None, max_length=50)):
    """List all quick prompts, optionally filtered by category."""
    with connect() as db:
        if category:
            rows = db.execute(
                "SELECT * FROM quick_prompts WHERE category = ? ORDER BY title",
                (category,),
            ).fetchall()
        else:
            rows = db.execute("SELECT * FROM quick_prompts ORDER BY title").fetchall()
    return {"prompts": [dict(row) for row in rows]}


@router.get("/categories")
def list_categories():
    """List all prompt categories."""
    with connect() as db:
        rows = db.execute(
            "SELECT DISTINCT category FROM quick_prompts ORDER BY category"
        ).fetchall()
    return {"categories": [row["category"] for row in rows]}


@router.post("", status_code=201)
def create_prompt(body: PromptCreate):
    """Create a new quick prompt."""
    prompt_id = str(uuid4())
    timestamp = now()
    with connect() as db:
        db.execute(
            "INSERT INTO quick_prompts (id, title, prompt, category, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (prompt_id, body.title, body.prompt, body.category.lower(), timestamp, timestamp),
        )
        row = db.execute("SELECT * FROM quick_prompts WHERE id = ?", (prompt_id,)).fetchone()
    return dict(row)


@router.get("/{prompt_id}")
def get_prompt(prompt_id: str):
    """Get a quick prompt by ID."""
    with connect() as db:
        row = db.execute("SELECT * FROM quick_prompts WHERE id = ?", (prompt_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Prompt not found.")
    return dict(row)


@router.put("/{prompt_id}")
def update_prompt(prompt_id: str, body: PromptUpdate):
    """Update a quick prompt."""
    with connect() as db:
        row = db.execute("SELECT * FROM quick_prompts WHERE id = ?", (prompt_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Prompt not found.")

        data = body.model_dump(exclude_unset=True)
        if not data:
            return dict(row)

        set_clauses = []
        values = []
        for key, value in data.items():
            if key == "category":
                value = value.lower()
            set_clauses.append(f"{key} = ?")
            values.append(value)

        set_clauses.append("updated_at = ?")
        values.append(now())
        values.append(prompt_id)

        db.execute(
            f"UPDATE quick_prompts SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )
        row = db.execute("SELECT * FROM quick_prompts WHERE id = ?", (prompt_id,)).fetchone()
    return dict(row)


@router.delete("/{prompt_id}", status_code=204)
def delete_prompt(prompt_id: str):
    """Delete a quick prompt."""
    with connect() as db:
        result = db.execute("DELETE FROM quick_prompts WHERE id = ?", (prompt_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Prompt not found.")

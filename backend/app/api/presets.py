from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.database import connect

router = APIRouter(prefix="/api/presets", tags=["presets"])


def now() -> str:
    return datetime.now(UTC).isoformat()


class PresetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=160)
    system_prompt: str | None = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1, le=32768)


class PresetUpdate(BaseModel):
    name: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


@router.get("")
def list_presets():
    """List all saved presets."""
    with connect() as db:
        rows = db.execute("SELECT * FROM presets ORDER BY created_at DESC").fetchall()
    return {"presets": [dict(row) for row in rows]}


@router.post("", status_code=201)
def create_preset(body: PresetCreate):
    """Create a new preset."""
    preset_id = str(uuid4())
    timestamp = now()
    with connect() as db:
        db.execute(
            "INSERT INTO presets (id, name, model, system_prompt, temperature, max_tokens, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (preset_id, body.name, body.model, body.system_prompt, body.temperature, body.max_tokens, timestamp, timestamp),
        )
        row = db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,)).fetchone()
    return dict(row)


@router.get("/{preset_id}")
def get_preset(preset_id: str):
    """Get a preset by ID."""
    with connect() as db:
        row = db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Preset not found.")
    return dict(row)


@router.put("/{preset_id}")
def update_preset(preset_id: str, body: PresetUpdate):
    """Update a preset."""
    with connect() as db:
        row = db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Preset not found.")
        
        data = body.model_dump(exclude_unset=True)
        if not data:
            return dict(row)
        
        set_clauses = []
        values = []
        for key, value in data.items():
            set_clauses.append(f"{key} = ?")
            values.append(value)
        
        set_clauses.append("updated_at = ?")
        values.append(now())
        values.append(preset_id)
        
        db.execute(
            f"UPDATE presets SET {', '.join(set_clauses)} WHERE id = ?",
            values,
        )
        row = db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,)).fetchone()
    return dict(row)


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: str):
    """Delete a preset."""
    with connect() as db:
        result = db.execute("DELETE FROM presets WHERE id = ?", (preset_id,))
        if not result.rowcount:
            raise HTTPException(status_code=404, detail="Preset not found.")

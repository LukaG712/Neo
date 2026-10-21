import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api.chat import router as chat_router
from app.api.conversations import router as conversations_router
from app.api.messages import router as messages_router
from app.api.playground import router as playground_router
from app.api.providers import router as providers_router
from app.api.tools import router as tools_router
from app.core.config import settings
from app.core.providers import ProviderRegistry
from app.db.database import get_db, init_db
from app.ollama.client import OllamaClient, OllamaUnavailable

# ---------------------------------------------------------------------------
# Resolve the frontend dist folder.  During development it lives next to
# backend/; inside a PyInstaller bundle it is extracted to _MEIPASS.
# ---------------------------------------------------------------------------
import sys as _sys

_backend_root = Path(__file__).resolve().parent

if getattr(_sys, "frozen", False):
    # Running inside a PyInstaller bundle - _MEIPASS holds the extracted files
    _meipass = Path(getattr(_sys, "_MEIPASS", ""))
    _frontend_dist = _meipass / "frontend" / "dist"
else:
    # Development: project root is one level up from backend/app/
    _project_root = _backend_root.parents[1]
    _frontend_dist = _project_root / "frontend" / "dist"


def _frontend_available() -> bool:
    return (_frontend_dist / "index.html").is_file()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.ollama = OllamaClient(
        settings.ollama_base_url,
        settings.request_timeout_seconds,
    )
    app.state.providers = ProviderRegistry(settings)
    yield
    await app.state.ollama.close()
    await app.state.providers.close()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "app://.",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(conversations_router)
app.include_router(messages_router)
app.include_router(chat_router)
app.include_router(playground_router)
app.include_router(providers_router)
app.include_router(tools_router)


# ---------------------------------------------------------------------------
# Serve the React SPA (frontend/dist) for any non-API route.
# This allows pywebview / Electron to load the app from the same origin.
# ---------------------------------------------------------------------------

@app.get("/", include_in_schema=False)
async def serve_spa_root():
    """Serve the React SPA index.html for the root path."""
    if _frontend_available():
        return FileResponse(_frontend_dist / "index.html")
    return HTTPException(status_code=404, detail="Frontend not built. Run 'npm run build' in frontend/.")


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    """Serve static files from frontend/dist, falling back to index.html for SPA routing."""
    # Skip API routes - they are handled by their own routers
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    if not _frontend_available():
        return HTTPException(status_code=404, detail="Frontend not built.")

    # Try to serve the exact file
    file_path = _frontend_dist / full_path
    if file_path.is_file() and file_path.is_relative_to(_frontend_dist):
        return FileResponse(file_path)

    # Fall back to index.html for SPA client-side routing
    return FileResponse(_frontend_dist / "index.html")


@app.get("/api/health")
async def health(request: Request):
    registry: ProviderRegistry = request.app.state.providers
    db_ok = False
    try:
        with get_db() as db:
            db.execute("SELECT 1").fetchone()
            db_ok = True
    except (sqlite3.Error, OSError):
        db_ok = False

    return {
        "status": "ok" if db_ok else "degraded",
        "app": settings.app_name,
        "database": "connected" if db_ok else "error",
        "providers": [p["id"] for p in registry.list() if p["configured"]],
    }


@app.get("/api/ollama/status")
async def ollama_status(request: Request):
    try:
        return await request.app.state.ollama.status()
    except OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/ollama/models")
async def ollama_models(request: Request):
    try:
        return {"models": await request.app.state.ollama.list_models()}
    except OllamaUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

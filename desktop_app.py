"""
Neo - Desktop Launcher

Runs the FastAPI backend in a background thread and displays the React frontend
inside a native OS window using pywebview.  No browser tab, no PowerShell window.
"""

import os
import sys
import threading
import time
import webview
from pathlib import Path

# ---------------------------------------------------------------------------
# Resolve paths that work both during development and inside a PyInstaller
# bundle (--onedir).
# ---------------------------------------------------------------------------
if getattr(sys, "frozen", False):
    # Running inside a PyInstaller --onedir .exe
    # _MEIPASS is the temp extraction directory containing all bundled files
    base_dir = Path(sys._MEIPASS)  # type: ignore[attr-defined]
    # Data directory lives next to the .exe so user data persists
    exe_dir = Path(sys.executable).parent  # type: ignore[attr-defined]
    DATA_DIR = exe_dir / "data"
else:
    base_dir = Path(__file__).resolve().parent
    DATA_DIR = base_dir / "data"

DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Environment preparation - point the backend at a local-only port and the
# correct database path.
# ---------------------------------------------------------------------------
os.environ.setdefault("LACC_HOST", "127.0.0.1")
os.environ.setdefault("LACC_PORT", "0")  # 0 ? pick a free port
os.environ.setdefault("LACC_DATABASE_URL", f"sqlite:///{DATA_DIR}/Neo.db")

# Make sure the backend 'app' package is importable
# In PyInstaller bundle, 'app' is in _internal/app (which is base_dir/_MEIPASS)
# In development, 'app' is in backend/app
if getattr(sys, "frozen", False):
    sys.path.insert(0, str(base_dir))
else:
    # Development: backend/app needs to be importable
    sys.path.insert(0, str(base_dir / "backend"))
    sys.path.insert(0, str(base_dir))

# ---------------------------------------------------------------------------
# Start the FastAPI backend in a daemon thread.
# ---------------------------------------------------------------------------

def start_backend() -> int:
    """Start the backend in a background thread and return the port it's listening on."""
    import uvicorn
    from app.core.config import settings
    from app.main import app as fastapi_app

    host = settings.host
    requested_port = settings.port

    ready_event = threading.Event()
    port_holder: list = [requested_port]

    class BackendServer(uvicorn.Server):
        def install_signal_handlers(self):
            # Disable signal handlers in non-main thread
            pass

        def on_startup(self, sockets=None):
            super().on_startup(sockets)
            if sockets:
                sock = sockets[0]
                port_holder[0] = sock.getsockname()[1]
            ready_event.set()

    config = uvicorn.Config(
        fastapi_app,
        host=host,
        port=requested_port,
        log_level="warning",
        access_log=False,
        loop="asyncio",
    )
    server = BackendServer(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    if not ready_event.wait(timeout=10):
        print("Warning: Backend did not start in time")
        return requested_port

    port = port_holder[0]
    print(f"Backend started on {host}:{port}")
    return port


# ---------------------------------------------------------------------------
# PyWebView application
# ---------------------------------------------------------------------------

def create_window(port: int) -> None:
    """Create and show the desktop window."""
    api_url = f"http://127.0.0.1:{port}"

    webview.settings["ALLOW_DOWNLOADS"] = True

    window = webview.create_window(
        "Neo",
        api_url,
        width=1200,
        height=800,
        min_size=(900, 600),
        resizable=True,
        fullscreen=False,
        background_color="#1a1b26",
    )

    webview.start()


def main() -> None:
    print("Starting Neo...")
    port = start_backend()
    # Give the backend a moment to fully initialize
    time.sleep(0.5)
    create_window(port)


if __name__ == "__main__":
    main()

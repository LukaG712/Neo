import os
from .base import BaseTool

# Default tools directory — can be overridden via env var
TOOLS_DIR = os.environ.get("NEO_TOOLS_DIR", os.path.expanduser("~"))


class FileReadTool(BaseTool):
    """Reads a local file from a configured directory."""

    @property
    def name(self) -> str:
        return "file_read"

    @property
    def description(self) -> str:
        return "Read the contents of a file. Use with the 'path' parameter (relative to the tools directory)."

    async def execute(self, path: str = "", **kwargs) -> str:
        if not path:
            return "Error: No file path provided."

        # Security: restrict to TOOLS_DIR
        target = os.path.realpath(os.path.join(TOOLS_DIR, path))
        if not target.startswith(os.path.realpath(TOOLS_DIR)):
            return "Error: Access denied — path outside allowed directory."

        if not os.path.isfile(target):
            return f"Error: File not found: {path}"

        try:
            with open(target, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            # Truncate very long files
            if len(content) > 50000:
                content = content[:50000] + "\n\n... [file truncated]"
            return content
        except Exception as exc:
            return f"Error: {exc}"

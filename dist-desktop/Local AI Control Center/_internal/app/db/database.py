import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

from app.core.config import settings


def database_path() -> Path:
    prefix = "sqlite:///"
    raw = settings.database_url.removeprefix(prefix)
    path = Path(raw)
    if not path.is_absolute():
        path = Path.cwd() / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(database_path(), timeout=10.0, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    if settings.sqlite_wal_mode:
        try:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = NORMAL")
        except sqlite3.DatabaseError:
            pass
    return connection


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context manager for database connections with automatic transaction management."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                model TEXT,
                provider TEXT DEFAULT 'ollama',
                system_prompt TEXT,
                temperature REAL DEFAULT 0.7,
                max_tokens INTEGER DEFAULT 4096,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                total_duration_ns INTEGER,
                prompt_duration_ns INTEGER,
                eval_count INTEGER,
                eval_duration_ns INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(conversation_id, role);
            CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
        """)

        # Run schema migrations for existing databases
        table_info = [row["name"] for row in db.execute("PRAGMA table_info(conversations)").fetchall()]
        if "provider" not in table_info:
            db.execute("ALTER TABLE conversations ADD COLUMN provider TEXT DEFAULT 'ollama'")
        if "system_prompt" not in table_info:
            db.execute("ALTER TABLE conversations ADD COLUMN system_prompt TEXT")
        if "temperature" not in table_info:
            db.execute("ALTER TABLE conversations ADD COLUMN temperature REAL DEFAULT 0.7")
        if "max_tokens" not in table_info:
            db.execute("ALTER TABLE conversations ADD COLUMN max_tokens INTEGER DEFAULT 4096")

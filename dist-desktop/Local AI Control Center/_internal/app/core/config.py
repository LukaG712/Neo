from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Orbis"
    ollama_base_url: str = "http://127.0.0.1:11434"
    database_url: str = "sqlite:///./data/orbis.db"
    host: str = "127.0.0.1"
    port: int = 8000
    request_timeout_seconds: float = 10.0
    read_timeout_seconds: float = 300.0

    # Cloud AI Providers
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    anthropic_api_key: str | None = None
    anthropic_base_url: str = "https://api.anthropic.com"
    gemini_api_key: str | None = None
    openrouter_api_key: str | None = None
    groq_api_key: str | None = None

    default_provider: str = "ollama"
    default_temperature: float = 0.7
    default_max_tokens: int = 4096
    sqlite_wal_mode: bool = True

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[3] / ".env",
        env_prefix="LACC_",
        extra="ignore",
    )


settings = Settings()

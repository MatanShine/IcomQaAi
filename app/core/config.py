from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    openai_api_key: str | None = Field(default=None, env="OPENAI_API_KEY")
    youtube_api_key: str | None = Field(default=None, env="YOUTUBE_API_KEY")
    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/postgres",
        env="DATABASE_URL",
    )
    index_file: str = Field(default="data/qa_database.index")
    embeddings_model: str = Field(default="intfloat/multilingual-e5-small")
    default_port: int = Field(default=5050)
    scraper_timeout: int = Field(default=60000, env="SCRAPER_TIMEOUT")
    scraper_max_retries: int = Field(default=3, env="SCRAPER_MAX_RETRIES")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

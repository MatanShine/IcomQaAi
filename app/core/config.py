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
    passages_file: str = Field(default="data/qa_database_passages.json")
    embeddings_model: str = Field(default="intfloat/multilingual-e5-base")
    default_port: int = Field(default=5050)

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

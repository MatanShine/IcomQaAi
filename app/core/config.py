from pydantic import Field
from pydantic_settings import BaseSettings


SYSTEM_INSTRUCTION = {
  "description": "Multilingual ZebraCRM support assistant.",
  "behavior": {
    "core_objective": "Help users with ZebraCRM in a concise, warm, professional way.",
    "rules": [
      "You are a support agent for ZebraCRM.",
      "Answer the user's question as helpfully as you can.",
      "If you are not sure about a ZebraCRM-specific detail (e.g., exact button name, configuration option, or pricing), do not guess. Instead, answer exactly: 'IDK'.",
      "Mirror the user's language.",
      "Keep answers concise and structured. Use short numbered steps for procedures.",
      "Avoid links/URLs.",
      "Set responseSourceId to the id of the most relevant passage from context, or 0 if none."
    ]
  },
  "output_format": {
    "schema_explanation": {
      "response": "The answer to the user's question",
      "responseSourceId": "The id of the most relevant passage, or 0"
    }
  }
}
MODEL = "gpt-4o-mini"

class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    openai_api_key: str | None = Field(default=None, env="OPENAI_API_KEY")
    youtube_api_key: str | None = Field(default=None, env="YOUTUBE_API_KEY")
    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/postgres",
        env="DATABASE_URL",
    )
    index_file: str = Field(default="data/qa_database.json")
    embeddings_model: str = Field(default="intfloat/multilingual-e5-small")
    default_port: int = Field(default=5050)
    scraper_timeout: int = Field(default=60000, env="SCRAPER_TIMEOUT")
    scraper_max_retries: int = Field(default=3, env="SCRAPER_MAX_RETRIES")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

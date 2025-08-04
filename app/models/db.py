from __future__ import annotations

from sqlalchemy import Column, Integer, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

connect_args = {}
if settings.database_url.startswith("sqlite"):  # pragma: no cover - used in tests
    connect_args["check_same_thread"] = False

engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


class QAItem(Base):
    __tablename__ = "qa_items"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, unique=True, nullable=False)
    question = Column(Text, nullable=True)
    answer = Column(Text, nullable=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)

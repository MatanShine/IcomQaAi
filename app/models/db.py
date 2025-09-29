from __future__ import annotations
from sqlalchemy import Column, Integer, String, Text, DateTime, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings
from datetime import datetime

connect_args = {}
if settings.database_url.startswith("sqlite"):  # pragma: no cover - used in tests
    connect_args["check_same_thread"] = False

engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()

class CustomerSupportChatbotData(Base):
    """Stores scraped customer support content (CS articles, YouTube captions, Postman docs)."""

    __tablename__ = "customer_support_chatbot_data"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, nullable=False)
    type = Column(String, nullable=False, default="unknown")
    question = Column(Text, nullable=True)
    answer = Column(Text, nullable=True)
    date_added = Column(DateTime, default=datetime.now(), nullable=False)


class CustomerSupportChatbotAI(Base):
    """Stores end-user questions answered by the AI along with context/history."""

    __tablename__ = "customer_support_chatbot_ai"

    id = Column(Integer, primary_key=True, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    context = Column(Text, nullable=True)
    history = Column(Text, nullable=True)
    tokens_sent = Column(Integer, nullable=True)
    tokens_received = Column(Integer, nullable=True)
    session_id = Column(String, nullable=False)
    date_asked = Column(DateTime, default=datetime.now(), nullable=False)


class SupportRequest(Base):
    """Stores customer support requests opened by end-users."""

    __tablename__ = "support_requests"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, nullable=False, index=True)
    date_added = Column(DateTime, server_default=datetime.now(), nullable=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)

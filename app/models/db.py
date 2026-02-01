from __future__ import annotations
from sqlalchemy import (
    Column,
    Integer,
    Float,
    String,
    Text,
    DateTime,
    JSON,
    ARRAY,
    ForeignKey,
    create_engine,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.exc import ProgrammingError
from app.core.config import settings
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

connect_args = {}
if settings.database_url.startswith("sqlite"):  # pragma: no cover - used in tests
    connect_args["check_same_thread"] = False

engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


class CustomerSupportChatbotData(Base):
    """Stores scraped customer support content (CS articles, YouTube captions, Postman docs)."""

    __tablename__ = "customer_support_chatbot_data"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    url = Column(String, nullable=False)
    type = Column(String, nullable=False, default="unknown")
    question = Column(Text, nullable=True)
    answer = Column(Text, nullable=True)
    categories = Column(ARRAY(String), nullable=True)  # List of category strings from breadcrumb
    date_added = Column(DateTime, default=lambda: datetime.now(), nullable=False)


class CustomerSupportChatbotAI(Base):
    """Stores end-user questions answered by the AI along with context/history."""

    __tablename__ = "customer_support_chatbot_ai"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    context = Column(Text, nullable=True)
    history = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    tokens_sent = Column(Integer, nullable=True)
    tokens_received = Column(Integer, nullable=True)
    session_id = Column(String, nullable=False)
    theme = Column(String, nullable=True)
    user_id = Column(String, nullable=True)
    date_asked = Column(DateTime, default=lambda: datetime.now(), nullable=False)
    duration = Column(Float, nullable=True)


class SupportRequest(Base):
    """Stores customer support requests opened by end-users."""

    __tablename__ = "support_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_id = Column(String, nullable=False, index=True)
    theme = Column(String, nullable=True)
    user_id = Column(String, nullable=True)
    date_added = Column(DateTime, default=lambda: datetime.now(), nullable=False)


class Ticket(Base):
    """Structured ticket created from agent interactions or user actions."""

    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # Session / user context
    session_id = Column(String, nullable=False, index=True)
    theme = Column(String, nullable=True)
    user_id = Column(String, nullable=True)

    # Ticket content
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="draft")  # draft/pending/approved

    # Arbitrary structured metadata (JSON)
    # Note: Using 'name' parameter to map to existing 'metadata' column in database
    # if it exists, while avoiding SQLAlchemy reserved attribute conflict
    ticket_metadata = Column("metadata", JSON, nullable=True)

    # Timestamps
    date_created = Column(DateTime, default=lambda: datetime.now(), nullable=False)
    date_updated = Column(
        DateTime,
        default=lambda: datetime.now(),
        onupdate=lambda: datetime.now(),
        nullable=False,
    )


class AgentRun(Base):
    """Top-level record for a single LangGraph agent run."""

    __tablename__ = "agent_runs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    session_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=True)
    theme = Column(String, nullable=True)

    # Lifecycle
    started_at = Column(
        DateTime, default=lambda: datetime.now(), nullable=False, index=True
    )
    finished_at = Column(DateTime, nullable=True)
    status = Column(
        String, nullable=False, default="success"
    )  # success/error/cancelled

    # Semantics
    root_question = Column(Text, nullable=True)
    final_outcome = Column(String, nullable=True)  # answered/ticket_built/out_of_scope


class AgentEvent(Base):
    """Fine-grained logging for agent node transitions and decisions."""

    __tablename__ = "agent_events"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)

    # Link to the parent run
    run_id = Column(
        Integer,
        ForeignKey("agent_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Timing and node information
    timestamp = Column(DateTime, default=lambda: datetime.now(), nullable=False)
    node_name = Column(String, nullable=True)

    # Event semantics
    event_type = Column(
        String, nullable=False
    )  # enter_node/exit_node/decision/llm_call/retrieval/ticket_created
    decision = Column(String, nullable=True)  # short label, e.g. route_to_action_router

    # Arbitrary structured payload (prompts, docs, ticket fields, etc.)
    payload = Column(JSON, nullable=True)


def _fix_auto_increment(table_name: str) -> None:
    """Fix auto-increment for a table by creating a sequence if it doesn't exist."""
    if not settings.database_url.startswith("postgresql"):
        return  # Only needed for PostgreSQL

    try:
        with engine.connect() as conn:
            with conn.begin():  # Start a transaction that auto-commits
                # Check if sequence exists
                result = conn.execute(
                    text(
                        f"SELECT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = '{table_name}_id_seq')"
                    )
                )
                sequence_exists = result.scalar()

                if not sequence_exists:
                    # Get the current max id
                    result = conn.execute(
                        text(f"SELECT COALESCE(MAX(id), 0) FROM {table_name}")
                    )
                    max_id = result.scalar() or 0

                    # Create sequence starting from max_id + 1
                    conn.execute(
                        text(
                            f"CREATE SEQUENCE {table_name}_id_seq START WITH {max_id + 1}"
                        )
                    )
                    logger.info(
                        f"Created sequence {table_name}_id_seq starting at {max_id + 1}"
                    )

                # Set the default value for the id column
                conn.execute(
                    text(
                        f"ALTER TABLE {table_name} ALTER COLUMN id SET DEFAULT nextval('{table_name}_id_seq')"
                    )
                )

                # Make sure the sequence is owned by the column
                conn.execute(
                    text(f"ALTER SEQUENCE {table_name}_id_seq OWNED BY {table_name}.id")
                )

                logger.info(f"Fixed auto-increment for table {table_name}")
    except ProgrammingError as e:
        logger.warning(f"Could not fix auto-increment for {table_name}: {e}")
        # If it fails, the table might not exist yet or already be correct
    except Exception as e:
        logger.error(f"Unexpected error fixing auto-increment for {table_name}: {e}")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    # Fix auto-increment for existing tables
    _fix_auto_increment("customer_support_chatbot_ai")
    _fix_auto_increment("customer_support_chatbot_data")
    _fix_auto_increment("support_requests")
    _fix_auto_increment("tickets")
    _fix_auto_increment("agent_runs")
    _fix_auto_increment("agent_events")

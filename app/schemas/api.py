from datetime import datetime

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(
        example="איך מוסיפים מידע ליומן?",
        description="The new message from the user",
    )
    session_id: str = Field(
        example="icrmsw_8940_1761630008.5447",
        description="Identifier for the user session",
    )


class ChatResponse(BaseModel):
    response: str


class OperationResponse(BaseModel):
    amount_added: int


class SupportRequestCreate(BaseModel):
    session_id: str = Field(
        example="icrmsw_8940_1761630008.5447",
        description="Identifier for the user session that will be escalated to support",
    )


class SupportRequestResponse(BaseModel):
    id: int
    session_id: str
    message_amount: int
    date_added: datetime
    theme: str | None = None
    user_id: str | None = None

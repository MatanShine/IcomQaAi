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
    theme: str | None = None
    user_id: str | None = None


class KnowledgeBaseItem(BaseModel):
    id: int
    url: str
    type: str
    question: str | None = None
    answer: str | None = None
    categories: list[str] | None = None
    date_added: str


class KnowledgeBaseListResponse(BaseModel):
    items: list[KnowledgeBaseItem]


class KnowledgeBaseUpsert(BaseModel):
    question: str
    answer: str
    url: str | None = None
    categories: list[str] | None = None

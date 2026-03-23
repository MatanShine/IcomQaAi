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
    open_ticket: int = Field(
        default=0,
        description="Set to 1 to generate a support ticket from conversation history",
    )
    is_test: bool = Field(
        default=False,
        description="Set to true when calling from Test Agent page to use testing prompt version",
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


class RunDiscoveryRequest(BaseModel):
    types: list[str] = Field(
        example=["cs", "pm", "yt"],
        description="Discovery types to run: cs (customer support), pm (postman), yt (youtube)",
    )

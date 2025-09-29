from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(
        example="איך מוסיפים אוטומציה ליומן?",
        description="The new message from the user",
    )
    session_id: str = Field(
        example="abc123",
        description="Identifier for the user session",
    )


class ChatResponse(BaseModel):
    response: str


class OperationResponse(BaseModel):
    amount_added: int

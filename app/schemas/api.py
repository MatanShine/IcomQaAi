from typing import List, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[str]] = None


class ChatResponse(BaseModel):
    response: str


class OperationResponse(BaseModel):
    amount_added: int

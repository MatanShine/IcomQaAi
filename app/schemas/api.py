# app/schemas/api.py
from pydantic import BaseModel
from typing import Any, List, Dict

class RebuildRequest(BaseModel):
    data_source: str  # e.g. path, URL, etc.

class AddDataRequest(BaseModel):
    records: List[Dict[str, Any]]

class ChatRequest(BaseModel):
    history: List[str]
    message: str

class ChatResponse(BaseModel):
    response: str

class OperationResponse(BaseModel):
    amount_added: int
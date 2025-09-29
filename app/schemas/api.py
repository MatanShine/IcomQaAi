from datetime import datetime

from pydantic import BaseModel, Field
from typing import List


class ChatRequest(BaseModel):
    history: List[str] = Field(
        default_factory=list,
        example=[
            "איך מנהלים את היומן?",
            "כדי לנהל את היומן, יש להיכנס ליומן האישי במערכת וללחוץ על הקישור \"ניהול\" בצד שמאל למעלה. שם ניתן להוסיף יומנים נוספים ולעדכן בהם פגישות. ניתן גם לראות יומנים של עובדים אחרים ולנהל את המשימות והאירועים שלהם.\n\nלפרטים נוספים, ראה: https://support.zebracrm.com/%d7%a0%d7%99%d7%94%d7%95%d7%9c-%d7%99%d7%95%d7%9e%d7%9f-%d7%94%d7%95%d7%a1%d7%a4%d7%aa-%d7%99%d7%95%d7%9e%d7%a0%d7%99%d7%9d-%d7%9c%d7%a2%d7%95%d7%91%d7%93/",
        ],
        description="List of previous messages in the conversation, alternating between user and assistant",
    )
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


class SupportRequestCreate(BaseModel):
    session_id: str = Field(
        example="abc123",
        description="Identifier for the user session that will be escalated to support",
    )


class SupportRequestResponse(BaseModel):
    id: int
    session_id: str
    message_amount: int
    date_added: datetime


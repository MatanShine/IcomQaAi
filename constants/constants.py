"""
Global constants for the IcomQaAi project.
Group related values logically and document them.
"""

# Data paths
DATA_PATH         = "data/qa_database.json"
INDEX_FILE        = 'data/qa_database.index'
PASSAGES_FILE     = 'data/qa_database_passages.json'

EMBEDDINGS_MODEL  = "intfloat/multilingual-e5-base"

# Scraping
MAX_RETRIES       = 3
REQUEST_TIMEOUT_S = 10

# API
DEFAULT_PORT      = 5050
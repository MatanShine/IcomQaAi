# Use official Python runtime as a parent image
FROM python:3.11-slim

# Install system dependencies (for FAISS and Playwright optional dependencies)
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential git && \
    rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy dependency specification first to leverage Docker layer caching
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port FastAPI will run on
EXPOSE 5050

# Ensure logs are sent straight to terminal without buffering
ENV PYTHONUNBUFFERED 1

# Default command to run the FastAPI server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5050"]

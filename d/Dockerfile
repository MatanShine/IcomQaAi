# Use official Playwright Python image which includes all system deps and browsers
# Pin to a stable Playwright release compatible with your requirements.txt
FROM mcr.microsoft.com/playwright/python:v1.45.0

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on

# Set work directory
WORKDIR /app

# Copy dependency specification first to leverage Docker layer caching
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port FastAPI will run on (see app/core/config.py default_port=5050)
EXPOSE 5050

# Default command to run the FastAPI server (README uses app.main:app)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5050"]

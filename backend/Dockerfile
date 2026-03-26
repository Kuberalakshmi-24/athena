FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=5000

# Set HuggingFace cache directory to persist models in the image
ENV HF_HOME=/app/.cache/huggingface
# Use offline mode to prevent unnecessary downloads at runtime
ENV HF_HUB_OFFLINE=0
ENV TRANSFORMERS_OFFLINE=0

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

# Pre-download HuggingFace models during build (speeds up startup)
RUN echo "Pre-downloading HuggingFace models..." && \
    python /app/download_models.py && \
    echo "Model download complete"

EXPOSE 5000

# For development: python src/app.py
# For production with gunicorn: gunicorn src.app:app --bind 0.0.0.0:$PORT
# Increased timeout to 300s to allow RAG service initialization on first request
CMD ["sh", "-c", "gunicorn src.app:app --bind 0.0.0.0:${PORT:-5000} --workers 1 --timeout 300 --keep-alive 70"]

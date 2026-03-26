FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=5000

# Optimize model loading - use offline mode to prevent memory-heavy downloads
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 5000

# For development: python src/app.py
# For production with gunicorn: gunicorn src.app:app --bind 0.0.0.0:$PORT
CMD ["sh", "-c", "gunicorn src.app:app --bind 0.0.0.0:${PORT:-5000} --workers 1 --timeout 120"]

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SKYBLINK_CACHE=/tmp/skyblink-cache \
    PORT=7860

WORKDIR /app
COPY requirements.txt .
COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY backend/ backend/
COPY frontend/ frontend/
COPY featured/ featured/

RUN useradd -m -u 1000 app && mkdir -p /tmp/skyblink-cache && chown -R app /tmp/skyblink-cache
USER app

EXPOSE 7860
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn skyblink.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]

# ---- 1. Build the React frontend -------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. Python runtime: FastAPI serves the API and the built frontend --------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STORAGE_DIR=/data \
    STATIC_DIR=/app/frontend/dist

# OCR (onnxruntime + OpenCV) needs libgomp, libGL and glib; curl is used by the health check.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/app backend/app
COPY data data
COPY seed seed
COPY eval eval
COPY --from=web /web/dist frontend/dist

RUN useradd --create-home --uid 10001 exhibit \
 && mkdir -p /data && chown -R exhibit:exhibit /data /app
USER exhibit

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:8080/api/health || exit 1
CMD ["python", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8080"]

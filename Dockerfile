# Single-image build: React/Three.js frontend + FastAPI backend served from
# one process/port, so the whole app is reachable over one HTTPS origin
# (required for browser webcam access) with zero CORS configuration.
#
# Build:  docker build -t shopper-panel .
# Run:    docker run -p 8000:8000 --env-file .env shopper-panel
# Deploy: push this Dockerfile to Render / Fly.io / AWS App Runner /
#         AWS Lightsail Containers - all of them build+run it as-is.

# ---- Stage 1: build the frontend static bundle ----
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: python runtime serving API + built frontend ----
FROM python:3.12-slim AS runtime
WORKDIR /app

# System deps for Pillow (used by the vision-agent image slicing) wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY convenience_store.glb ./convenience_store.glb
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Render/Fly/App Runner inject $PORT; default to 8000 for `docker run` locally.
ENV PORT=8000
EXPOSE 8000

# SQLite lives under backend/data/analytics.db - ephemeral unless the host
# mounts a persistent volume at /app/backend/data (see README "Deployment").
CMD ["sh", "-c", "python -m uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT}"]

# TableKeeper Stage 4 Dockerfile
#
# Build (from the repository root — the only context containing stage-1/..stage-4/):
#   docker build -f stage-4/Dockerfile -t tablekeeper-stage4 .
# Run:
#   docker run --rm -p 8080:8080 tablekeeper-stage4

# Pinned exact image: Node 24.21.0 on Alpine 3.24. Node 24 ships native
# TypeScript type stripping, node:sqlite and node:test built in, so the
# stage-1/stage-2 .ts sources run directly with no install step.
FROM node:24.21.0-alpine3.24

WORKDIR /app

# Copy only what the supervisor loads at runtime:
#   deploy/start.mjs spawns the composed backend (stage-1 + stage-2 sources)
#   and the frontend proxy (frontend/serve.mjs + static files).
# Stages 1-4 declare no runtime dependencies (only devDependencies), so there
# is no `npm ci` layer: nothing needs installing inside the image.
COPY stage-1/package.json ./stage-1/package.json
COPY stage-1/src/ ./stage-1/src/
COPY stage-2/package.json ./stage-2/package.json
COPY stage-2/src/ ./stage-2/src/
COPY stage-4/frontend/ ./stage-4/frontend/
COPY stage-4/deploy/ ./stage-4/deploy/

# Set environment
ENV NODE_ENV=production
ENV BACKEND_HOST=127.0.0.1
ENV BACKEND_PORT=3000
ENV FRONTEND_HOST=0.0.0.0
ENV FRONTEND_PORT=8080
ENV BACKEND_URL=http://127.0.0.1:3000
ENV DATABASE_PATH=/data/tablekeeper.db

# Writable home for the SQLite file (container-local, disposable state)
RUN mkdir -p /data

# Expose only the frontend port; the backend stays on 127.0.0.1:3000
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.FRONTEND_PORT || 8080) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start both services through the process supervisor
CMD ["node", "stage-4/deploy/start.mjs"]

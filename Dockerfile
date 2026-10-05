# ============================================================
# Nashash — multi-stage Dockerfile
#   Stage 1 (build):   install workspace, build studio + api-server
#   Stage 2 (runtime): install prod deps, copy dist, run node
# ============================================================

# ---------- Stage 1: build ----------
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

# OS build deps for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first (better Docker cache)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY artifacts/api-server/package.json       artifacts/api-server/
COPY artifacts/studio/package.json           artifacts/studio/
COPY artifacts/mockup-sandbox/package.json   artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json       lib/api-client-react/
COPY lib/api-spec/package.json               lib/api-spec/
COPY lib/api-zod/package.json                lib/api-zod/
COPY lib/db/package.json                     lib/db/
COPY scripts/package.json                    scripts/

RUN pnpm install --frozen-lockfile

# Copy the full source tree
COPY . .

# Build frontend then backend (order matches root package.json)
RUN pnpm --dir artifacts/studio     run build \
 && pnpm --dir artifacts/api-server run build

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runtime
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /app

ENV NODE_ENV=production

# KAYAN-FFMPEG: runtime needs ffmpeg + ffprobe for MP4 validation.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Manifests for prod install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY artifacts/api-server/package.json       artifacts/api-server/
COPY artifacts/studio/package.json           artifacts/studio/
COPY artifacts/mockup-sandbox/package.json   artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json       lib/api-client-react/
COPY lib/api-spec/package.json               lib/api-spec/
COPY lib/api-zod/package.json                lib/api-zod/
COPY lib/db/package.json                     lib/db/
COPY scripts/package.json                    scripts/

RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from stage 1
COPY --from=build /repo/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /repo/artifacts/studio/dist     ./artifacts/studio/dist
COPY entrypoint.sh ./entrypoint.sh

# Runtime directories (uploads expected by api-server)
RUN mkdir -p \
      uploads/videos uploads/actors/refs uploads/audio \
      uploads/renders uploads/subtitles uploads/temp uploads/canonical_faces \
      logs

# Non-root user
RUN chmod +x /app/entrypoint.sh && chown -R node:node /app
USER node

# PORT is provided by Northflank at runtime
ENV PORT=3000
EXPOSE 3000

CMD ["/app/entrypoint.sh"]

# Dockerfile — the app image (D116): our code + Node 24 + the libraries + the built dashboard
# page + the starting database. It runs the dashboard (api + page) and the daily job side by side
# (src/docker/runApp.js); the backfill runs in the same container on demand
# (`docker compose exec app npm start`).
#
# Built in two stages: the first installs everything and builds the page; the second keeps only
# what is needed to run (no build tools, no test libraries), so the image stays small.

# ---- Stage 1: install everything and build the dashboard page (web/dist) ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
# The package files first: Docker reuses this step while they don't change (faster rebuilds).
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Stage 2: what runs ----
FROM node:24-bookworm-slim
# Israel time for the log lines; the daily job's 03:00 uses Asia/Jerusalem itself (config.js).
ENV NODE_ENV=production \
    TZ=Asia/Jerusalem
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# The starting database (npm run docker:snapshot). The first `docker compose up -d` copies the
# db/ folder of the image into the empty "db" volume; later starts keep the volume's own data.
COPY --chown=node:node docker/seed/press-mentions.sqlite /app/db/press-mentions.sqlite
# Not root: the programs run as the "node" user that the Node image provides.
USER node
EXPOSE 3000
CMD ["node", "src/docker/runApp.js"]

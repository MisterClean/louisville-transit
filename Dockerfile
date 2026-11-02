FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/alerts/package.json apps/alerts/package.json
COPY apps/insights/package.json apps/insights/package.json
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3 sharp
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates unzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV TRANSIT_PUBLISH_ENABLED=false NODE_ENV=production PORT=3100 DATA_DIR=/data TRANSIT_DATA_DIR=/data/gtfs TRANSIT_STATE_DIR=/data/state TRANSIT_WEB_DIR=/data/web
EXPOSE 3100
CMD ["node", "scripts/server.mjs"]

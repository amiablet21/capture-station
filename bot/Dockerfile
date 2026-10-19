# The bot's image for Railway (or any Docker host). Built from the
# repository root: the bot reuses the app's Linnworks client and reorder
# maths from src/main. On Railway, set RAILWAY_DOCKERFILE_PATH=bot/Dockerfile
# and mount a volume at /data (the WhatsApp login, purchase log, caches).
FROM node:22-slim

# time zones by name for TZ (the evening list and every "day" follow it)
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src/main/linnworks.js src/main/sales-export.js src/main/chskus-csv.js src/main/xlsxwrite.js ./src/main/
COPY bot/package.json bot/package-lock.json ./bot/
RUN cd bot && npm ci --omit=dev
COPY bot/index.js ./bot/
COPY bot/lib ./bot/lib/

WORKDIR /app/bot
ENV DATA_DIR=/data
CMD ["node", "index.js"]

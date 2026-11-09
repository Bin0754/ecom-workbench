# syntax=docker/dockerfile:1
# ---- build the frontend ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
RUN npm ci --ignore-scripts --no-audit --no-fund && npm --prefix web ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-bookworm-slim
# Fonts are needed by librsvg (sharp) to render the overlay text on generated images.
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=5180 HOST=0.0.0.0 WB_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: sharp and onnxruntime-node ship prebuilt binaries; this also skips the web/ postinstall.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY scripts ./scripts
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5180)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]

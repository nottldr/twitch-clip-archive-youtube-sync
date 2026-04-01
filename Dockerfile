FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-alpine
WORKDIR /app
RUN corepack enable pnpm
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
VOLUME /app/data
VOLUME /archive
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "--import", "tsx", "server/index.ts"]

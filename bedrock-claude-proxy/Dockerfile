# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Non-root user for security
RUN addgroup -S proxy && adduser -S proxy -G proxy

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Remove dev artifacts before running
RUN rm -f .env

USER proxy

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "server.js"]

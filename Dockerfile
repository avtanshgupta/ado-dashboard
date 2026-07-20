# ---- build the SPA ----
FROM node:20-alpine AS webbuild
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- server runtime (serves the built SPA + API) ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ ./
# The server serves the SPA from ../web/dist (see index.js).
COPY --from=webbuild /app/web/dist /app/web/dist

# Hosted: no local `az`, so force token-paste sign-in, and persist per-user
# state (sessions/tokens/notifications) on a mounted volume so restarts don't
# wipe logins. Provide TOKEN_ENC_KEY (32 bytes, hex/base64) to encrypt tokens
# with a key held outside the data volume.
ENV DISABLE_AZ_FALLBACK=true \
    COOKIE_SECURE=true \
    DATA_DIR=/home/data
VOLUME ["/home/data"]
EXPOSE 4000

CMD ["node", "src/index.js"]

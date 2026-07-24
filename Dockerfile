# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    PORT=3000
WORKDIR /app/server
COPY package.json package-lock.json /app/
COPY server/package.json ./
RUN cd /app && npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/drizzle ./drizzle
COPY --from=build /app/web/dist /app/web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/index.js"]

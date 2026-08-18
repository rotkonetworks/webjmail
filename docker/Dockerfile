# Generic, self-hostable webjmail web client.
#   docker run -p 8080:80 ghcr.io/rotkonetworks/webjmail
# Open http://localhost:8080 and enter your JMAP email address.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:alpine
LABEL org.opencontainers.image.source="https://github.com/rotkonetworks/webjmail"
LABEL org.opencontainers.image.description="Fast, local-first JMAP email & calendar client (web)"
LABEL org.opencontainers.image.licenses="MIT"
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

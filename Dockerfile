# syntax=docker/dockerfile:1.7

FROM node:24-trixie AS build

ARG AIRI_VERSION=v0.11.3
ARG VITE_ENABLE_POSTHOG=false

ENV CI=true
ENV VITE_ENABLE_POSTHOG=${VITE_ENABLE_POSTHOG}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        curl \
        build-essential \
        python3 \
        python3-setuptools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN git clone \
    --filter=blob:none \
    --depth 1 \
    --branch "${AIRI_VERSION}" \
    https://github.com/moeru-ai/airi.git .

RUN corepack enable

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm -F @proj-airi/stage-web run build

FROM caddy:2-alpine AS runtime

ENV PORT=8080

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/stage-web/dist /srv

EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

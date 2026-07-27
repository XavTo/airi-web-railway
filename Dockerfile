# syntax=docker/dockerfile:1

FROM node:24-trixie AS build

ARG AIRI_REF=v0.11.3
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
    --branch "${AIRI_REF}" \
    https://github.com/moeru-ai/airi.git .

RUN corepack enable

RUN pnpm install --frozen-lockfile

# AIRI télécharge normalement ces ressources pendant vite build.
# On les télécharge avant avec curl et plusieurs tentatives afin d'éviter
# que les erreurs Cloudflare 520 interrompent la compilation.
RUN set -eux; \
    mkdir -p \
        /app/.cache/live2d/models \
        /app/.cache/vrm/models/AvatarSample-A \
        /app/.cache/vrm/models/AvatarSample-B; \
    curl -fL \
        --retry 12 \
        --retry-all-errors \
        --retry-delay 5 \
        --connect-timeout 30 \
        --max-time 900 \
        -o /app/.cache/live2d/models/hiyori_free_zh.zip \
        "https://dist.ayaka.moe/live2d-models/hiyori_free_zh.zip"; \
    curl -fL \
        --retry 12 \
        --retry-all-errors \
        --retry-delay 5 \
        --connect-timeout 30 \
        --max-time 900 \
        -o /app/.cache/live2d/models/hiyori_pro_zh.zip \
        "https://dist.ayaka.moe/live2d-models/hiyori_pro_zh.zip"; \
    curl -fL \
        --retry 12 \
        --retry-all-errors \
        --retry-delay 5 \
        --connect-timeout 30 \
        --max-time 900 \
        -o /app/.cache/vrm/models/AvatarSample-A/AvatarSample_A.vrm \
        "https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm"; \
    curl -fL \
        --retry 12 \
        --retry-all-errors \
        --retry-delay 5 \
        --connect-timeout 30 \
        --max-time 900 \
        -o /app/.cache/vrm/models/AvatarSample-B/AvatarSample_B.vrm \
        "https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm"; \
    test -s /app/.cache/live2d/models/hiyori_free_zh.zip; \
    test -s /app/.cache/live2d/models/hiyori_pro_zh.zip; \
    test -s /app/.cache/vrm/models/AvatarSample-A/AvatarSample_A.vrm; \
    test -s /app/.cache/vrm/models/AvatarSample-B/AvatarSample_B.vrm

RUN pnpm -F @proj-airi/stage-web run build

FROM nginx:stable-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/stage-web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

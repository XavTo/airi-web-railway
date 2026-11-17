# syntax=docker/dockerfile:1
FROM caddy:2.10.2-alpine AS caddy

FROM node:24.22.1-trixie AS build
ARG AIRI_REF=27ff2f65bfb56b82540e2a12c06925ec02049efe
ENV VITE_ENABLE_ANALYTICS=false VITE_WEB_APP_URL=/ NODE_OPTIONS=--max-old-space-size=6144
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential ca-certificates curl python3 python3-setuptools && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
RUN git init -q && git remote add origin https://github.com/moeru-ai/airi.git \
    && git fetch --depth=1 origin "$AIRI_REF" && git checkout --detach FETCH_HEAD
COPY deploy/patch-upstream.mjs /pack/patch-upstream.mjs
RUN node /pack/patch-upstream.mjs /app \
    && pnpm install --frozen-lockfile \
    && pnpm -F @proj-airi/stage-web run build \
    && pnpm -F @proj-airi/ui-server-auth run build

FROM node:24.22.1-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/apps ./server/apps
COPY --from=build /app/server/packages ./server/packages
COPY --from=build /app/packages/trace-kit ./packages/trace-kit
COPY --from=build /app/packages/stream-kit ./packages/stream-kit
COPY --from=build /app/apps/stage-web/dist /srv/stage
COPY --from=build /app/apps/ui-server-auth/dist /srv/accounts/ui
COPY deploy/bootstrap.mjs /app/server/apps/api/bootstrap.mjs
COPY deploy/start.mjs deploy/guard.mjs deploy/Caddyfile deploy/client.js /opt/airi/
RUN chown -R node:node /srv/stage
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini","-g","--"]
CMD ["node","/opt/airi/start.mjs"]

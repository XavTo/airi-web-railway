# syntax=docker/dockerfile:1

ARG AIRI_VERSION=0.10.2

# L'application AIRI est déjà entièrement compilée dans cette image.
FROM ghcr.io/moeru-ai/airi:${AIRI_VERSION}

# Remplace uniquement la configuration Nginx pour Railway.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

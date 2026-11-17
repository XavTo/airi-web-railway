#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
set -C
{
  printf 'OWNER_EMAIL=owner@example.net\n'
  for key in OWNER_PASSWORD APP_SECRET POSTGRES_PASSWORD REDIS_PASSWORD S3_SECRET; do
    printf '%s=%s\n' "$key" "$(openssl rand -hex 32)"
  done
} > .env
printf 'Variables créées dans .env\n'

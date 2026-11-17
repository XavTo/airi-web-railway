#!/usr/bin/env bash
set -euo pipefail
: "${OLLAMA_MODEL:=qwen2.5:1.5b}"
ollama serve &
pid=$!
trap 'kill "$pid" 2>/dev/null || true' EXIT
trap 'exit 0' INT TERM
# The server inherited the private-network binding. Use its loopback for CLI calls.
export OLLAMA_HOST=http://127.0.0.1:11434
until ollama list >/dev/null 2>&1; do
  kill -0 "$pid"
  sleep 2
done
if ! ollama show "$OLLAMA_MODEL" >/dev/null 2>&1; then
  ollama pull "$OLLAMA_MODEL"
fi
wait "$pid"

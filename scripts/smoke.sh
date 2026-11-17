#!/bin/sh
# Validates real model responses on a running deployment. Requires curl and jq.
set -eu
BASE="${1:-http://localhost:8080}"
: "${OWNER_EMAIL:?set OWNER_EMAIL}"
: "${OWNER_PASSWORD:?set OWNER_PASSWORD}"
CHAT="${OLLAMA_MODEL:-qwen2.5:1.5b}"
TTS="${TTS_MODEL:-hexgrad/Kokoro-82M}"
STT="${STT_MODEL:-Systran/faster-whisper-base}"
VOICE="${TTS_VOICE:-ff_siwis}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
umask 077
set +x
curl -fsS --retry 15 --retry-connrefused --retry-delay 5 "$BASE/healthz" >/dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/local/chat/v1/models")" = 401
jq -nc --arg email "$OWNER_EMAIL" --arg password "$OWNER_PASSWORD" '{email:$email,password:$password}' |
  curl -fsS -c "$WORK/session" -H "Origin: $BASE" -H 'Content-Type: application/json' -d @- "$BASE/api/auth/sign-in/email" >/dev/null
curl -fsS -b "$WORK/session" "$BASE/api/auth/get-session" | jq -e '.user.email != null' >/dev/null
for service in chat voice; do
  if [ "$service" = chat ]; then
    model="$CHAT"
  else
    model="$TTS"
  fi
  n=0
  until curl -fsS -b "$WORK/session" "$BASE/local/$service/v1/models" 2>/dev/null | jq -e --arg model "$model" '.data|any(.id==$model)' >/dev/null; do
    n=$((n + 1))
    if [ "$n" -ge 90 ]; then echo "Modèle non prêt : $model" >&2; exit 1; fi
    sleep 5
  done
done
jq -nc --arg model "$CHAT" '{model:$model,messages:[{role:"user",content:"Say hello."}],max_tokens:16}' |
  curl -fsS --max-time 120 -b "$WORK/session" -H 'Content-Type: application/json' -d @- "$BASE/local/chat/v1/chat/completions" |
  jq -e '.choices[0].message.content | length > 0' >/dev/null
jq -nc --arg model "$TTS" --arg voice "$VOICE" '{model:$model,voice:$voice,input:"Bonjour, comment allez-vous ? Ceci est un test audio.",response_format:"wav"}' |
  curl -fsS --max-time 120 -b "$WORK/session" -H 'Content-Type: application/json' -d @- "$BASE/local/voice/v1/audio/speech" >"$WORK/voice.wav"
test "$(wc -c <"$WORK/voice.wav")" -gt 1000
curl -fsS --max-time 120 -b "$WORK/session" -F "file=@$WORK/voice.wav" -F "model=$STT" -F language=fr "$BASE/local/voice/v1/audio/transcriptions" |
  jq -e '.text|length > 0' >/dev/null
printf 'Session, accès privé, chat, synthèse et transcription vérifiés.\n'

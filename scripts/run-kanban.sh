#!/usr/bin/env bash
set -euo pipefail

# Narrated Kanban board demo — demonstrates task lifecycle with TTS voice-over.
# Requires OPENAI_API_KEY environment variable for TTS narration.

MODE="${B2V_MODE:-human}"
RECORD="${B2V_RECORD:-screencast}"
VOICE="${B2V_VOICE:-nova}"
SPEED="${B2V_SPEED:-1.0}"

echo "[b2v] Kanban narrated demo"
echo "[b2v] mode=${MODE} record=${RECORD} voice=${VOICE} speed=${SPEED}"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "[b2v] WARNING: OPENAI_API_KEY not set — narration will be disabled."
  echo "[b2v] Set it with: export OPENAI_API_KEY=sk-..."
fi

# Ensure deps are built
pnpm build

pnpm b2v run \
  --scenario kanban \
  --mode "${MODE}" \
  --record "${RECORD}" \
  --headed \
  --narrate \
  --voice "${VOICE}" \
  --narrate-speed "${SPEED}"

#!/usr/bin/env bash
set -euo pipefail

MODE="${B2V_MODE:-human}"
RECORD="${B2V_RECORD:-screen}"
DISPLAY_SIZE="${B2V_DISPLAY_SIZE:-2560x720}"

echo "[b2v] Collab auto runner"
echo "[b2v] mode=${MODE} record=${RECORD} displaySize=${DISPLAY_SIZE}"

run_native() {
  echo "[b2v] Trying native run..."

  # Ensure deps are built: CLI imports dist exports of workspace packages.
  pnpm build

  if [ "$(uname -s)" = "Linux" ]; then
    # If there's no display, prefer xvfb-run if available; otherwise let it fail and fallback to Docker.
    if [ "${DISPLAY:-}" = "" ] && command -v xvfb-run >/dev/null 2>&1; then
      xvfb-run -a --server-args="-screen 0 ${DISPLAY_SIZE}x24" \
        pnpm b2v run --scenario collab --mode "${MODE}" --record "${RECORD}" --headed --display-size "${DISPLAY_SIZE}"
      return
    fi

    pnpm b2v run --scenario collab --mode "${MODE}" --record "${RECORD}" --headed --display-size "${DISPLAY_SIZE}"
    return
  fi

  # macOS / Windows: native run (screen recording permissions may be required on macOS)
  pnpm b2v run --scenario collab --mode "${MODE}" --record "${RECORD}" --headed
}

if run_native; then
  echo "[b2v] Native run succeeded."
  exit 0
fi

echo "[b2v] Native run failed; falling back to Docker..."
bash scripts/run-collab-docker.sh


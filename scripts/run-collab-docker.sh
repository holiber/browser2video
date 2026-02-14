#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="browser2video-collab"

if [ "${B2V_DOCKER_PLATFORM:-}" != "" ]; then
  docker build --platform "$B2V_DOCKER_PLATFORM" -f Dockerfile.collab -t "$IMAGE_NAME" .
else
  docker build -f Dockerfile.collab -t "$IMAGE_NAME" .
fi

# Ensure artifacts dir exists on host
mkdir -p artifacts

if [ "${B2V_DOCKER_PLATFORM:-}" != "" ]; then
  docker run --rm \
    --platform "$B2V_DOCKER_PLATFORM" \
    --shm-size=2g \
    -v "$(pwd)/artifacts:/app/artifacts" \
    "$IMAGE_NAME"
else
  docker run --rm \
    --shm-size=2g \
    -v "$(pwd)/artifacts:/app/artifacts" \
    "$IMAGE_NAME"
fi


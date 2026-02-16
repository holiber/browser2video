FROM node:22-bookworm-slim

WORKDIR /app

# System deps for Chromium, video recording, TUI apps, and native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  xvfb \
  xauth \
  xterm \
  mc \
  htop \
  vim \
  fonts-liberation \
  ca-certificates \
  python3 \
  make \
  g++ \
  && rm -rf /var/lib/apt/lists/*

# Use pnpm via corepack
RUN corepack enable

# Copy workspace manifests first for better Docker layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages/browser2video/package.json ./packages/browser2video/
COPY apps/demo/package.json ./apps/demo/
COPY tests/scenarios/package.json ./tests/scenarios/

RUN pnpm install --frozen-lockfile

# Install Playwright Chromium (matches the pinned Playwright version)
RUN npx playwright install --with-deps chromium

# Copy the rest of the repo
COPY . .

ENV DISPLAY=:99

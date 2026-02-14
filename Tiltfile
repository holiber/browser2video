docker_build(
  "browser2video-collab",
  ".",
  dockerfile="Dockerfile.collab",
  live_update=[
    # Fast inner loop: sync code without rebuilding the image.
    sync("apps/demo", "/app/apps/demo"),
    sync("packages", "/app/packages"),
    sync("tests", "/app/tests"),
    sync("docs", "/app/docs"),
    sync("pnpm-workspace.yaml", "/app/pnpm-workspace.yaml"),
    sync("tsconfig.base.json", "/app/tsconfig.base.json"),
    sync("tsconfig.json", "/app/tsconfig.json"),
    sync("package.json", "/app/package.json"),
    sync("pnpm-lock.yaml", "/app/pnpm-lock.yaml"),

    # If deps changed, re-install in the running container.
    run("pnpm install --frozen-lockfile", trigger=["package.json", "pnpm-lock.yaml"]),
  ],
  ignore=["artifacts", "node_modules", "dist", ".git"],
)

# One-shot runner. On code changes, Tilt will live-update the image layer and you can re-run this resource.
# (Tilt doesn't automatically rerun it every sync; it keeps the fast edit loop without surprise reruns.)
local_resource(
  "collab-run",
  "docker run --rm --shm-size=2g -v \"$(pwd)/artifacts:/app/artifacts\" browser2video-collab",
  resource_deps=["browser2video-collab"],
  deps=["apps/demo", "packages", "tests", "docs", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
)


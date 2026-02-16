---
title: "Server API"
sidebar_position: 4
---

# Server API

## `startServer`

> Start a local web server.

Starts a web server based on the configuration: Vite dev server, Next.js, a custom shell command, or a static file server. Returns a `ManagedServer` with the base URL and a stop() function.

### Parameters

- `(input)` (`object | object | object | object | null`, **required**) — Server configuration for scenarios that need a local web server.

### Examples

**Start Vite**

```ts
const server = await startServer({ type: "vite", root: "apps/demo" });
```

**Start custom server**

```ts
const server = await startServer({ type: "command", cmd: "node server.js", port: 3000 });
```

---

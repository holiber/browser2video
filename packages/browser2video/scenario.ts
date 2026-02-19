/**
 * @description Declarative scenario builder for Browser2Video.
 *
 * Allows defining steps without `await` so the full workflow graph
 * is available immediately — used by the player app and compatible
 * with headless batch execution via `runScenario()`.
 *
 * ```ts
 * import { defineScenario } from "browser2video";
 *
 * export default defineScenario("My Scenario", (s) => {
 *   s.setup(async (session) => {
 *     const { actor } = await session.openPage({ url: "https://example.com" });
 *     return { actor };
 *   });
 *
 *   s.step("Open page", async ({ actor }) => {
 *     await actor.waitFor("h1");
 *   });
 *
 *   s.step("Click link", "Narration text", async ({ actor }) => {
 *     await actor.click("a");
 *   });
 * });
 * ```
 */
import path from "node:path";
import type { Session } from "./session.ts";
import type { SessionOptions, SessionResult } from "./types.ts";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface StepDescriptor<T = any> {
  caption: string;
  narration?: string;
  run: (ctx: T) => Promise<void>;
}

export interface ScenarioDescriptor<T = any> {
  name: string;
  setupFn: (session: Session) => Promise<T>;
  steps: StepDescriptor<T>[];
}

export interface ScenarioBuilder<T> {
  setup(fn: (session: Session) => Promise<T>): void;
  step(caption: string, run: (ctx: T) => Promise<void>): void;
  step(caption: string, narration: string, run: (ctx: T) => Promise<void>): void;
}

// ---------------------------------------------------------------------------
//  defineScenario
// ---------------------------------------------------------------------------

export function defineScenario<T>(
  name: string,
  builder: (s: ScenarioBuilder<T>) => void,
): ScenarioDescriptor<T> {
  const descriptor: ScenarioDescriptor<T> = {
    name,
    setupFn: async () => ({}) as T,
    steps: [],
  };

  const s: ScenarioBuilder<T> = {
    setup(fn) {
      descriptor.setupFn = fn;
    },
    step(
      caption: string,
      fnOrNarration: string | ((ctx: T) => Promise<void>),
      maybeFn?: (ctx: T) => Promise<void>,
    ) {
      const narration = typeof fnOrNarration === "string" ? fnOrNarration : undefined;
      const run = typeof fnOrNarration === "function" ? fnOrNarration : maybeFn!;
      descriptor.steps.push({ caption, narration, run });
    },
  };

  builder(s);
  return descriptor;
}

// ---------------------------------------------------------------------------
//  isScenarioDescriptor — runtime type guard
// ---------------------------------------------------------------------------

export function isScenarioDescriptor(value: unknown): value is ScenarioDescriptor {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.setupFn === "function" &&
    Array.isArray(obj.steps)
  );
}

// ---------------------------------------------------------------------------
//  runScenario — execute a descriptor as a batch recording
// ---------------------------------------------------------------------------

export async function runScenario<T>(
  descriptor: ScenarioDescriptor<T>,
  opts?: SessionOptions,
): Promise<SessionResult> {
  const { createSession } = await import("./session.ts");

  const slug = descriptor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultOutputDir = path.resolve("artifacts", `${slug}-${ts}`);

  const session = await createSession({
    outputDir: defaultOutputDir,
    ...opts,
  });
  const { step } = session;

  const ctx = await descriptor.setupFn(session);

  for (const s of descriptor.steps) {
    if (s.narration) {
      await step(s.caption, s.narration, () => s.run(ctx));
    } else {
      await step(s.caption, () => s.run(ctx));
    }
  }

  return session.finish();
}

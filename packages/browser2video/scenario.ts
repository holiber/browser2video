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
  /** Narration function that runs concurrently with `run`. Step waits for both. */
  narrationFn?: (ctx: T) => Promise<void>;
  run: (ctx: T) => Promise<void>;
}

export interface ScenarioDescriptor<T = any> {
  name: string;
  setupFn: (session: Session) => Promise<T>;
  steps: StepDescriptor<T>[];
  sessionOpts?: Partial<import("./types.ts").SessionOptions>;
}

export interface ScenarioBuilder<T> {
  setup(fn: (session: Session) => Promise<T>): void;
  /** Declare session-level options (layout, narration, etc.) applied when creating the session. */
  options(opts: Partial<import("./types.ts").SessionOptions>): void;
  step(caption: string, run: (ctx: T) => Promise<void>): void;
  step(caption: string, narration: string, run: (ctx: T) => Promise<void>): void;
  /**
   * Step with a narration function that runs concurrently with the step body.
   * The step waits for both the narration and body to complete before proceeding.
   * Use this for per-actor voices: `s.step("Title", ({a}) => a.speak("..."), async ({a}) => { ... })`
   */
  step(caption: string, narration: (ctx: T) => Promise<void>, run: (ctx: T) => Promise<void>): void;
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
    options(opts) {
      descriptor.sessionOpts = { ...descriptor.sessionOpts, ...opts };
    },
    step(
      caption: string,
      fnOrNarration: string | ((ctx: T) => Promise<void>),
      maybeFn?: (ctx: T) => Promise<void>,
    ) {
      if (typeof fnOrNarration === "function" && maybeFn) {
        // 3-arg form with narration function: step(caption, narrationFn, run)
        descriptor.steps.push({ caption, narrationFn: fnOrNarration, run: maybeFn });
      } else if (typeof fnOrNarration === "string") {
        // 3-arg form with narration string: step(caption, "text", run)
        descriptor.steps.push({ caption, narration: fnOrNarration, run: maybeFn! });
      } else {
        // 2-arg form: step(caption, run)
        descriptor.steps.push({ caption, run: fnOrNarration });
      }
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
    ...descriptor.sessionOpts,
    ...opts,
  });
  const { step } = session;

  const ctx = await descriptor.setupFn(session);

  for (const s of descriptor.steps) {
    if (s.narration) {
      await step(s.caption, s.narration, () => s.run(ctx));
    } else if (s.narrationFn) {
      // Narration function runs concurrently; step waits for both
      await step(s.caption, async () => {
        const narrationPromise = s.narrationFn!(ctx);
        await s.run(ctx);
        await narrationPromise;
      });
    } else {
      await step(s.caption, () => s.run(ctx));
    }
  }

  return session.finish();
}

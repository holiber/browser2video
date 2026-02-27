/**
 * @description Scene system — data-only descriptors for composable layouts.
 *
 * Scenes are pure data (no React dependency). The player resolves `type`
 * strings to React components at render time.  Built-in types:
 *   "grid"   — Dockview tabs/split (current createGrid behavior)
 *   "split"  — side-by-side children
 *   "iphone" — iPhone device frame with a single screen slot
 *   "laptop" — laptop frame with browser + terminal (Quake-style toggle)
 */

import type { GridPaneConfig } from "./terminal-ws-server.ts";

// ---------------------------------------------------------------------------
//  Slot & action primitives
// ---------------------------------------------------------------------------

export interface SlotConfig {
  type: "browser" | "terminal";
  url?: string;
  command?: string;
  label?: string;
  testId?: string;
}

export interface SceneAction {
  id: string;
  label: string;
  type: "toggle" | "trigger";
  defaultState?: boolean;
}

// ---------------------------------------------------------------------------
//  Scene descriptor (recursive tree)
// ---------------------------------------------------------------------------

export interface SceneDescriptor {
  /** Built-in: "grid" | "split" | "iphone" | "laptop" — or custom string */
  type: string;
  /** Display name shown in the scene panel */
  name: string;
  /** Named content slots (browser / terminal panes) */
  slots?: Record<string, SlotConfig>;
  /** Programmatic actions exposed to scenarios and the scene panel */
  actions?: SceneAction[];
  /** Child scenes (used by composite types like "split") */
  children?: SceneDescriptor[];
  /** Arbitrary props forwarded to the scene component */
  props?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
//  Resolved scene config (sent to the player via WebSocket)
// ---------------------------------------------------------------------------

export interface ResolvedSlot {
  type: "browser" | "terminal";
  testId: string;
  title: string;
  url?: string;
  cmd?: string;
  allowAddTab?: boolean;
}

export interface SceneConfig {
  scene: SceneDescriptor;
  resolvedSlots: ResolvedSlot[];
  viewport: { width: number; height: number };
  jabtermWsUrl: string;
  /** Flat list of GridPaneConfig for backward compat with ScenarioGrid */
  gridPanes?: GridPaneConfig[];
  gridLayout?: number[][];
}

// ---------------------------------------------------------------------------
//  Scene handle (returned from session.scenes.create)
// ---------------------------------------------------------------------------

export interface SceneHandle {
  /** Flat array of actors for all slots, in depth-first tree-walk order */
  actors: import("./terminal-actor.ts").TerminalActor[];
  /** The Playwright page rendering the scene */
  page: import("playwright").Page;
  /** Dispatch a scene action by scene name and action ID */
  dispatch: (sceneName: string, actionId: string, payload?: unknown) => void;
  /** The scene config sent to the player */
  config: SceneConfig;
}

// ---------------------------------------------------------------------------
//  Helper: defineScene
// ---------------------------------------------------------------------------

export function defineScene(desc: SceneDescriptor): SceneDescriptor {
  return desc;
}

// ---------------------------------------------------------------------------
//  Utilities: walk the scene tree
// ---------------------------------------------------------------------------

/** Depth-first traversal yielding all slots with their parent scene name */
export function* walkSlots(
  scene: SceneDescriptor,
): Generator<{ scene: SceneDescriptor; slotName: string; slot: SlotConfig }> {
  if (scene.slots) {
    for (const [name, slot] of Object.entries(scene.slots)) {
      yield { scene, slotName: name, slot };
    }
  }
  if (scene.children) {
    for (const child of scene.children) {
      yield* walkSlots(child);
    }
  }
}

/** Depth-first traversal yielding all scenes (including the root) */
export function* walkScenes(scene: SceneDescriptor): Generator<SceneDescriptor> {
  yield scene;
  if (scene.children) {
    for (const child of scene.children) {
      yield* walkScenes(child);
    }
  }
}

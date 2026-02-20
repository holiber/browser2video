/**
 * @description Replay log — records actor visual events (cursor moves, clicks,
 * key presses, step boundaries, audio) as JSONL for real-time streaming and
 * offline replay in the player's Live mode.
 */
import fs from "fs";
import path from "path";

export type ReplayEvent =
  | { type: "cursorMove"; x: number; y: number; ts: number }
  | { type: "click"; x: number; y: number; ts: number }
  | { type: "stepStart"; index: number; caption: string; ts: number }
  | { type: "stepEnd"; index: number; ts: number }
  | { type: "keyPress"; key: string; ts: number }
  | { type: "audio"; label: string; durationMs: number; ts: number };

export class ReplayLog {
  private events: ReplayEvent[] = [];

  /** Real-time callback — invoked synchronously for every emitted event */
  onEvent: ((event: ReplayEvent) => void) | null = null;

  emit(event: ReplayEvent): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  getEvents(): readonly ReplayEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }

  /** Write all buffered events to a JSONL file */
  save(dir: string): void {
    if (this.events.length === 0) return;
    const filePath = path.join(dir, "replay.jsonl");
    const lines = this.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(filePath, lines, "utf-8");
  }
}

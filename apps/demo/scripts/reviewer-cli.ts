/**
 * @description Reviewer CLI: connects to the same Automerge doc via WebSocket,
 * logs changes, and applies scripted CRUD/APPROVE commands.
 *
 * Intended to be run in CI with a visible terminal window (xterm tailing a log),
 * while the actual process receives commands via stdin from the test runner.
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import * as Automerge from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { Repo } from "@automerge/automerge-repo/slim";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

type Task = {
  id: string;
  title: string;
  completed: boolean;
  approved?: boolean;
};

type NotesDoc = {
  tasks: Task[];
};

type TaskSnapshot = {
  id: string;
  title: string;
  completed: boolean;
  approved: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (!k.startsWith("--")) continue;
    if (v && !v.startsWith("--")) {
      out[k.slice(2)] = v;
      i++;
    } else {
      out[k.slice(2)] = "true";
    }
  }
  return out;
}

function parseQuoted1(cmd: string): string | null {
  const m = cmd.match(/\"([^\"]+)\"/);
  return m ? m[1] : null;
}

function parseQuoted2(cmd: string): [string, string] | null {
  const m = cmd.match(/\"([^\"]+)\"\s+\"([^\"]+)\"/);
  return m ? [m[1], m[2]] : null;
}

async function main() {
  const a = parseArgs(process.argv);
  const wsUrl = a["ws"];
  const docUrlRaw = a["doc"];
  const logPath = a["log"] ?? path.join(process.cwd(), "reviewer.log");
  const pidfile = a["pidfile"];

  if (!wsUrl) throw new Error("Missing --ws ws://host:port");
  if (!docUrlRaw) throw new Error("Missing --doc #automerge:... URL");
  const docUrl = docUrlRaw.startsWith("#") ? docUrlRaw.slice(1) : docUrlRaw;

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const append = (line: string) => {
    const full = `${nowIso()} ${line}`;
    fs.appendFileSync(logPath, `${full}\n`, "utf-8");
    // Also print to stdout so it is visible when running in Terminal.app.
    // eslint-disable-next-line no-console
    console.log(full);
  };

  append(`[reviewer] starting; ws=${wsUrl}; doc=${docUrl}`);

  await Automerge.initializeBase64Wasm(automergeWasmBase64);

  const repo = new Repo({
    network: [new BrowserWebSocketClientAdapter(wsUrl)],
  });

  const handle: any = await repo.find<NotesDoc>(docUrl as any);
  await handle.whenReady?.();
  if (pidfile) {
    try {
      fs.mkdirSync(path.dirname(pidfile), { recursive: true });
      fs.writeFileSync(pidfile, String(process.pid), "utf-8");
    } catch (e) {
      append(`[warn] failed to write pidfile: ${(e as Error).message}`);
    }
  }

  const dump = (doc: NotesDoc | undefined, prefix = "[doc]") => {
    const tasks = doc?.tasks ?? [];
    append(`${prefix} tasks=${tasks.length}`);
  };

  // Initial snapshot
  let prevById = new Map<string, TaskSnapshot>();
  const snapshot = (doc: NotesDoc | undefined) => {
    const m = new Map<string, TaskSnapshot>();
    for (const t of doc?.tasks ?? []) {
      m.set(t.id, {
        id: t.id,
        title: t.title,
        completed: !!t.completed,
        approved: !!t.approved,
      });
    }
    return m;
  };

  const emitDiff = (prev: Map<string, TaskSnapshot>, next: Map<string, TaskSnapshot>) => {
    for (const [id, n] of next) {
      const p = prev.get(id);
      if (!p) {
        append(`[add] "${n.title}"`);
        continue;
      }
      const changes: string[] = [];
      if (p.title !== n.title) changes.push(`title="${p.title}"->"${n.title}"`);
      if (p.completed !== n.completed) changes.push(`completed=${n.completed}`);
      if (p.approved !== n.approved) changes.push(`approved=${n.approved}`);
      if (changes.length) append(`[update] "${n.title}" ${changes.join(" ")}`);
    }
    for (const [id, p] of prev) {
      if (!next.has(id)) append(`[delete] "${p.title}"`);
    }
  };

  const doc0: NotesDoc | undefined = await handle.doc?.();
  dump(doc0, "[ready]");
  prevById = snapshot(doc0);

  // React to changes using the DocHandle API (no docSync polling).
  if (typeof handle.on === "function") {
    handle.on("change", async () => {
      try {
        const doc = await handle.doc?.();
        const next = snapshot(doc);
        emitDiff(prevById, next);
        prevById = next;
      } catch (e) {
        append(`[warn] failed to read doc on change: ${(e as Error).message}`);
      }
    });
  }

  append('[reviewer] ready for commands: ADD/DELETE/RENAME/APPROVE/UNAPPROVE "..."');

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const cmd = line.trim();
    if (!cmd) return;
    append(`[cmd] ${cmd}`);

    const upper = cmd.split(/\s+/)[0]?.toUpperCase();
    try {
      if (upper === "ADD") {
        const title = parseQuoted1(cmd);
        if (!title) throw new Error('ADD requires: ADD "title"');
        handle.change((d: NotesDoc) => {
          const id = `reviewer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          d.tasks.unshift({ id, title, completed: false, approved: false });
        });
        append(`[ok] added "${title}"`);
        return;
      }

      if (upper === "DELETE") {
        const title = parseQuoted1(cmd);
        if (!title) throw new Error('DELETE requires: DELETE "title"');
        handle.change((d: NotesDoc) => {
          const idx = d.tasks.findIndex((t) => t.title === title);
          if (idx >= 0) d.tasks.splice(idx, 1);
        });
        append(`[ok] deleted "${title}" (if existed)`);
        return;
      }

      if (upper === "RENAME") {
        const pair = parseQuoted2(cmd);
        if (!pair) throw new Error('RENAME requires: RENAME "old" "new"');
        const [oldTitle, newTitle] = pair;
        handle.change((d: NotesDoc) => {
          const t = d.tasks.find((x) => x.title === oldTitle);
          if (t) t.title = newTitle;
        });
        append(`[ok] renamed "${oldTitle}" -> "${newTitle}"`);
        return;
      }

      if (upper === "APPROVE" || upper === "UNAPPROVE") {
        const title = parseQuoted1(cmd);
        if (!title) throw new Error(`${upper} requires: ${upper} "title"`);
        const approved = upper === "APPROVE";
        handle.change((d: NotesDoc) => {
          const t = d.tasks.find((x) => x.title === title);
          if (t) t.approved = approved;
        });
        append(`[ok] ${approved ? "approved" : "unapproved"} "${title}"`);
        return;
      }

      append(`[err] unknown command: ${cmd}`);
    } catch (err: any) {
      append(`[err] ${(err as Error).message}`);
    }
  });

  const shutdown = (sig: string) => {
    append(`[reviewer] received ${sig}, exiting`);
    try { rl.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

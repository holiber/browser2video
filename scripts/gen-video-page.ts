#!/usr/bin/env node
/**
 * Generate an HTML page that displays all scenario videos.
 *
 * Usage:
 *   node scripts/gen-video-page.ts [--out <path>] [--human-dir <dir>] [--fast-dir <dir>]
 *
 * Defaults:
 *   --out        artifacts/index.html
 *   --human-dir  (auto-detected from artifacts/)
 *   --fast-dir   (auto-detected from artifacts/)
 *
 * When used in CI (deploy-pages.yml):
 *   node scripts/gen-video-page.ts \
 *     --out website/build/videos/index.html \
 *     --human-dir . \
 *     --fast-dir ../videos-fast
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

interface ScenarioVideo {
  name: string;
  mode: "human" | "fast";
  videoPath: string;
  captionsPath: string;
}

function discoverLocalVideos(artifactsDir: string): ScenarioVideo[] {
  if (!fs.existsSync(artifactsDir)) return [];
  const videos: ScenarioVideo[] = [];
  const dirs = fs.readdirSync(artifactsDir).filter((d) =>
    fs.statSync(path.join(artifactsDir, d)).isDirectory(),
  );

  const byScenario = new Map<string, string[]>();
  for (const d of dirs) {
    const match = d.match(/^(.+?)\.test-(.+)$/);
    if (!match) continue;
    const mp4 = path.join(artifactsDir, d, "run.mp4");
    if (!fs.existsSync(mp4)) continue;
    const name = match[1];
    if (!byScenario.has(name)) byScenario.set(name, []);
    byScenario.get(name)!.push(d);
  }

  for (const [name, scenarioDirs] of byScenario) {
    // Sort by timestamp descending — latest first
    scenarioDirs.sort().reverse();
    // Read run.json metadata to determine mode, or infer from count
    for (const d of scenarioDirs) {
      const jsonPath = path.join(artifactsDir, d, "run.json");
      let mode: "human" | "fast" = "human";
      if (fs.existsSync(jsonPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
          mode = meta.mode === "fast" ? "fast" : "human";
        } catch { /* ignore */ }
      }

      const alreadyHasMode = videos.some((v) => v.name === name && v.mode === mode);
      if (alreadyHasMode) continue;

      videos.push({
        name,
        mode,
        videoPath: `./${d}/run.mp4`,
        captionsPath: `./${d}/captions.vtt`,
      });
    }
  }

  return videos;
}

function buildScenariosJson(
  videos: ScenarioVideo[],
  humanDir?: string,
  fastDir?: string,
): string {
  const scenarioNames = [...new Set(videos.map((v) => v.name))].sort();
  const obj: Record<string, Record<string, { path: string; vtt: string } | null>> = {};

  for (const name of scenarioNames) {
    obj[name] = { human: null, fast: null };
    for (const mode of ["human", "fast"] as const) {
      const v = videos.find((x) => x.name === name && x.mode === mode);
      if (v) obj[name][mode] = { path: v.videoPath, vtt: v.captionsPath };
    }
  }

  return JSON.stringify(obj, null, 2);
}

function buildCiScenariosJson(
  scenarios: string[],
  humanDir: string,
  fastDir: string,
): string {
  const obj: Record<string, Record<string, { path: string; vtt: string }>> = {};
  for (const s of scenarios) {
    obj[s] = {
      human: { path: `${humanDir}/${s}/run.mp4`, vtt: `${humanDir}/${s}/captions.vtt` },
      fast: { path: `${fastDir}/${s}/run.mp4`, vtt: `${fastDir}/${s}/captions.vtt` },
    };
  }
  return JSON.stringify(obj, null, 2);
}

function generateHtml(scenariosJson: string, scenarioOrder: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>browser2video — Scenario Videos</title>
<style>
  :root { --bg: #0a0a0a; --card: #161616; --border: #2a2a2a; --text: #e0e0e0; --muted: #888; --accent: #6b9eff; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 2rem; }
  h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem; }
  .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: 0.95rem; }
  .scenario { margin-bottom: 2.5rem; }
  .scenario h2 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .video-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(480px, 1fr)); gap: 1rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .card video { width: 100%; display: block; background: #000; }
  .card-info { padding: 0.6rem 0.85rem; display: flex; justify-content: space-between; align-items: center; }
  .card-title { font-size: 0.9rem; }
  .badge { font-size: 0.65rem; padding: 2px 8px; border-radius: 6px; font-weight: 600; text-transform: uppercase; }
  .badge-human { background: #1f6feb33; color: #58a6ff; }
  .badge-fast { background: #23863633; color: #3fb950; }
  .card-links { display: flex; gap: 0.75rem; }
  .card-links a { color: var(--accent); text-decoration: none; font-size: 0.8rem; }
  .card-links a:hover { text-decoration: underline; }
  .missing { padding: 40px; text-align: center; color: #484f58; font-style: italic; }
  .back { display: inline-block; margin-bottom: 1.5rem; color: var(--accent); text-decoration: none; font-size: 0.9rem; }
  .back:hover { text-decoration: underline; }
  @media (max-width: 640px) { .video-row { grid-template-columns: 1fr; } body { padding: 1rem; } }
</style>
</head>
<body>
<a class="back" href="..">← Back to docs</a>
<h1>browser2video — Scenario Videos</h1>
<p class="subtitle">All scenarios rendered in both Human and Fast modes</p>
<div id="root"></div>
<script>
var scenarios = ${scenariosJson};
var order = ${JSON.stringify(scenarioOrder)};
var root = document.getElementById('root');

order.forEach(function(name) {
  var s = scenarios[name];
  if (!s) return;
  var section = document.createElement('div');
  section.className = 'scenario';
  var h2 = document.createElement('h2');
  h2.textContent = name;
  section.appendChild(h2);
  var row = document.createElement('div');
  row.className = 'video-row';
  ['human', 'fast'].forEach(function(mode) {
    var v = s[mode];
    var card = document.createElement('div');
    card.className = 'card';
    if (v && v.path) {
      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      var source = document.createElement('source');
      source.src = v.path;
      source.type = 'video/mp4';
      video.appendChild(source);
      if (v.vtt) {
        var track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = v.vtt;
        track.srclang = 'en';
        track.label = 'Steps';
        track.default = true;
        video.appendChild(track);
      }
      card.appendChild(video);
      var info = document.createElement('div');
      info.className = 'card-info';
      info.innerHTML =
        '<span class="card-title">' + mode + ' mode <span class="badge badge-' + mode + '">' + mode + '</span></span>' +
        '<span class="card-links"><a href="' + v.path + '" download>Download</a></span>';
      card.appendChild(info);
    } else {
      var missing = document.createElement('div');
      missing.className = 'missing';
      missing.textContent = 'No ' + mode + ' mode video available';
      card.appendChild(missing);
    }
    row.appendChild(card);
  });
  section.appendChild(row);
  root.appendChild(section);
});
</script>
</body>
</html>`;
}

// ── Main ──
const args = parseArgs(process.argv);
const outPath = args.out || path.join(rootDir, "artifacts", "index.html");

const CI_SCENARIOS = [
  "basic-ui", "collab", "kanban", "tui-terminals",
  "console-logs", "github-mobile", "carousel-demo",
];

let html: string;

if (args["human-dir"] || args["fast-dir"]) {
  // CI mode: use provided directory prefixes (relative paths for the HTML)
  const humanDir = args["human-dir"] || ".";
  const fastDir = args["fast-dir"] || "../videos-fast";
  const scenariosJson = buildCiScenariosJson(CI_SCENARIOS, humanDir, fastDir);
  html = generateHtml(scenariosJson, CI_SCENARIOS);
} else {
  // Local mode: auto-discover videos from artifacts/
  const artifactsDir = path.join(rootDir, "artifacts");
  const videos = discoverLocalVideos(artifactsDir);
  const scenarioNames = [...new Set(videos.map((v) => v.name))].sort();
  const scenariosJson = buildScenariosJson(videos);
  html = generateHtml(scenariosJson, scenarioNames);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`  Video page: ${outPath}`);

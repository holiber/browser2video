/**
 * Video lesson: Building an image carousel with React and Tailwind CSS.
 * Shows the full process from npm install through incremental coding
 * with live browser hot-reload preview.
 *
 * Layout: browser (left), work terminal (right-top), dev server (right-bottom)
 */
import { fileURLToPath } from "url";
import { createSession } from "browser2video";
import path from "path";
import fs from "node:fs";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/carousel-demo",
);
const appJsxPath = path.join(fixtureDir, "src/App.jsx");

// Code versions — each is a complete valid App.jsx
const CODE_PLACEHOLDER = `\
export default function App() {
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <h1 className="text-white text-3xl font-bold">Image Carousel</h1>
    </div>
  )
}
`;

const CODE_SKELETON = `\
import { useState } from 'react'

const slides = [
  { bg: 'from-blue-500 to-purple-600', title: 'Mountain View' },
  { bg: 'from-emerald-500 to-teal-600', title: 'Forest Trail' },
  { bg: 'from-orange-500 to-red-600', title: 'Desert Sunset' },
  { bg: 'from-pink-500 to-rose-600', title: 'Cherry Blossom' },
]

export default function App() {
  const [current, setCurrent] = useState(0)
  const prev = () => setCurrent((current - 1 + slides.length) % slides.length)
  const next = () => setCurrent((current + 1) % slides.length)

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="relative w-[700px] overflow-hidden rounded-2xl shadow-2xl bg-gray-800">
        <p className="text-white/50 text-center py-40">Slides will appear here</p>
      </div>
    </div>
  )
}
`;

const CODE_WITH_TRACK = `\
import { useState } from 'react'

const slides = [
  { bg: 'from-blue-500 to-purple-600', title: 'Mountain View' },
  { bg: 'from-emerald-500 to-teal-600', title: 'Forest Trail' },
  { bg: 'from-orange-500 to-red-600', title: 'Desert Sunset' },
  { bg: 'from-pink-500 to-rose-600', title: 'Cherry Blossom' },
]

export default function App() {
  const [current, setCurrent] = useState(0)
  const prev = () => setCurrent((current - 1 + slides.length) % slides.length)
  const next = () => setCurrent((current + 1) % slides.length)

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="relative w-[700px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex transition-transform duration-500"
             style={{ transform: \`translateX(-\${current * 100}%)\` }}>
          {slides.map((s, i) => (
            <div key={i} className={\`w-full flex-shrink-0 h-[400px] bg-gradient-to-br \${s.bg} flex items-center justify-center\`}>
              <h2 className="text-white text-4xl font-bold drop-shadow-lg">{s.title}</h2>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
`;

const CODE_WITH_ARROWS = `\
import { useState } from 'react'

const slides = [
  { bg: 'from-blue-500 to-purple-600', title: 'Mountain View' },
  { bg: 'from-emerald-500 to-teal-600', title: 'Forest Trail' },
  { bg: 'from-orange-500 to-red-600', title: 'Desert Sunset' },
  { bg: 'from-pink-500 to-rose-600', title: 'Cherry Blossom' },
]

export default function App() {
  const [current, setCurrent] = useState(0)
  const prev = () => setCurrent((current - 1 + slides.length) % slides.length)
  const next = () => setCurrent((current + 1) % slides.length)

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="relative w-[700px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex transition-transform duration-500"
             style={{ transform: \`translateX(-\${current * 100}%)\` }}>
          {slides.map((s, i) => (
            <div key={i} className={\`w-full flex-shrink-0 h-[400px] bg-gradient-to-br \${s.bg} flex items-center justify-center\`}>
              <h2 className="text-white text-4xl font-bold drop-shadow-lg">{s.title}</h2>
            </div>
          ))}
        </div>
        <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl backdrop-blur">&lsaquo;</button>
        <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl backdrop-blur">&rsaquo;</button>
      </div>
    </div>
  )
}
`;

const CODE_FINAL = `\
import { useState } from 'react'

const slides = [
  { bg: 'from-blue-500 to-purple-600', title: 'Mountain View' },
  { bg: 'from-emerald-500 to-teal-600', title: 'Forest Trail' },
  { bg: 'from-orange-500 to-red-600', title: 'Desert Sunset' },
  { bg: 'from-pink-500 to-rose-600', title: 'Cherry Blossom' },
]

export default function App() {
  const [current, setCurrent] = useState(0)
  const prev = () => setCurrent((current - 1 + slides.length) % slides.length)
  const next = () => setCurrent((current + 1) % slides.length)

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="relative w-[700px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex transition-transform duration-500"
             style={{ transform: \`translateX(-\${current * 100}%)\` }}>
          {slides.map((s, i) => (
            <div key={i} className={\`w-full flex-shrink-0 h-[400px] bg-gradient-to-br \${s.bg} flex items-center justify-center\`}>
              <h2 className="text-white text-4xl font-bold drop-shadow-lg">{s.title}</h2>
            </div>
          ))}
        </div>
        <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl backdrop-blur">&lsaquo;</button>
        <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl backdrop-blur">&rsaquo;</button>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {slides.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={\`w-3 h-3 rounded-full transition-colors \${i === current ? 'bg-white' : 'bg-white/40'}\`} />
          ))}
        </div>
      </div>
    </div>
  )
}
`;

// Write a code version and wait for HMR
function writeCode(code: string) {
  fs.writeFileSync(appJsxPath, code, "utf-8");
}

async function scenario() {
  // Reset fixture to clean state
  writeCode(CODE_PLACEHOLDER);
  try { fs.rmSync(path.join(fixtureDir, "node_modules"), { recursive: true }); } catch {}
  try { fs.unlinkSync(path.join(fixtureDir, "package-lock.json")); } catch {}

  const session = await createSession({
    narration: { enabled: true },
  });
  const { step } = session;

  // Dockview grid: browser (left, 2 rows), editor (top-right), dev server (bottom-right)
  const grid = await session.createGrid(
    [
      { url: "about:blank", label: "Preview" },
      { label: "Editor" },
      { label: "Dev Server" },
    ],
    {
      viewport: { width: 1280, height: 720 },
      grid: [[0, 1], [0, 2]],
    },
  );
  const [, editor, server] = grid.actors;
  const gridPage = grid.page;

  // Navigate terminals to the fixture directory
  await editor.typeAndEnter(`cd ${fixtureDir}`);
  await editor.waitForPrompt();
  await server.typeAndEnter(`cd ${fixtureDir}`);
  await server.waitForPrompt();

  // ── Phase 1: Project Setup ──────────────────────────────────────────

  await step(
    "Explore the project",
    "Welcome! In this lesson we build an image carousel with React and Tailwind CSS. Here is our project: a package json with React, Vite, and Tailwind as dependencies.",
    async () => {
      await editor.typeAndEnter("ls");
      await editor.waitForPrompt();
      await editor.typeAndEnter("cat package.json");
      await editor.waitForPrompt();
    },
  );

  await step(
    "Install dependencies",
    "Let's install the dependencies. React for the UI, Vite as our build tool, and Tailwind CSS version 4 for utility-first styling.",
    async () => {
      await editor.typeAndEnter("npm install");
      await editor.waitForText(["added"], 60000);
      await editor.waitForPrompt();
    },
  );

  await step(
    "Start the dev server",
    "Now we start the Vite dev server. It provides instant hot module replacement, so the browser updates every time we save a file.",
    async () => {
      await server.typeAndEnter("npx vite --host");
      await server.waitForText(["Local:"], 30000);
    },
  );

  // Extract the port
  const serverText = await server.read();
  const portMatch = serverText.match(/localhost:(\d+)/);
  const port = portMatch ? portMatch[1] : "5173";

  // Navigate the browser iframe to the dev server
  const browserFrame = gridPage.frame("term-0");
  if (!browserFrame) throw new Error("Browser iframe 'term-0' not found");

  await step(
    "Open in browser",
    "Our app is running with a placeholder. Let's open the component file and start building.",
    async () => {
      await browserFrame.goto(`http://localhost:${port}`);
      await browserFrame.waitForSelector("h1", { timeout: 15000 });
    },
  );

  // ── Phase 2: Build the Carousel ─────────────────────────────────────

  await step(
    "Create the component skeleton",
    "We start by importing useState from React and defining our slide data. Each slide has a Tailwind gradient color and a title. The component has state for the current slide index, and prev and next functions that wrap around.",
    async () => {
      await editor.typeAndEnter("vim src/App.jsx");
      await editor.waitForText(["Carousel"], 5000);
      // Set paste mode and clear the file
      await editor.pressKey("Escape");
      await editor.typeAndEnter(":set paste");
      await editor.pressKey("g");
      await editor.pressKey("g");
      await editor.pressKey("d");
      await editor.pressKey("G");
      await editor.pressKey("i");

      // Type the skeleton code
      await editor.type(CODE_SKELETON.trim());

      await editor.pressKey("Escape");
      await editor.typeAndEnter(":set nopaste");
      await editor.typeAndEnter(":w");
      await new Promise((r) => setTimeout(r, 2500));
    },
  );

  await step(
    "Add the slide track",
    "Now for the key part. We replace the placeholder with a flex container that shifts horizontally using CSS translateX. Each slide is a full-width gradient div, and Tailwind's transition class makes the movement smooth.",
    async () => {
      // Write the new version from Node.js — HMR picks it up
      writeCode(CODE_WITH_TRACK);
      // Reload vim to show the updated code
      await editor.typeAndEnter(":e!");
      await new Promise((r) => setTimeout(r, 2500));
    },
  );

  await step(
    "Add navigation arrows",
    "We add previous and next arrow buttons, positioned absolutely on each side of the carousel. They have a semi-transparent background with a blur effect that brightens on hover.",
    async () => {
      writeCode(CODE_WITH_ARROWS);
      await editor.typeAndEnter(":e!");
      await new Promise((r) => setTimeout(r, 2500));
    },
  );

  await step(
    "Add dot indicators",
    "Finally, we add dot indicators at the bottom. The active slide's dot is bright white, while the others are semi-transparent. Clicking any dot jumps to that slide.",
    async () => {
      writeCode(CODE_FINAL);
      await editor.typeAndEnter(":e!");
      await new Promise((r) => setTimeout(r, 2500));
    },
  );

  // ── Phase 3: Demo ───────────────────────────────────────────────────

  await step(
    "Test the carousel",
    "Let's try it out. We click the arrows to navigate between slides. The transitions are smooth thanks to Tailwind. We can also click the dots to jump to any slide directly. And that's it: a fully working image carousel in about 40 lines of React and Tailwind CSS.",
    async () => {
      // Click next arrow several times
      const nextBtn = browserFrame.locator("button:has-text('›')");
      if ((await nextBtn.count()) > 0) {
        for (let i = 0; i < 3; i++) {
          await nextBtn.first().click();
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      // Click dots to jump
      const allBtns = browserFrame.locator("button");
      const dotCount = await allBtns.count();
      if (dotCount > 4) {
        // Dots are the last buttons (after prev/next)
        await allBtns.nth(dotCount - 4).click(); // First dot
        await new Promise((r) => setTimeout(r, 800));
        await allBtns.nth(dotCount - 2).click(); // Third dot
        await new Promise((r) => setTimeout(r, 800));
      }
    },
  );

  await session.finish();
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  scenario()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  const { test } = await import("@playwright/test");
  test("carousel-demo", async () => { test.setTimeout(240_000); await scenario(); });
}

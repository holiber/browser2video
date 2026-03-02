/**
 * @description Actor — mode-aware browser interaction engine with
 * WindMouse cursor movement, click effects, typing, drag-and-drop,
 * and drawing.  Shared by the unified runner.
 */
import type { Page, Frame, ElementHandle, Locator } from "playwright";
import type { Mode, ModeRef, ActorDelays, DelayRange } from "./types.ts";
import type { ReplayEvent } from "./replay-log.ts";
import type { AudioDirectorAPI, SpeakOptions } from "./narrator.ts";

// ---------------------------------------------------------------------------
//  Delay defaults & helpers
// ---------------------------------------------------------------------------

export const DEFAULT_DELAYS: Record<Mode, ActorDelays> = {
  human: {
    breatheMs: [1000, 1000],
    afterScrollIntoViewMs: [350, 350],
    mouseMoveStepMs: [3, 3],
    clickEffectMs: [25, 25],
    clickHoldMs: [90, 90],
    afterClickMs: [300, 300],
    beforeTypeMs: [55, 55],
    keyDelayMs: [35, 35],
    keyBoundaryPauseMs: [30, 30],
    afterTypeMs: [150, 150],
    selectOpenMs: [120, 120],
    selectOptionMs: [70, 70],
    afterDragMs: [120, 120],
  },
  fast: {
    breatheMs: [0, 0],
    afterScrollIntoViewMs: [0, 0],
    mouseMoveStepMs: [0, 0],
    clickEffectMs: [0, 0],
    clickHoldMs: [0, 0],
    afterClickMs: [0, 0],
    beforeTypeMs: [0, 0],
    keyDelayMs: [0, 0],
    keyBoundaryPauseMs: [0, 0],
    afterTypeMs: [0, 0],
    selectOpenMs: [0, 0],
    selectOptionMs: [0, 0],
    afterDragMs: [0, 0],
  },
};

export function pickMs([minMs, maxMs]: DelayRange) {
  if (maxMs <= minMs) return minMs;
  return Math.round((minMs + maxMs) / 2);
}

export function mergeDelays(mode: Mode, overrides?: Partial<ActorDelays>): ActorDelays {
  return { ...DEFAULT_DELAYS[mode], ...(overrides ?? {}) };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
//  Step-timing ease curve (used for move-path pacing)
//  Models real human mouse movement: ballistic launch → peak velocity → corrective deceleration.
//  Delay multiplier is low at the start (fast) and rises quadratically toward the end (slow).
// ---------------------------------------------------------------------------

function stepEaseMultiplier(i: number, n: number): number {
  if (!Number.isFinite(i) || !Number.isFinite(n) || n <= 1) return 1;
  const t = Math.min(1, Math.max(0, i / (n - 1)));
  // Quadratic ease-in for delay: 0.3 (fast start) → 1.5 (slow approach)
  return 0.3 + 1.2 * t * t;
}

function easedStepMs(baseMs: number, i: number, n: number, factor = 1): number {
  const ms = baseMs * factor * stepEaseMultiplier(i, n);
  return Math.max(0, Math.round(ms));
}

// ---------------------------------------------------------------------------
//  WindMouse — physics-based human-like cursor path generation
//  Based on https://ben.land/post/2021/04/25/windmouse-human-mouse-movement/
// ---------------------------------------------------------------------------

export function windMouse(
  from: { x: number; y: number },
  to: { x: number; y: number },
  G_0 = 9,
  W_0 = 3,
  M_0 = 18,
  D_0 = 15,
): Array<{ x: number; y: number }> {
  const sqrt3 = Math.sqrt(3);
  const sqrt5 = Math.sqrt(5);
  const points: Array<{ x: number; y: number }> = [];

  let sx = from.x;
  let sy = from.y;
  const dx = to.x;
  const dy = to.y;
  let vx = 0;
  let vy = 0;
  let wx = 0;
  let wy = 0;
  let m0 = M_0;

  for (let iter = 0; iter < 2000; iter++) {
    const dist = Math.hypot(dx - sx, dy - sy);
    if (dist < 1) break;

    const wMag = Math.min(W_0, dist);

    if (dist >= D_0) {
      wx = wx / sqrt3 + (Math.random() * 2 - 1) * wMag / sqrt5;
      wy = wy / sqrt3 + (Math.random() * 2 - 1) * wMag / sqrt5;
    } else {
      wx /= sqrt3;
      wy /= sqrt3;
      if (m0 < 3) {
        m0 = Math.random() * 3 + 3;
      } else {
        m0 /= sqrt5;
      }
    }

    vx += wx + G_0 * (dx - sx) / dist;
    vy += wy + G_0 * (dy - sy) / dist;

    const vMag = Math.hypot(vx, vy);
    if (vMag > m0) {
      const clip = m0 / 2 + Math.random() * m0 / 2;
      vx = (vx / vMag) * clip;
      vy = (vy / vMag) * clip;
    }

    sx += vx;
    sy += vy;

    const mx = Math.round(sx);
    const my = Math.round(sy);
    if (
      points.length === 0 ||
      points[points.length - 1].x !== mx ||
      points[points.length - 1].y !== my
    ) {
      points.push({ x: mx, y: my });
    }
  }

  const last = points[points.length - 1];
  if (!last || last.x !== Math.round(dx) || last.y !== Math.round(dy)) {
    points.push({ x: Math.round(dx), y: Math.round(dy) });
  }

  return points;
}

/** Simple linear interpolation with smoothstep easing. */
export function linearPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    points.push({
      x: Math.round(from.x + (to.x - from.x) * ease),
      y: Math.round(from.y + (to.y - from.y) * ease),
    });
  }
  return points;
}

/** Apply small random perturbation to a point (simulates hand tremor). */
function jitterPoint(p: { x: number; y: number }, amplitude = 1.5): { x: number; y: number } {
  const dx = (Math.random() + Math.random() - 1) * amplitude;
  const dy = (Math.random() + Math.random() - 1) * amplitude;
  return { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
}

// ---------------------------------------------------------------------------
//  Cursor overlay injection script (runs inside the browser page)
// ---------------------------------------------------------------------------

export const CURSOR_OVERLAY_SCRIPT = `
(function() {
  // Clean up cursors from previous scenario
  if (window.__b2v_cursors) {
    for (var id in window.__b2v_cursors) {
      var el = window.__b2v_cursors[id];
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }
  window.__b2v_cursors = {};
  window.__b2v_cursorIndex = 0;
  window.__b2v_cursorColors = window.__b2v_cursorColors || {};

  // Auto-rotating high-visibility palette for multi-actor scenarios
  var AUTO_COLORS = [
    { fill: '#fb923c', stroke: '#9a3412' },  // coral/orange
    { fill: '#38bdf8', stroke: '#0c4a6e' },  // sky blue
    { fill: '#a3e635', stroke: '#365314' },  // lime
    { fill: '#c084fc', stroke: '#581c87' },  // violet
    { fill: '#fbbf24', stroke: '#78350f' },  // amber
    { fill: '#2dd4bf', stroke: '#134e4a' },  // teal
    { fill: '#fb7185', stroke: '#881337' },  // rose
    { fill: '#818cf8', stroke: '#3730a3' },  // indigo
  ];

  function getCursorEl(id) {
    if (window.__b2v_cursors[id]) return window.__b2v_cursors[id];
    if (!document.body) return null;  // body not ready yet

    // First actor ('default' or index 0) → classic white cursor
    // Subsequent actors → pick from rotating palette
    var colors;
    // Check for pre-registered custom color first
    if (window.__b2v_cursorColors[id]) {
      colors = window.__b2v_cursorColors[id];
    } else if (id === 'default' || window.__b2v_cursorIndex === 0) {
      colors = { fill: 'white', stroke: 'black' };
    } else {
      colors = AUTO_COLORS[(window.__b2v_cursorIndex - 1) % AUTO_COLORS.length];
    }
    window.__b2v_cursorIndex++;

    var cursor = document.createElement('div');
    cursor.id = '__b2v_cursor_' + id;
    cursor.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'z-index:' + (999999 - Object.keys(window.__b2v_cursors).length),
      'width:32px', 'height:32px', 'pointer-events:none',
      'transform:translate(-3px,-3px)',
      'transition:transform 40ms ease-in-out',
      'will-change:transform',
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
      'display:none',
    ].join(';');
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'none');
    var pathEl = document.createElementNS(svgNS, 'path');
    pathEl.setAttribute('d', 'M3 2L3 17L7.5 12.5L11.5 18L14 16.5L10 11L16 11L3 2Z');
    pathEl.setAttribute('fill', colors.fill);
    pathEl.setAttribute('stroke', colors.stroke);
    pathEl.setAttribute('stroke-width', '1.2');
    pathEl.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pathEl);

    cursor.appendChild(svg);
    document.body.appendChild(cursor);
    window.__b2v_cursors[id] = cursor;
    return cursor;
  }

  // Ripple container for click effects — deferred until body exists
  var rippleContainer = null;
  function ensureRippleContainer() {
    if (rippleContainer && rippleContainer.parentNode) return rippleContainer;
    if (!document.body) return null;
    var old = document.getElementById('__b2v_ripple_container');
    if (old) old.remove();
    rippleContainer = document.createElement('div');
    rippleContainer.id = '__b2v_ripple_container';
    rippleContainer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999998;pointer-events:none;';
    document.body.appendChild(rippleContainer);
    return rippleContainer;
  }

  // Set smooth scrolling on documentElement (available before body)
  if (document.documentElement) {
    document.documentElement.style.scrollBehavior = 'smooth';
  }

  window.__b2v_laserTrails = {};

  window.__b2v_moveCursor = function(x, y, actorId) {
    var id = actorId || 'default';
    var el = getCursorEl(id);
    if (!el) return;  // body not ready
    var wasHidden = el.style.display === 'none';
    if (wasHidden) {
      el.style.transition = 'none';
      el.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)';
      el.style.display = '';
      requestAnimationFrame(function() { el.style.transition = 'transform 40ms ease-in-out'; });
    } else {
      el.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)';
    }
    var trail = window.__b2v_laserTrails[id];
    if (trail) {
      var pts = trail.points;
      if (pts.length > 0) {
        var lp = pts[pts.length - 1];
        var dx = x - lp.x; var dy = y - lp.y;
        if (dx * dx + dy * dy < (trail._minDistSq || 9)) return;
      }
      pts.push({ x: x, y: y, t: performance.now() });
    }
  };

  // Pre-register a custom color for an actor ID (call before first moveCursor)
  window.__b2v_setCursorColor = function(actorId, fill, stroke) {
    window.__b2v_cursorColors[actorId] = { fill: fill, stroke: stroke };
    // Update existing cursor if already created
    var existing = window.__b2v_cursors[actorId];
    if (existing) {
      var pathEl = existing.querySelector('path');
      if (pathEl) {
        pathEl.setAttribute('fill', fill);
        pathEl.setAttribute('stroke', stroke);
      }
    }
  };

  window.__b2v_clickEffect = function(x, y) {
    var rc = ensureRippleContainer();
    if (!rc) return;
    const ring = document.createElement('div');
    ring.style.cssText = \`
      position: fixed; pointer-events: none;
      left: \${x}px; top: \${y}px;
      width: 0; height: 0;
      border: 3px solid rgba(96, 165, 250, 0.9);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: __b2v_ripple 0.6s ease-out forwards;
    \`;
    rc.appendChild(ring);
    setTimeout(() => ring.remove(), 700);
  };

  window.__b2v_cursorDown = function(actorId) {
    var id = actorId || 'default';
    var el = getCursorEl(id);
    if (!el) return;
    el.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.5)) drop-shadow(0 0 6px rgba(96,165,250,0.7))';
    var svg = el.querySelector('svg');
    if (svg) svg.style.transform = 'scale(0.78)';
    var dot = document.createElement('div');
    dot.className = '__b2v_hold_dot';
    dot.id = '__b2v_hold_dot_' + id;
    dot.style.cssText = 'position:absolute;left:3px;top:3px;width:10px;height:10px;border-radius:50%;background:rgba(96,165,250,0.7);animation:__b2v_hold_pulse 0.8s ease-in-out infinite;pointer-events:none;';
    el.appendChild(dot);
  };

  window.__b2v_cursorUp = function(actorId) {
    var id = actorId || 'default';
    var el = getCursorEl(id);
    if (!el) return;
    el.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))';
    var svg = el.querySelector('svg');
    if (svg) svg.style.transform = '';
    var dot = document.getElementById('__b2v_hold_dot_' + id);
    if (dot) dot.remove();
  };

  window.__b2v_laserOn = function(actorId) {
    var id = actorId || 'default';
    if (window.__b2v_laserTrails[id]) return;
    var canvas = document.createElement('canvas');
    canvas.id = '__b2v_laser_' + id;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999996;pointer-events:none;';
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var trail = { points: [], canvas: canvas, ctx: ctx, raf: 0 };
    window.__b2v_laserTrails[id] = trail;
    var TRAIL_MS = 250;
    var MIN_DIST_SQ = 9;
    function draw() {
      var now = performance.now();
      var w = canvas.width; var h = canvas.height;
      if (w !== window.innerWidth || h !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        w = canvas.width; h = canvas.height;
      }
      ctx.clearRect(0, 0, w, h);
      while (trail.points.length > 0 && now - trail.points[0].t > TRAIL_MS) trail.points.shift();
      var pts = trail.points;
      if (pts.length >= 2) {
        var last = pts[pts.length - 1];
        var avgAge = (now - pts[0].t + now - last.t) / 2 / TRAIL_MS;
        var alpha = 0.8 * (1 - avgAge);
        if (alpha > 0) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (var i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.strokeStyle = 'rgba(239, 68, 68, ' + alpha + ')';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = 'rgba(239, 68, 68, 0.4)';
          ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
      trail.raf = requestAnimationFrame(draw);
    }
    trail.raf = requestAnimationFrame(draw);
    trail._minDistSq = MIN_DIST_SQ;
  };

  window.__b2v_laserOff = function(actorId) {
    var id = actorId || 'default';
    var trail = window.__b2v_laserTrails[id];
    if (!trail) return;
    cancelAnimationFrame(trail.raf);
    if (trail.canvas.parentNode) trail.canvas.parentNode.removeChild(trail.canvas);
    delete window.__b2v_laserTrails[id];
  };

  if (!document.getElementById('__b2v_style')) {
    var ensureStyle = function() {
      if (!document.head) return;
      const style = document.createElement('style');
      style.id = '__b2v_style';
      style.textContent = \`
        @keyframes __b2v_ripple {
          0%   { width: 0;   height: 0;   opacity: 1; }
          100% { width: 80px; height: 80px; opacity: 0; }
        }
        @keyframes __b2v_hold_pulse {
          0%, 100% { transform: scale(1);   opacity: 0.7; }
          50%      { transform: scale(1.4); opacity: 0.4; }
        }
      \`;
      document.head.appendChild(style);
    };
    if (document.head) ensureStyle();
    else document.addEventListener('DOMContentLoaded', ensureStyle);
  }
})();
`;


// ---------------------------------------------------------------------------
//  Init scripts injected into every page
// ---------------------------------------------------------------------------

export const HIDE_CURSOR_INIT_SCRIPT = `
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '* { cursor: none !important; }';
    document.head.appendChild(s);
  });
`;

export const FAST_MODE_INIT_SCRIPT = `
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = \`
      *, *::before, *::after {
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 1ms !important;
        scroll-behavior: auto !important;
      }
    \`;
    document.head.appendChild(s);
  });
`;

// ---------------------------------------------------------------------------
//  Actor class
// ---------------------------------------------------------------------------

export class Actor {
  page: Page;
  /**
   * Shared mode reference. Mode is a session-level concept — all actors
   * created from the same session (or sharing the same ref) switch together.
   * Read via `this.mode` getter.
   */
  readonly _modeRef: ModeRef;
  voice?: string;
  speed?: number;
  private cursorX = 0;
  private cursorY = 0;
  private _cursorInitialized = false;
  protected delays: ActorDelays;
  /** DOM context for selector lookups — page by default, iframe Frame when inside a grid */
  protected _context: Page | Frame;
  /** Shared narration backend provided by Session */
  private _audioDirector: AudioDirectorAPI | null = null;
  /** Callback for streaming replay events (cursor moves, clicks, key presses) */
  onReplayEvent: ((event: ReplayEvent) => void) | null = null;
  /** Session start time reference for replay event timestamps */
  protected _sessionStartTime = 0;
  /**
   * When true, the actor is embedded in the player's preview iframe.
   * Replay events use iframe-local coordinates and cursor overlay injection is skipped.
   */
  _embedded = false;
  /** Selector for the outermost scenario iframe in the player page (for coordinate conversion) */
  _scenarioIframeSelector: string | null = null;
  /** Expected viewport size of the scenario iframe (for coordinate conversion) */
  _scenarioViewport: { width: number; height: number } | null = null;
  /** Custom cursor color (fill + stroke). */
  private _cursorColor?: { fill: string; stroke: string };

  /** Current execution mode — reads from the shared ModeRef. */
  get mode(): Mode { return this._modeRef.current; }

  constructor(
    page: Page,
    modeOrRef: Mode | ModeRef,
    opts?: { delays?: Partial<ActorDelays>; voice?: string; speed?: number; cursorColor?: { fill: string; stroke: string } },
  ) {
    this.page = page;
    this._context = page;
    this._modeRef = typeof modeOrRef === "string" ? { current: modeOrRef } : modeOrRef;
    this.delays = mergeDelays(this.mode, opts?.delays);
    this.voice = opts?.voice;
    this.speed = opts?.speed;
    this._cursorColor = opts?.cursorColor;
  }

  /** Actor identifier used for per-actor cursor overlay. */
  cursorId: string = 'default';

  /** Set the session start time for replay event timestamps */
  setSessionStartTime(t: number) { this._sessionStartTime = t; }

  private _cachedIframeBox: { x: number; y: number; scale: number } | null = null;
  private _lastIframeBoxMs = 0;

  /** Refresh the cached iframe bounding box (called at the start of each interaction). */
  private async _refreshIframeBox(): Promise<void> {
    if (!this._embedded || !this._scenarioIframeSelector || !this._scenarioViewport) return;
    const now = Date.now();
    if (this._cachedIframeBox && now - this._lastIframeBoxMs < 2000) return;
    const el = await this.page.$(this._scenarioIframeSelector);
    if (!el) return;
    const box = await el.boundingBox();
    if (!box || box.width === 0) return;
    this._cachedIframeBox = { x: box.x, y: box.y, scale: box.width / this._scenarioViewport.width };
    this._lastIframeBoxMs = now;
  }

  /** Synchronous page-coords → scenario-viewport-coords conversion for replay events. */
  private _replayXY(pageX: number, pageY: number): { x: number; y: number } {
    if (!this._cachedIframeBox) return { x: pageX, y: pageY };
    const { x: ox, y: oy, scale } = this._cachedIframeBox;
    return {
      x: Math.round((pageX - ox) / scale),
      y: Math.round((pageY - oy) / scale),
    };
  }

  /** Emit a cursorMove replay event, converting coordinates for embedded mode. */
  private _emitCursorMove(pageX: number, pageY: number) {
    if (!this.onReplayEvent) return;
    const { x, y } = this._replayXY(pageX, pageY);
    this.onReplayEvent({ type: "cursorMove", x, y, ts: Date.now() - this._sessionStartTime });
  }

  /** Emit a click replay event, converting coordinates for embedded mode. */
  private _emitClick(pageX: number, pageY: number) {
    if (!this.onReplayEvent) return;
    const { x, y } = this._replayXY(pageX, pageY);
    this.onReplayEvent({ type: "click", x, y, ts: Date.now() - this._sessionStartTime });
  }

  /** Attach the session audio director so Actor can narrate directly. */
  setAudioDirector(audioDirector: AudioDirectorAPI) {
    this._audioDirector = audioDirector;
  }

  /** Set per-actor narration defaults. */
  setVoice(voice: string, speed?: number) {
    this.voice = voice;
    if (speed !== undefined) this.speed = speed;
  }

  private _resolveSpeakOptions(opts?: SpeakOptions): SpeakOptions | undefined {
    const voice = opts?.voice ?? this.voice;
    const speed = opts?.speed ?? this.speed;
    if (voice === undefined && speed === undefined) return undefined;
    return { voice, speed };
  }

  private _requireAudioDirector(): AudioDirectorAPI {
    if (!this._audioDirector) {
      throw new Error("Actor audio director is not attached. Create this actor via Session APIs before calling speak().");
    }
    return this._audioDirector;
  }

  /** Pre-generate TTS audio using this actor's voice defaults. */
  async warmup(text: string, opts?: SpeakOptions): Promise<void> {
    await this._requireAudioDirector().warmup(text, this._resolveSpeakOptions(opts));
  }

  /** Speak narration text using this actor's voice defaults. */
  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    await this._requireAudioDirector().speak(text, this._resolveSpeakOptions(opts));
  }

  /** Inject cursor overlay into the page (human mode only, skipped in embedded mode). */
  async injectCursor() {
    if (this.mode !== "human" || this._embedded) return;
    await this.page.evaluate(CURSOR_OVERLAY_SCRIPT);
    if (this._cursorColor) {
      const { fill, stroke } = this._cursorColor;
      await this.page.evaluate(
        `window.__b2v_setCursorColor?.('${this.cursorId}', '${fill}', '${stroke}')`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  //  Private helpers — DRY building blocks for cursor, click, and element ops
  // ---------------------------------------------------------------------------

  /**
   * Animate cursor from current position to target via windMouse path.
   * Handles first-movement teleport. Updates cursorX/cursorY.
   * If `moveMouse` is true (default), also calls page.mouse.move at each step.
   */
  private async _animateCursorTo(
    tx: number,
    ty: number,
    opts?: { moveMouse?: boolean },
  ) {
    const moveMouse = opts?.moveMouse ?? true;
    tx = Math.round(tx);
    ty = Math.round(ty);

    if (!this._cursorInitialized) {
      this._cursorInitialized = true;
      this.cursorX = tx;
      this.cursorY = ty;
      if (moveMouse) await this.page.mouse.move(tx, ty);
      await this.page.evaluate(`window.__b2v_moveCursor?.(${tx}, ${ty}, '${this.cursorId}')`);
      this._emitCursorMove(tx, ty);
      return;
    }

    const points = windMouse({ x: this.cursorX, y: this.cursorY }, { x: tx, y: ty });
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      if (moveMouse) await this.page.mouse.move(p.x, p.y);
      await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y}, '${this.cursorId}')`);
      this._emitCursorMove(p.x, p.y);
      await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, points.length));
    }
    this.cursorX = tx;
    this.cursorY = ty;
  }

  /**
   * Perform a click with visual effects (ripple, cursorDown/Up) at coordinates.
   * In fast mode dispatches a plain mouse.click instead.
   */
  private async _performClick(x: number, y: number) {
    if (this.mode === "human") {
      await this.page.evaluate(`window.__b2v_clickEffect?.(${x}, ${y})`);
      this._emitClick(x, y);
      await sleep(pickMs(this.delays.clickEffectMs));
      await this.page.mouse.down();
      await this.page.evaluate(`window.__b2v_cursorDown?.('${this.cursorId}')`);
      await sleep(pickMs(this.delays.clickHoldMs));
      await this.page.evaluate(`window.__b2v_cursorUp?.('${this.cursorId}')`);
      await this.page.mouse.up();
      await sleep(pickMs(this.delays.afterClickMs));
    } else {
      await this.page.mouse.click(x, y);
    }
  }

  /**
   * Resolve a selector to its visible ElementHandle, scroll it into view,
   * and return its center coordinates + the handle.
   * Falls back to page context if frame context fails.
   */
  private async _resolveElement(
    selector: string,
    opts?: { scrollTo?: "center" | false; timeout?: number },
  ): Promise<{ x: number; y: number; el: ElementHandle }> {
    const timeout = opts?.timeout ?? 3000;
    let el: ElementHandle | null = null;
    try {
      el = await this._context.waitForSelector(selector, { state: "visible", timeout });
    } catch (err) {
      if (this._context !== this.page) {
        el = await this.page.waitForSelector(selector, { state: "visible", timeout });
      } else {
        throw err;
      }
    }
    if (!el) throw new Error(`Element not found: ${selector}`);

    if (opts?.scrollTo !== false) {
      const scrollBehavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";
      await el.evaluate((e, b) => (e as Element).scrollIntoView({ block: "center", behavior: b }), scrollBehavior);
      await sleep(pickMs(this.delays.afterScrollIntoViewMs));
    }

    const box = (await el.boundingBox())!;
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
      el,
    };
  }

  // ---------------------------------------------------------------------------
  //  Public API
  // ---------------------------------------------------------------------------

  /**
   * Move cursor smoothly to specific coordinates (human mode only).
   * Useful when interacting with Playwright Locator APIs directly.
   */
  async moveCursorTo(x: number, y: number) {
    if (this.mode !== "human") return;
    await this._refreshIframeBox();
    await this._animateCursorTo(x, y);
  }

  /**
   * Move cursor to a Playwright Locator's center and click it.
   * Useful when working with Playwright's Locator API directly.
   */
  async clickLocator(locator: Locator) {
    await locator.scrollIntoViewIfNeeded({ timeout: 10000 });
    const box = await locator.boundingBox();
    if (box) {
      await this.moveCursorTo(box.x + box.width / 2, box.y + box.height / 2);
    }
    await locator.click({ force: true });
  }

  /** Navigate to a URL. Cursor is auto-injected via framenavigated listener. */
  async goto(url: string) {
    await this._context.goto(url, { waitUntil: "networkidle" });
  }

  /** Wait for an element to appear. */
  async waitFor(selector: string, timeout = 3000) {
    await this._context.waitForSelector(selector, { state: "visible", timeout });
  }

  /** Move cursor smoothly to an element center (human) or just resolve (fast). */
  private async moveTo(
    selector: string,
  ): Promise<{ x: number; y: number; el: ElementHandle }> {
    await this._refreshIframeBox();
    const { x, y, el } = await this._resolveElement(selector);
    if (this.mode === "human") {
      await this._animateCursorTo(x, y);
    } else {
      this.cursorX = x;
      this.cursorY = y;
    }
    return { x, y, el };
  }

  /** Move cursor to an element (hover). */
  async hover(selector: string) {
    await this.moveTo(selector);
  }

  /** Click on an element. */
  async click(selector: string) {
    const { x, y } = await this.moveTo(selector);
    await this._performClick(x, y);
  }

  /**
   * Type text into an element.
   * Returns a `TypeAction` that can be awaited directly or chained with `.speak()`.
   *
   * ```ts
   * await actor.type("#input", "hello");            // just type
   * await actor.type("#input", "hello").speak();     // type + speak simultaneously
   * await actor.type("#input", "hello").speak("hi"); // type "hello", speak "hi"
   * ```
   */
  type(selector: string, text: string): TypeAction {
    return new TypeAction(this, null, selector, text);
  }

  /**
   * Internal type implementation. Called by TypeAction.
   * @internal
   */
  async _typeImpl(selector: string, text: string, onTypeStart?: () => void) {
    // Auto-detect xterm.js terminal containers
    const xtermTextarea = await this._context.$(`${selector} .xterm-helper-textarea`);
    if (xtermTextarea) {
      await xtermTextarea.focus();
      onTypeStart?.();
      const charDelay = this.mode === "fast" ? 0 : pickMs(this.delays.keyDelayMs);
      for (const ch of text) {
        if (ch === "\n") {
          await this.page.keyboard.press("Enter");
        } else {
          await this.page.keyboard.type(ch, { delay: 0 });
        }
        if (charDelay) await sleep(charDelay);
      }
      await sleep(pickMs(this.delays.afterTypeMs));
      return;
    }

    // Regular DOM input
    await this.click(selector);
    await sleep(pickMs(this.delays.beforeTypeMs));

    onTypeStart?.();

    if (this.mode === "fast") {
      await this._context.type(selector, text, { delay: 0 });
      return;
    }

    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i], {
        delay: pickMs(this.delays.keyDelayMs),
      });
      if (text[i] === " " || text[i] === "@" || text[i] === ".") {
        await sleep(pickMs(this.delays.keyBoundaryPauseMs));
      }
    }

    await sleep(pickMs(this.delays.afterTypeMs));
  }

  /** Type text and press Enter. Shorthand for `type()` + `pressKey("Enter")`. */
  async typeAndEnter(selector: string, text: string) {
    await this.type(selector, text + "\n");
  }

  /** Open a select dropdown and pick a value. */
  async selectOption(triggerSelector: string, valueText: string) {
    await this.click(triggerSelector);
    await sleep(pickMs(this.delays.selectOpenMs));

    const optionSelector = `[role="option"]`;
    await this._context.waitForSelector(optionSelector, { state: "visible", timeout: 3000 });
    await sleep(pickMs(this.delays.selectOptionMs));

    const options = await this._context.$$(optionSelector);
    for (const option of options) {
      const text = await option.evaluate((el: any) => el.textContent?.trim());
      if (text === valueText) {
        const box = (await option.boundingBox())!;
        const tx = Math.round(box.x + box.width / 2);
        const ty = Math.round(box.y + box.height / 2);

        if (this.mode === "human") {
          await this._animateCursorTo(tx, ty);
          await this.page.evaluate(`window.__b2v_clickEffect?.(${tx}, ${ty})`);
          this._emitClick(tx, ty);
          await sleep(pickMs(this.delays.clickEffectMs));
        } else {
          this.cursorX = tx;
          this.cursorY = ty;
        }

        await option.click({ force: true });
        await sleep(pickMs(this.delays.afterClickMs));
        return;
      }
    }
    throw new Error(`Option "${valueText}" not found`);
  }

  /** Scroll within an element or the page. */
  async scroll(selector: string | null, deltaY: number) {
    if (selector) {
      await this.moveTo(selector);
    }

    const behavior: ScrollBehavior = this.mode === "human" ? "smooth" : "auto";

    if (selector) {
      await this._context.evaluate(
        ({ selector, deltaY, behavior }) => {
          const root = document.querySelector(selector) as HTMLElement | null;
          if (!root) return;

          const isScrollable = (el: HTMLElement) =>
            el.scrollHeight > el.clientHeight + 1 &&
            (getComputedStyle(el).overflowY === "auto" ||
              getComputedStyle(el).overflowY === "scroll" ||
              getComputedStyle(el).overflowY === "overlay");

          const direct =
            root instanceof HTMLElement && isScrollable(root) ? root : null;

          const radixViewport = root.querySelector(
            '[data-slot="scroll-area-viewport"]',
          ) as HTMLElement | null;

          const descendantScrollable =
            Array.from(root.querySelectorAll("*"))
              .find((n) => n instanceof HTMLElement && isScrollable(n as HTMLElement)) as
            | HTMLElement
            | undefined;

          const target = direct ?? radixViewport ?? descendantScrollable ?? root;
          target.scrollBy({ top: deltaY, behavior });
        },
        { selector, deltaY, behavior },
      );
    } else {
      await this._context.evaluate(
        ({ deltaY, behavior }) => {
          window.scrollBy({ top: deltaY, behavior });
        },
        { deltaY, behavior },
      );
    }

    await sleep(this.mode === "human" ? 600 : 50);
  }

  /**
   * Drag between two arbitrary page coordinates with human-like cursor motion.
   * Low-level building block used by drag(), dragByOffset(), and selectText().
   */
  async dragCoords(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    await this._refreshIframeBox();
    from = { x: Math.round(from.x), y: Math.round(from.y) };
    to = { x: Math.round(to.x), y: Math.round(to.y) };

    if (this.mode === "human") {
      await this._animateCursorTo(from.x, from.y);
    }

    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.evaluate(`window.__b2v_cursorDown?.('${this.cursorId}')`);
    this._emitClick(from.x, from.y);
    await sleep(pickMs(this.delays.clickHoldMs));

    const dragSteps = this.mode === "human" ? 25 : 5;
    const dragPoints = linearPath(from, to, dragSteps);
    for (let i = 0; i < dragPoints.length; i++) {
      const p = dragPoints[i]!;
      await this.page.mouse.move(p.x, p.y);
      if (this.mode === "human") {
        await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y}, '${this.cursorId}')`);
        this._emitCursorMove(p.x, p.y);
        await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), i, dragPoints.length));
      }
    }

    await sleep(pickMs(this.delays.afterClickMs));
    await this.page.evaluate(`window.__b2v_cursorUp?.('${this.cursorId}')`);
    await this.page.mouse.up();

    this.cursorX = to.x;
    this.cursorY = to.y;
    await sleep(pickMs(this.delays.afterDragMs));
  }

  /** Drag from one element's center to another element's center. */
  async drag(fromSelector: string, toSelector: string) {
    const { x: fx, y: fy } = await this._resolveElement(fromSelector, { scrollTo: false });
    const { x: tx, y: ty } = await this._resolveElement(toSelector, { scrollTo: false });
    await this.dragCoords({ x: fx, y: fy }, { x: tx, y: ty });
  }

  /** Drag an element by a pixel offset. */
  async dragByOffset(selector: string, dx: number, dy: number) {
    const { x, y } = await this._resolveElement(selector);
    await this.dragCoords({ x, y }, { x: x + dx, y: y + dy });
  }

  /**
   * Select text by dragging from the top-left of one element to the
   * bottom-right of another (or the same element if only one selector given).
   * Produces a visible browser text selection highlight.
   */
  async selectText(fromSelector: string, toSelector?: string) {
    const { el: fromEl } = await this._resolveElement(fromSelector, { timeout: 5000 });
    const fromBox = (await fromEl.boundingBox())!;
    const from = {
      x: Math.round(fromBox.x + 2),
      y: Math.round(fromBox.y + 2),
    };

    let to: { x: number; y: number };
    if (toSelector) {
      const { el: toEl } = await this._resolveElement(toSelector, { scrollTo: false, timeout: 5000 });
      const toBox = (await toEl.boundingBox())!;
      to = {
        x: Math.round(toBox.x + toBox.width - 2),
        y: Math.round(toBox.y + toBox.height - 2),
      };
    } else {
      to = {
        x: Math.round(fromBox.x + fromBox.width - 2),
        y: Math.round(fromBox.y + fromBox.height - 2),
      };
    }

    await this.dragCoords(from, to);
  }

  /** Draw on a canvas element (points are 0-1 normalized). */
  async draw(canvasSelector: string, points: Array<{ x: number; y: number }>, opts?: { humanJitter?: boolean }) {
    const { el: canvas } = await this._resolveElement(canvasSelector);
    const box = (await canvas.boundingBox())!;

    const absPoints = points.map((p) => ({
      x: Math.round(box.x + p.x * box.width),
      y: Math.round(box.y + p.y * box.height),
    }));

    if (absPoints.length < 2) return;

    if (this.mode === "human") {
      await this._animateCursorTo(absPoints[0].x, absPoints[0].y);
    }

    await this.page.mouse.move(absPoints[0].x, absPoints[0].y);
    await this.page.mouse.down();
    await this.page.evaluate(`window.__b2v_cursorDown?.('${this.cursorId}')`);

    const applyJitter = this.mode === "human" && (opts?.humanJitter ?? true);
    for (let i = 1; i < absPoints.length; i++) {
      const segSteps = this.mode === "human" ? 12 : 1;
      const segPoints = linearPath(absPoints[i - 1], absPoints[i], segSteps);
      for (let j = 0; j < segPoints.length; j++) {
        const raw = segPoints[j]!;
        const p = applyJitter ? jitterPoint(raw) : raw;
        await this.page.mouse.move(p.x, p.y);
        if (this.mode === "human") {
          await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y}, '${this.cursorId}')`);
          this._emitCursorMove(p.x, p.y);
          await sleep(
            easedStepMs(pickMs(this.delays.mouseMoveStepMs), j, segPoints.length, 2),
          );
        }
      }
    }

    await this.page.evaluate(`window.__b2v_cursorUp?.('${this.cursorId}')`);
    await this.page.mouse.up();
    this.cursorX = absPoints[absPoints.length - 1].x;
    this.cursorY = absPoints[absPoints.length - 1].y;
    await sleep(pickMs(this.delays.afterDragMs));
  }

  /**
   * Circle the cursor around an element in a spiral path (1.5 full rotations),
   * like a presenter circling something on a whiteboard. The radius grows from
   * 0.7x to 1.0x smoothly. Fast mode: no-op.
   *
   * Duration auto-scales with element size (larger element = longer circle).
   * Override with `durationMs` if needed.
   */
  async circleAround(selector: string, opts?: { durationMs?: number; laser?: boolean }) {
    if (this.mode !== "human") return;
    const useLaser = opts?.laser ?? true;
    await this._refreshIframeBox();

    const { el } = await this._resolveElement(selector);
    const box = (await el.boundingBox())!;

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const baseRx = box.width / 2 + 18;
    const baseRy = box.height / 2 + 14;

    const totalAngle = 3 * Math.PI;
    const rStart = 0.7;
    const rEnd = 1.0;

    const startX = cx + baseRx * rStart;
    const startY = cy;
    await this._animateCursorTo(Math.round(startX), Math.round(startY));

    if (useLaser) await this.page.evaluate(`window.__b2v_laserOn?.('${this.cursorId}')`);

    // Auto-calculate duration from path length: ~400px/s, clamped to [800, 1500] ms
    const avgRadius = (baseRx + baseRy) / 2;
    const pathLength = 1.5 * 2 * Math.PI * avgRadius * ((rStart + rEnd) / 2);
    const autoDuration = Math.max(800, Math.min(1500, Math.round(pathLength / 400 * 1000)));
    const duration = opts?.durationMs ?? autoDuration;
    const totalSteps = Math.max(40, Math.floor(duration / 20));
    const stepDelay = duration / totalSteps;
    let prevX = startX;
    let prevY = startY;

    for (let i = 1; i <= totalSteps; i++) {
      const t = i / totalSteps;
      const angle = t * totalAngle;
      const rFactor = rStart + (rEnd - rStart) * t;
      const px = Math.round(cx + baseRx * rFactor * Math.cos(angle));
      const py = Math.round(cy + baseRy * rFactor * Math.sin(angle));

      if (px !== Math.round(prevX) || py !== Math.round(prevY)) {
        await this.page.mouse.move(px, py);
        await this.page.evaluate(`window.__b2v_moveCursor?.(${px}, ${py}, '${this.cursorId}')`);
        this._emitCursorMove(px, py);
        prevX = px;
        prevY = py;
      }
      await sleep(stepDelay);
    }

    if (useLaser) await this.page.evaluate(`window.__b2v_laserOff?.('${this.cursorId}')`);
    this.cursorX = Math.round(prevX);
    this.cursorY = Math.round(prevY);
  }

  /**
   * Alias for circleAround with laser pointer enabled.
   * Kept for backward compatibility.
   */
  async highlight(selector: string, opts?: { durationMs?: number; laser?: boolean }) {
    await this.circleAround(selector, opts);
  }

  /**
   * Draw on a transparent full-page overlay without dispatching real pointer
   * events (so underlying page elements are not affected). Injects a canvas,
   * draws strokes via JS evaluate, and animates the cursor visually.
   * Points use 0-1 normalized coordinates relative to the viewport.
   */
  async drawOnPage(
    points: Array<{ x: number; y: number }>,
    opts?: { color?: string; lineWidth?: number; clear?: boolean; humanJitter?: boolean },
  ) {
    if (points.length < 2) return;
    const color = opts?.color ?? "rgba(239, 68, 68, 0.85)";
    const lineWidth = opts?.lineWidth ?? 3;

    const vp = this.page.viewportSize()!;
    const absPoints = points.map((p) => ({
      x: Math.round(p.x * vp.width),
      y: Math.round(p.y * vp.height),
    }));

    await this.page.evaluate(
      ({ color, lineWidth }) => {
        let c = document.getElementById("__b2v_draw_overlay") as HTMLCanvasElement | null;
        if (!c) {
          c = document.createElement("canvas");
          c.id = "__b2v_draw_overlay";
          c.width = window.innerWidth;
          c.height = window.innerHeight;
          c.style.cssText =
            "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999997;pointer-events:none;";
          document.body.appendChild(c);
        }
        const ctx = c.getContext("2d")!;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      },
      { color, lineWidth },
    );

    if (this.mode === "human") {
      await this._animateCursorTo(absPoints[0].x, absPoints[0].y, { moveMouse: false });
    }

    await this.page.evaluate(`window.__b2v_cursorDown?.('${this.cursorId}')`);

    const applyJitter = this.mode === "human" && (opts?.humanJitter ?? true);
    for (let i = 1; i < absPoints.length; i++) {
      const prev = absPoints[i - 1];
      const cur = absPoints[i];
      const segSteps = this.mode === "human" ? 12 : 1;
      const segPoints = linearPath(prev, cur, segSteps);

      for (let j = 0; j < segPoints.length; j++) {
        const raw = segPoints[j]!;
        const p = applyJitter ? jitterPoint(raw) : raw;
        await this.page.evaluate(
          ({ x, y }) => {
            const c = document.getElementById("__b2v_draw_overlay") as HTMLCanvasElement | null;
            if (!c) return;
            const ctx = c.getContext("2d")!;
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
          },
          { x: p.x, y: p.y },
        );
        if (this.mode === "human") {
          await this.page.evaluate(`window.__b2v_moveCursor?.(${p.x}, ${p.y}, '${this.cursorId}')`);
          this._emitCursorMove(p.x, p.y);
          await sleep(easedStepMs(pickMs(this.delays.mouseMoveStepMs), j, segPoints.length, 2));
        }
      }
    }

    await this.page.evaluate(`window.__b2v_cursorUp?.('${this.cursorId}')`);
    this.cursorX = absPoints[absPoints.length - 1].x;
    this.cursorY = absPoints[absPoints.length - 1].y;
    await sleep(pickMs(this.delays.afterDragMs));

    if (opts?.clear) {
      await sleep(1500);
      await this.page.evaluate(() => {
        const c = document.getElementById("__b2v_draw_overlay");
        if (c) c.remove();
      });
    }
  }

  /**
   * Press a keyboard key with a human-like pause afterwards.
   * Useful for TUI / terminal interactions where raw key presses are needed.
   */
  async pressKey(key: string) {
    await this.page.keyboard.press(key);
    this.onReplayEvent?.({ type: "keyPress", key, ts: Date.now() - this._sessionStartTime });
    if (this.mode === "human") {
      await sleep(pickMs(this.delays.breatheMs));
    }
  }

  /**
   * Click at specific page coordinates (not a selector).
   * Moves the cursor smoothly, shows click effect, and performs the click.
   * Useful for canvas, terminal, or other coordinate-based interactions.
   */
  async clickAt(x: number, y: number) {
    await this.moveCursorTo(x, y);
    await this._performClick(x, y);
  }

  /** Add a breathing pause between major steps (human mode only). */
  async breathe() {
    await sleep(pickMs(this.delays.breatheMs));
  }

}

// ---------------------------------------------------------------------------
//  TypeAction — fluent builder for type() with optional .speak()
// ---------------------------------------------------------------------------

/**
 * Returned by `actor.type(selector, text)`.
 * Implements `PromiseLike<void>` so `await actor.type(...)` works directly.
 * Chain `.speak()` to start speaking when typing begins:
 *
 * ```ts
 * await actor.type("#input", "hello").speak();      // speaks "hello"
 * await actor.type("#input", "hello").speak("hi");   // speaks "hi"
 * ```
 */
export class TypeAction implements PromiseLike<void> {
  _actor: Actor;
  _setup: (() => Promise<void>) | null;
  _selector: string;
  _text: string;
  _promise: Promise<void> | null = null;
  _speakText: string | null = null;

  constructor(
    actor: Actor,
    setup: (() => Promise<void>) | null,
    selector: string,
    text: string,
  ) {
    this._actor = actor;
    this._setup = setup;
    this._selector = selector;
    this._text = text;
  }

  /** Start speaking when typing begins. Defaults to the typed text. */
  speak(text?: string): Promise<void> {
    this._speakText = text ?? this._text;
    return this._execute();
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this._execute().then(onfulfilled, onrejected);
  }

  _execute(): Promise<void> {
    if (!this._promise) {
      const speakText = this._speakText;
      const actor = this._actor;
      const onTypeStart = speakText
        ? () => { actor.speak(speakText); }
        : undefined;
      this._promise = (async () => {
        if (this._setup) await this._setup();
        await actor._typeImpl(this._selector, this._text, onTypeStart);
      })();
    }
    return this._promise;
  }
}

// ---------------------------------------------------------------------------
//  WebVTT subtitle generator
// ---------------------------------------------------------------------------

function formatVttTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function generateWebVTT(steps: Array<{ startMs: number; endMs: number; caption: string; index: number }>): string {
  let vtt = "WEBVTT\n\n";
  for (const s of steps) {
    vtt += `${formatVttTime(s.startMs)} --> ${formatVttTime(s.endMs)}\n`;
    vtt += `Step ${s.index}: ${s.caption}\n\n`;
  }
  return vtt;
}

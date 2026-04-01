// ===== START maze-generator-fixed.js =====
// Maze generation using Recursive Backtracking (DFS).
// Representation: a grid of cells, each with 4 walls.
//
// Walls are stored as a 4-bit mask for performance:
// 1 = top, 2 = right, 4 = bottom, 8 = left
//
// A carved passage removes walls between neighboring cells.

const WALL_TOP = 1;
const WALL_RIGHT = 2;
const WALL_BOTTOM = 4;
const WALL_LEFT = 8;
const WALL_ALL = WALL_TOP | WALL_RIGHT | WALL_BOTTOM | WALL_LEFT;

const DIRS = [
  { dr: -1, dc: 0, wall: WALL_TOP, opposite: WALL_BOTTOM },
  { dr: 0, dc: 1, wall: WALL_RIGHT, opposite: WALL_LEFT },
  { dr: 1, dc: 0, wall: WALL_BOTTOM, opposite: WALL_TOP },
  { dr: 0, dc: -1, wall: WALL_LEFT, opposite: WALL_RIGHT },
];

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value | 0));
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function isDeadEnd(wallMask) {
  // dead-end => 3 walls still present => only 1 open side
  let walls = 0;
  if (wallMask & WALL_TOP) walls++;
  if (wallMask & WALL_RIGHT) walls++;
  if (wallMask & WALL_BOTTOM) walls++;
  if (wallMask & WALL_LEFT) walls++;
  return walls === 3;
}

function braidDeadEnds(maze, rng, chance = 0.12) {
  // Create loops by knocking down an extra wall in some dead-ends.
  // This generally increases decision points and makes the maze feel more complex.
  const dirOrder = [0, 1, 2, 3];
  for (let i = 0; i < maze.size; i++) {
    if (!isDeadEnd(maze.walls[i])) continue;
    if (rng() > chance) continue;

    const { r, c } = maze.rc(i);
    shuffleInPlace(dirOrder, rng);

    for (const dirIdx of dirOrder) {
      const d = DIRS[dirIdx];
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (!maze.inBounds(nr, nc)) continue;
      if ((maze.walls[i] & d.wall) === 0) continue; // already open

      const next = maze.index(nr, nc);
      maze.walls[i] &= ~d.wall;
      maze.walls[next] &= ~d.opposite;
      break;
    }
  }
}

function bfsFarthestFrom(maze, startIndex) {
  const dist = new Int32Array(maze.size);
  dist.fill(-1);

  const q = new Int32Array(maze.size);
  let qh = 0;
  let qt = 0;

  dist[startIndex] = 0;
  q[qt++] = startIndex;

  let far = startIndex;

  while (qh < qt) {
    const v = q[qh++];
    const d0 = dist[v];

    if (d0 > dist[far]) far = v;

    const { r, c } = maze.rc(v);

    // Inline neighbor expansion for speed (avoids allocations).
    if (!(maze.walls[v] & WALL_TOP) && r > 0) {
      const n = v - maze.cols;
      if (dist[n] < 0) {
        dist[n] = d0 + 1;
        q[qt++] = n;
      }
    }
    if (!(maze.walls[v] & WALL_RIGHT) && c < maze.cols - 1) {
      const n = v + 1;
      if (dist[n] < 0) {
        dist[n] = d0 + 1;
        q[qt++] = n;
      }
    }
    if (!(maze.walls[v] & WALL_BOTTOM) && r < maze.rows - 1) {
      const n = v + maze.cols;
      if (dist[n] < 0) {
        dist[n] = d0 + 1;
        q[qt++] = n;
      }
    }
    if (!(maze.walls[v] & WALL_LEFT) && c > 0) {
      const n = v - 1;
      if (dist[n] < 0) {
        dist[n] = d0 + 1;
        q[qt++] = n;
      }
    }
  }

  return { farIndex: far, dist };
}

function pickFarApartStartEnd(maze) {
  // Keep the start fixed (top-left) for familiar gameplay,
  // but choose an end cell that is far away in graph distance.
  maze.start = 0;
  maze.end = bfsFarthestFrom(maze, maze.start).farIndex;
}

class Maze {
  constructor(rows, cols, seed = Date.now()) {
    this.rows = clampInt(rows, 2, 200);
    this.cols = clampInt(cols, 2, 200);
    this.size = this.rows * this.cols;
    this.seed = seed >>> 0;

    // A per-cell wall bitmask.
    this.walls = new Uint8Array(this.size);
    this.walls.fill(WALL_ALL);

    // Start/end will be chosen after generation.
    this.start = 0;
    this.end = this.size - 1;
  }

  index(r, c) {
    return r * this.cols + c;
  }

  rc(i) {
    return { r: Math.floor(i / this.cols), c: i % this.cols };
  }

  inBounds(r, c) {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
  }

  hasWall(i, wallBit) {
    return (this.walls[i] & wallBit) !== 0;
  }

  neighbors(i) {
    const { r, c } = this.rc(i);
    const result = [];
    for (const d of DIRS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (!this.inBounds(nr, nc)) continue;
      result.push({ i: this.index(nr, nc), dir: d });
    }
    return result;
  }

  canMove(fromIndex, toIndex) {
    const { r: r1, c: c1 } = this.rc(fromIndex);
    const { r: r2, c: c2 } = this.rc(toIndex);
    const dr = r2 - r1;
    const dc = c2 - c1;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
    if (dr === -1) return !this.hasWall(fromIndex, WALL_TOP);
    if (dr === 1) return !this.hasWall(fromIndex, WALL_BOTTOM);
    if (dc === -1) return !this.hasWall(fromIndex, WALL_LEFT);
    if (dc === 1) return !this.hasWall(fromIndex, WALL_RIGHT);
    return false;
  }
}

class MazeGenerator {
  /**
   * Generate a maze using iterative DFS backtracking.
   *
   * - Base maze is a perfect maze (tree) => solvable.
   * - Then we add a small amount of "braiding" (loops) to increase complexity.
   * - Finally, we pick start/end far apart so the shortest solution is longer.
   */
  static generate(rows, cols, seed = Date.now()) {
    const maze = new Maze(rows, cols, seed);
    const rng = mulberry32(maze.seed);

    const visited = new Uint8Array(maze.size);
    const stack = [];

    const start = 0;
    visited[start] = 1;
    stack.push(start);

    // Reuse one direction order array for speed.
    const dirOrder = [0, 1, 2, 3];

    while (stack.length) {
      const current = stack[stack.length - 1];
      const { r, c } = maze.rc(current);

      shuffleInPlace(dirOrder, rng);

      let carved = false;
      for (const dirIdx of dirOrder) {
        const d = DIRS[dirIdx];
        const nr = r + d.dr;
        const nc = c + d.dc;
        if (!maze.inBounds(nr, nc)) continue;
        const next = maze.index(nr, nc);
        if (visited[next]) continue;

        // Remove the wall between current and next.
        maze.walls[current] &= ~d.wall;
        maze.walls[next] &= ~d.opposite;

        visited[next] = 1;
        stack.push(next);
        carved = true;
        break;
      }

      if (!carved) stack.pop();
    }

    const braidChance = maze.size < 220 ? 0.08 : maze.size < 900 ? 0.12 : 0.16;
    braidDeadEnds(maze, rng, braidChance);
    pickFarApartStartEnd(maze);

    return maze;
  }
}
// ===== END maze-generator-fixed.js =====

// ===== START solver.js =====
// BFS solver for shortest path in a perfect maze.
// (A* isn't necessary here, but BFS is fast and guarantees shortest path.)

function bfsShortestPath(maze, startIndex, endIndex) {
  const n = maze.size;
  const prev = new Int32Array(n);
  prev.fill(-1);
  const q = new Int32Array(n);

  let qh = 0;
  let qt = 0;
  q[qt++] = startIndex;
  prev[startIndex] = startIndex;

  while (qh < qt) {
    const cur = q[qh++];
    if (cur === endIndex) break;

    for (const nb of maze.neighbors(cur)) {
      const nxt = nb.i;
      if (prev[nxt] !== -1) continue;
      if (!maze.canMove(cur, nxt)) continue;
      prev[nxt] = cur;
      q[qt++] = nxt;
    }
  }

  if (prev[endIndex] === -1) return null;

  const path = [];
  let t = endIndex;
  while (t !== startIndex) {
    path.push(t);
    t = prev[t];
  }
  path.push(startIndex);
  path.reverse();
  return path;
}

/**
 * Build a "next step towards end" map by BFS from the end cell.
 * For any cell i != end, nextStep[i] gives the neighbor index that moves closer to end.
 */
function buildNextStepToEnd(maze, endIndex) {
  const n = maze.size;
  const nextStep = new Int32Array(n);
  nextStep.fill(-1);

  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;

  q[qt++] = endIndex;
  nextStep[endIndex] = endIndex;

  while (qh < qt) {
    const cur = q[qh++];
    for (const nb of maze.neighbors(cur)) {
      const nxt = nb.i;
      if (nextStep[nxt] !== -1) continue;
      if (!maze.canMove(nxt, cur)) continue; // nxt -> cur is a valid move
      nextStep[nxt] = cur;
      q[qt++] = nxt;
    }
  }

  return nextStep;
}
// ===== END solver.js =====

// ===== START maze-renderer.js =====
function isLightTheme() {
  return document.documentElement.getAttribute("data-theme") === "light";
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

class MazeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    this.dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    // Offscreen for static maze drawing (walls + start/end).
    this.staticCanvas = document.createElement("canvas");
    this.staticCtx = this.staticCanvas.getContext("2d", { alpha: true });

    this.maze = null;
    this.cellSize = 20;
    this.padding = 14;
  }

  setMaze(maze) {
    this.maze = maze;
    console.log('DEBUG: setMaze called, maze:', maze);
    this._resizeToDisplaySize();
    this._renderStatic();
    console.log('DEBUG: Static render complete, cellSize:', this.cellSize, 'canvas size:', this.canvas.width, 'x', this.canvas.height);
  }

  resize() {
    this._resizeToDisplaySize();
    this._renderStatic();
  }

  _resizeToDisplaySize() {
    const rect = this.canvas.getBoundingClientRect();
    // Keep the canvas square so the maze fills the available space without leaving
    // unused vertical area on tall screens.
    const cssSize = Math.max(280, Math.floor(Math.min(rect.width, rect.height || rect.width)));

    this.canvas.width = cssSize * this.dpr;
    this.canvas.height = cssSize * this.dpr;

    this.staticCanvas.width = this.canvas.width;
    this.staticCanvas.height = this.canvas.height;

    if (!this.maze) return;

    const usableW = this.canvas.width - this.padding * 2 * this.dpr;
    const usableH = this.canvas.height - this.padding * 2 * this.dpr;
    const maxCellW = usableW / this.maze.cols;
    const maxCellH = usableH / this.maze.rows;
    this.cellSize = Math.floor(Math.min(maxCellW, maxCellH));
  }

  // Public helper (used by the player controller).
  cellToPixelCenter(index) {
    const { r, c } = this.maze.rc(index);
    const x = this.padding * this.dpr + c * this.cellSize + this.cellSize / 2;
    const y = this.padding * this.dpr + r * this.cellSize + this.cellSize / 2;
    return { x, y };
  }

  _renderStatic() {
    if (!this.maze) return;
    const ctx = this.staticCtx;
    ctx.clearRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);
    const wallColor = isLightTheme() ? "rgba(10, 14, 22, 0.85)" : "rgba(255, 255, 255, 0.85)"; // more opaque
    const gridAlpha = (() => {
      const base = isLightTheme() ? 0.25 : 0.3; // boosted
      const boost = this.cellSize < 14 ? 0.06 : this.cellSize < 18 ? 0.03 : 0;
      return Math.min(0.45, base + boost);
    })(); 
    const bgGrid = isLightTheme() ? `rgba(10, 14, 22, ${gridAlpha})` : `rgba(255, 255, 255, ${gridAlpha})`;
    // Grid background removed - only walls
    ctx.save();
    ctx.fillStyle = 'transparent'; // no-op to skip grid
    ctx.restore();

    // Maze walls.
    ctx.save();
    ctx.strokeStyle = wallColor;

    // Scale wall thickness with cell size so hard (small cells) doesn't look too bold.
    const wallWidth = Math.max(
      2,
      Math.min(Math.round(this.cellSize * 0.135), Math.round(this.dpr * 3.5))
    );
    ctx.lineWidth = wallWidth;
    ctx.lineCap = "round";

    for (let i = 0; i < this.maze.size; i++) {
      const { r, c } = this.maze.rc(i);
      const x = this.padding * this.dpr + c * this.cellSize;
      const y = this.padding * this.dpr + r * this.cellSize;
      const s = this.cellSize;
      const wmask = this.maze.walls[i];

      if (wmask & WALL_TOP) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + s, y);
        ctx.stroke();
      }
      if (wmask & WALL_RIGHT) {
        ctx.beginPath();
        ctx.moveTo(x + s, y);
        ctx.lineTo(x + s, y + s);
        ctx.stroke();
      }
      if (wmask & WALL_BOTTOM) {
        ctx.beginPath();
        ctx.moveTo(x, y + s);
        ctx.lineTo(x + s, y + s);
        ctx.stroke();
      }
      if (wmask & WALL_LEFT) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + s);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Start and end markers.
    this._drawCellMarker(ctx, this.maze.start, "rgba(46, 229, 157, 0.9)");
    this._drawCellMarker(ctx, this.maze.end, "rgba(255, 77, 93, 0.9)");
  }

  _drawCellMarker(ctx, index, color) {
    const { r, c } = this.maze.rc(index);
    const x = this.padding * this.dpr + c * this.cellSize;
    const y = this.padding * this.dpr + r * this.cellSize;
    const s = this.cellSize;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.floor(this.dpr * 1.4));
    ctx.strokeRect(x + 3, y + 3, s - 6, s - 6);
    ctx.restore();
  }

  render({
    playerPixel,
    fogEnabled,
    fogRadiusCells,
    showSolution,
    solutionPath,
    hintIndex,
    hintPulse = 0,
  }) {
    if (!this.maze) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.staticCanvas, 0, 0);

    // Solution path (drawn under the fog).
    if (showSolution && solutionPath && solutionPath.length > 1) {
      this._drawPath(ctx, solutionPath, isLightTheme() ? "rgba(124, 92, 255, 0.9)" : "rgba(160, 135, 255, 0.95)");
    }

    // Fog of war overlay (then player on top so the avatar always stays visible).
    if (fogEnabled) {
      this._drawFog(ctx, playerPixel, fogRadiusCells);
    }

    // Hint highlight.
    if (hintIndex != null && hintIndex >= 0 && hintIndex < this.maze.size) {
      this._drawHint(ctx, hintIndex, hintPulse);
    }

    // Player.
    this._drawPlayer(ctx, playerPixel);
  }

  _drawPath(ctx, path, stroke) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(3, Math.floor(this.dpr * 2));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const p = this.cellToPixelCenter(path[i]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawFog(ctx, playerPixel, radiusCells = 2.3) {
    const dark = isLightTheme() ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.72)";
    const radius = Math.max(1, radiusCells) * this.cellSize;

    ctx.save();
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.globalCompositeOperation = "destination-out";
    const g = ctx.createRadialGradient(playerPixel.x, playerPixel.y, radius * 0.35, playerPixel.x, playerPixel.y, radius);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(playerPixel.x, playerPixel.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawHint(ctx, index, pulse) {
    const { r, c } = this.maze.rc(index);
    const x = this.padding * this.dpr + c * this.cellSize;
    const y = this.padding * this.dpr + r * this.cellSize;
    const s = this.cellSize;

    const a = 0.25 + 0.35 * clamp01(pulse);
    ctx.save();
    ctx.strokeStyle = `rgba(46, 229, 157, ${a})`;
    ctx.lineWidth = Math.max(3, Math.floor(this.dpr * 2));
    ctx.shadowColor = "rgba(46, 229, 157, 0.55)";
    ctx.shadowBlur = Math.max(6, Math.floor(this.dpr * 5));
    ctx.strokeRect(x + 5, y + 5, s - 10, s - 10);
    ctx.restore();
  }

  _drawPlayer(ctx, playerPixel) {
    const radius = Math.max(5, Math.floor(this.cellSize * 0.24));
    ctx.save();
    ctx.fillStyle = isLightTheme() ? "rgba(10, 14, 22, 0.92)" : "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(124, 92, 255, 0.95)";
    ctx.lineWidth = Math.max(2, Math.floor(this.dpr * 1.4));
    ctx.shadowColor = "rgba(124, 92, 255, 0.55)";
    ctx.shadowBlur = Math.max(6, Math.floor(this.dpr * 4));
    ctx.beginPath();
    ctx.arc(playerPixel.x, playerPixel.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
// ===== END maze-renderer.js =====

// ===== START player-controller.js =====
// Player control: keyboard input + smooth cell-to-cell animation.

class PlayerController {
  constructor({ maze, renderer, onMoveCommitted, onBlocked }) {
    this.maze = maze;
    this.renderer = renderer;
    this.onMoveCommitted = onMoveCommitted;
    this.onBlocked = onBlocked;

    this.cellIndex = maze.start;
    this._pixel = { x: 0, y: 0 };
    this._anim = null; // { from:{x,y}, to:{x,y}, t0, durMs, fromIndex, toIndex }

    this._updatePixelFromCell();
  }

  setMaze(maze) {
    this.maze = maze;
    this.cellIndex = maze.start;
    this._anim = null;
    this._updatePixelFromCell();
  }

  resetToStart() {
    this.cellIndex = this.maze.start;
    this._anim = null;
    this._updatePixelFromCell();
  }

  snapToCellCenter() {
    if (this._anim) return;
    this._updatePixelFromCell();
  }

  get pixel() {
    return this._pixel;
  }

  get animating() {
    return !!this._anim;
  }

  _updatePixelFromCell() {
    const center = this.renderer.cellToPixelCenter(this.cellIndex);
    this._pixel = { x: center.x, y: center.y };
  }

  tryMove(dr, dc, nowMs) {
    if (this._anim) return false;

    const { r, c } = this.maze.rc(this.cellIndex);
    const nr = r + dr;
    const nc = c + dc;
    if (!this.maze.inBounds(nr, nc)) {
      this.onBlocked?.();
      return false;
    }
    const nextIndex = this.maze.index(nr, nc);
    if (!this.maze.canMove(this.cellIndex, nextIndex)) {
      this.onBlocked?.();
      return false;
    }

    const from = this.renderer.cellToPixelCenter(this.cellIndex);
    const to = this.renderer.cellToPixelCenter(nextIndex);
    this._anim = {
      from,
      to,
      t0: nowMs,
      durMs: 110,
      fromIndex: this.cellIndex,
      toIndex: nextIndex,
    };
    return true;
  }

  /**
   * Advance animation; returns true when it finished a cell-to-cell move.
   */
  tick(nowMs) {
    if (!this._anim) return false;
    const t = (nowMs - this._anim.t0) / this._anim.durMs;
    if (t >= 1) {
      this.cellIndex = this._anim.toIndex;
      const to = this._anim.to;
      this._pixel = { x: to.x, y: to.y };
      this._anim = null;
      this.onMoveCommitted?.();
      return true;
    }

    const k = t * (2 - t); // easeOutQuad
    this._pixel = {
      x: this._anim.from.x + (this._anim.to.x - this._anim.from.x) * k,
      y: this._anim.from.y + (this._anim.to.y - this._anim.from.y) * k,
    };
    return false;
  }
}
// ===== END player-controller.js =====

// ===== START sound.js =====
// Lightweight SFX using the Web Audio API (no external files).
// Audio context needs a user gesture; call ensureUnlocked() from input events.

class SoundFX {
  constructor() {
    this.enabled = true;
    this._ctx = null;
    this._unlocked = false;
  }

  setEnabled(value) {
    this.enabled = !!value;
  }

  async ensureUnlocked() {
    if (!this.enabled) return;
    if (this._unlocked) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this._ctx) this._ctx = new AudioCtx();
    try {
      if (this._ctx.state === "suspended") await this._ctx.resume();
      // One silent tick to mark it as unlocked across browsers.
      const osc = this._ctx.createOscillator();
      const gain = this._ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this._ctx.destination);
      osc.start();
      osc.stop(this._ctx.currentTime + 0.01);
      this._unlocked = true;
    } catch {
      // Ignore; some environments block audio.
    }
  }

  _beep({ freq = 440, dur = 0.06, type = "sine", gain = 0.06 } = {}) {
    if (!this.enabled) return;
    if (!this._ctx || !this._unlocked) return;
    const t0 = this._ctx.currentTime;

    const osc = this._ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);

    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(this._ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  click() {
    this._beep({ freq: 700, dur: 0.045, type: "square", gain: 0.04 });
  }

  move() {
    this._beep({ freq: 520, dur: 0.03, type: "triangle", gain: 0.03 });
  }

  blocked() {
    this._beep({ freq: 170, dur: 0.05, type: "sawtooth", gain: 0.04 });
  }

  win() {
    // Simple arpeggio.
    this._beep({ freq: 440, dur: 0.08, type: "sine", gain: 0.05 });
    setTimeout(() => this._beep({ freq: 554, dur: 0.08, type: "sine", gain: 0.05 }), 90);
    setTimeout(() => this._beep({ freq: 659, dur: 0.12, type: "sine", gain: 0.06 }), 180);
  }
}
// ===== END sound.js =====

// ===== START game.js =====
const DIFFICULTIES = {
  easy: { rows: 10, cols: 10 },
  medium: { rows: 20, cols: 20 },
  hard: { rows: 35, cols: 35 },
};

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function formatTime(ms) {
  const t = Math.max(0, ms);
  const totalSeconds = Math.floor(t / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((t % 1000) / 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function computeScore({ elapsedMs, moves }) {
  // Production-friendly score: a simple weighted sum.
  // Lower is better.
  return Math.round(elapsedMs / 1000) * 10 + moves * 5;
}

function storageKey(difficulty) {
  return `maze.bestScore.${difficulty}`;
}

function readBest(difficulty) {
  try {
    const raw = localStorage.getItem(storageKey(difficulty));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.score !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

function writeBest(difficulty, best) {
  try {
    localStorage.setItem(storageKey(difficulty), JSON.stringify(best));
  } catch {
    // Ignore storage errors.
  }
}

class MazeGame {
  constructor() {
    // UI
    this.canvas = $("canvas");
    this.difficultySelect = $("difficulty");
    this.newGameBtn = $("newGame");
    this.restartBtn = $("restart");
    this.solveBtn = $("solve");
    this.hintBtn = $("hint");
    this.hintsLeftEl = $("hintsLeft");
    this.timeEl = $("time");
    this.movesEl = $("moves");
    this.scoreEl = $("score");
    this.bestEl = $("best");
    this.bestMetaEl = $("bestMeta");
    this.themeBtn = document.getElementById("theme");
    this.fogToggle = document.getElementById("fog");
    this.soundToggle = $("sound");

    this.overlay = $("winOverlay");
    this.closeWinBtn = $("closeWin");
    this.playAgainBtn = $("playAgain");
    this.restartWinBtn = $("restartWin");
    this.winStatsEl = $("winStats");
    this.newBestBadge = $("newBest");

    // Modules
    this.sfx = new SoundFX();
    this.renderer = new MazeRenderer(this.canvas);
    console.log('DEBUG: MazeRenderer created, canvas:', this.canvas);

    // State
    this.difficulty = this.difficultySelect.value;
    this.maze = null;
    this.player = null;

    this.solutionPath = null;
    this.nextToEnd = null;
    this.showSolution = false;
    this._fogWasEnabled = false;

    this.fogEnabled = false;
    this.fogRadiusCells = 2.35;

    this.hintsRemaining = 3;
    this.hintIndex = null;
    this.hintPulseT0 = 0;

    this.moves = 0;
    this.startedAt = 0;
    this.endedAt = 0;
    this.timerHandle = null;
    this._raf = 0;

    this._loadTheme();
    this._wireEvents();
    this.newGame({ reseed: true });
  }
  _loadTheme() {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  _toggleTheme() {
    // Theme is locked to dark.
  }

  _wireEvents() {
    const ensureAudio = () => this.sfx.ensureUnlocked();

    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.player?.snapToCellCenter();
      this.renderOnce();
    });

    this.soundToggle.addEventListener("change", async () => {
      this.sfx.setEnabled(this.soundToggle.checked);
      await ensureAudio();
      this.sfx.click();
    });

    this.difficultySelect.addEventListener("change", async () => {
      await ensureAudio();
      this.sfx.click();
      this.difficulty = this.difficultySelect.value;
      this.newGame({ reseed: true });
    });

    this.newGameBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.newGame({ reseed: true });
    });

    this.restartBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.restart();
    });

    this.solveBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.toggleSolution();
    });

    this.hintBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.useHint();
    });

    // Win overlay controls
    this.closeWinBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.hideWin();
    });
    this.playAgainBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.hideWin();
      this.newGame({ reseed: true });
    });
    this.restartWinBtn.addEventListener("click", async () => {
      await ensureAudio();
      this.sfx.click();
      this.hideWin();
      this.restart();
    });

    window.addEventListener("keydown", async (e) => {
      if (!this.overlay.hidden) return;

      const key = e.key.toLowerCase();
      const now = performance.now();

      // First keypress: unlock audio.
      await ensureAudio();

      let dr = 0;
      let dc = 0;
      if (key === "arrowup" || key === "w") dr = -1;
      else if (key === "arrowdown" || key === "s") dr = 1;
      else if (key === "arrowleft" || key === "a") dc = -1;
      else if (key === "arrowright" || key === "d") dc = 1;
      else return;

      e.preventDefault();
      this._startIfNeeded();

      const ok = this.player.tryMove(dr, dc, now);
      if (!ok) return;
      this.sfx.move();
      this._scheduleRAF();
    });

    // Pointer controls (mouse drag + touch swipe).
    const swipe = { active: false, id: 0, x: 0, y: 0 };
    const swipeThreshold = 24;

    const endSwipe = (e) => {
      if (!swipe.active) return;
      if (e.pointerId !== swipe.id) return;
      swipe.active = false;
      swipe.id = 0;
    };

    this.canvas.addEventListener(
      "pointerdown",
      async (e) => {
        if (!this.overlay.hidden) return;
        if (e.button != null && e.button !== 0) return;

        await ensureAudio();
        swipe.active = true;
        swipe.id = e.pointerId;
        swipe.x = e.clientX;
        swipe.y = e.clientY;
        this.canvas.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      },
      { passive: false }
    );

    this.canvas.addEventListener(
      "pointermove",
      async (e) => {
        if (!swipe.active) return;
        if (e.pointerId !== swipe.id) return;
        if (!this.player) return;

        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.abs(dx) < swipeThreshold && Math.abs(dy) < swipeThreshold) return;

        e.preventDefault();
        let dr = 0;
        let dc = 0;
        if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
        else dr = dy > 0 ? 1 : -1;

        swipe.x = e.clientX;
        swipe.y = e.clientY;

        this._startIfNeeded();
        const ok = this.player.tryMove(dr, dc, performance.now());
        if (!ok) return;
        this.sfx.move();
        this._scheduleRAF();
      },
      { passive: false }
    );

    this.canvas.addEventListener("pointerup", endSwipe);
    this.canvas.addEventListener("pointercancel", endSwipe);  }

  newGame({ reseed }) {
    const { rows, cols } = DIFFICULTIES[this.difficulty] ?? DIFFICULTIES.medium;
    const seed = reseed ? (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0 : (this.maze?.seed ?? Date.now());

    this.maze = MazeGenerator.generate(rows, cols, seed);
    console.log('DEBUG: Generated maze, size:', this.maze.size, 'start:', this.maze.start);
    this.renderer.setMaze(this.maze);
    console.log('DEBUG: Called setMaze');

    this.solutionPath = bfsShortestPath(this.maze, this.maze.start, this.maze.end) ?? null;
    this.nextToEnd = buildNextStepToEnd(this.maze, this.maze.end);

    this.showSolution = false;
    this._fogWasEnabled = false;
    this.solveBtn.textContent = "Show Solution";

    if (!this.player) {
      this.player = new PlayerController({
        maze: this.maze,
        renderer: this.renderer,
        onMoveCommitted: () => this._onMoveCommitted(),
        onBlocked: () => this.sfx.blocked(),
      });
    } else {
      this.player.setMaze(this.maze);
    }

    this.fogEnabled = false;

    this.hintsRemaining = 3;
    this.hintIndex = null;
    this.hintsLeftEl.textContent = String(this.hintsRemaining);

    this.moves = 0;
    this.startedAt = 0;
    this.endedAt = 0;
    this._stopTimer();

    this._renderBest();
    this._renderHud();
    this.renderOnce();
  }

  restart() {
    this.showSolution = false;
    this.solveBtn.textContent = "Show Solution";

    this.fogEnabled = false;

    this.hintsRemaining = 3;
    this.hintIndex = null;
    this.hintsLeftEl.textContent = String(this.hintsRemaining);

    this.moves = 0;
    this.startedAt = 0;
    this.endedAt = 0;
    this._stopTimer();

    this.player.resetToStart();
    this._renderHud();
    this.renderOnce();
  }

  toggleSolution() {
    this.showSolution = !this.showSolution;
    this.solveBtn.textContent = this.showSolution ? "Hide Solution" : "Show Solution";

    // UX: a full solution is most useful without fog.
    if (this.showSolution) {
      this._fogWasEnabled = this.fogEnabled;
      this.fogEnabled = false;
      if (this.fogToggle) this.fogToggle.checked = false;
    } else {
      this.fogEnabled = !!this._fogWasEnabled;
      if (this.fogToggle) this.fogToggle.checked = this.fogEnabled;
    }

    this.renderOnce();
  }

  useHint() {
    if (this.hintsRemaining <= 0) return;
    if (!this.nextToEnd) return;

    const next = this.nextToEnd[this.player.cellIndex];
    if (next < 0 || next === this.player.cellIndex) return;

    this.hintsRemaining -= 1;
    this.hintsLeftEl.textContent = String(this.hintsRemaining);

    this.hintIndex = next;
    this.hintPulseT0 = performance.now();
    this._scheduleRAF();
  }

  _startIfNeeded() {
    if (this.startedAt) return;
    this.startedAt = performance.now();
    this._startTimer();
  }

  _onMoveCommitted() {
    this.moves += 1;
    this.hintIndex = null;
    this._renderHud();

    if (this.player.cellIndex === this.maze.end) {
      this._win();
      return;
    }

    this.renderOnce();
  }

  _elapsedMs(now = performance.now()) {
    if (!this.startedAt) return 0;
    if (this.endedAt) return this.endedAt - this.startedAt;
    return now - this.startedAt;
  }

  _renderHud() {
    this.movesEl.textContent = String(this.moves);
    const elapsed = this._elapsedMs();
    this.timeEl.textContent = formatTime(elapsed);
    this.scoreEl.textContent = String(computeScore({ elapsedMs: elapsed, moves: this.moves }));
  }

  _renderBest() {
    const best = readBest(this.difficulty);
    if (!best) {
      this.bestEl.textContent = "—";
      this.bestMetaEl.textContent = "";
      return;
    }
    this.bestEl.textContent = String(best.score);
    this.bestMetaEl.textContent = `${formatTime(best.elapsedMs)} • ${best.moves} moves`;
  }

  _startTimer() {
    this._stopTimer();
    this.timerHandle = window.setInterval(() => {
      if (this.endedAt) return;
      this._renderHud();
    }, 120);
  }

  _stopTimer() {
    if (!this.timerHandle) return;
    window.clearInterval(this.timerHandle);
    this.timerHandle = null;
  }

  _win() {
    this.endedAt = performance.now();
    this._stopTimer();
    this._renderHud();
    this.sfx.win();

    const elapsedMs = this._elapsedMs(this.endedAt);
    const score = computeScore({ elapsedMs, moves: this.moves });

    const best = readBest(this.difficulty);
    const isNewBest = !best || score < best.score;

    if (isNewBest) {
      writeBest(this.difficulty, {
        score,
        elapsedMs,
        moves: this.moves,
        seed: this.maze.seed,
        when: new Date().toISOString(),
      });
      this._renderBest();
    }

    this.showWin({ elapsedMs, score, isNewBest });
  }

  showWin({ elapsedMs, score, isNewBest }) {
    this.newBestBadge.hidden = !isNewBest;

    this.winStatsEl.innerHTML = `
      <div class="card"><div class="card__label">Difficulty</div><div class="card__value">${this.difficulty.toUpperCase()}</div></div>
      <div class="card"><div class="card__label">Score</div><div class="card__value">${score}</div></div>
      <div class="card"><div class="card__label">Time</div><div class="card__value">${formatTime(elapsedMs)}</div></div>
      <div class="card"><div class="card__label">Moves</div><div class="card__value">${this.moves}</div></div>
    `;

    this.overlay.hidden = false;
  }

  hideWin() {
    this.overlay.hidden = true;
  }

  renderOnce() {
    console.log('DEBUG: renderOnce called');
    const now = performance.now();
    const hintPulse = this.hintIndex != null ? (Math.sin((now - this.hintPulseT0) / 140) + 1) / 2 : 0;

    this.renderer.render({
      playerPixel: this.player.pixel,
      fogEnabled: this.fogEnabled,
      fogRadiusCells: this.fogRadiusCells,
      showSolution: this.showSolution,
      solutionPath: this.solutionPath,
      hintIndex: this.hintIndex,
      hintPulse,
    });
  }

  _scheduleRAF() {
    if (this._raf) return;

    const tick = () => {
      this._raf = 0;
      const now = performance.now();

      let needsMore = false;
      if (this.player.animating) {
        this.player.tick(now);
        needsMore = true;
      }

      if (this.hintIndex != null) {
        if (now - this.hintPulseT0 < 1400) needsMore = true;
        else this.hintIndex = null;
      }

      this.renderOnce();
      if (needsMore) this._raf = requestAnimationFrame(tick);
    };

    this._raf = requestAnimationFrame(tick);
  }
}

new MazeGame();
// ===== END game.js =====


import { WALL_BOTTOM, WALL_LEFT, WALL_RIGHT, WALL_TOP } from "./maze-generator-fixed.js";

function isLightTheme() {
  return document.documentElement.getAttribute("data-theme") === "light";
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

export class MazeRenderer {
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
    const cssW = Math.max(280, Math.floor(rect.width));
    const cssH = Math.max(280, Math.floor(rect.height)); // use rect height for better mobile fit

    this.canvas.width = cssW * this.dpr;
    this.canvas.height = cssH * this.dpr;
    this.canvas.style.height = `${cssH}px`;

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
    ctx.lineWidth = Math.max(4, Math.floor(this.dpr * 3.2)); // thicker walls
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




// Player control: keyboard input + smooth cell-to-cell animation.

export class PlayerController {
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

// Maze generation using Recursive Backtracking (DFS).
// Representation: a grid of cells, each with 4 walls.
//
// Walls are stored as a 4-bit mask for performance:
// 1 = top, 2 = right, 4 = bottom, 8 = left
//
// A carved passage removes walls between neighboring cells.

export const WALL_TOP = 1;
export const WALL_RIGHT = 2;
export const WALL_BOTTOM = 4;
export const WALL_LEFT = 8;
export const WALL_ALL = WALL_TOP | WALL_RIGHT | WALL_BOTTOM | WALL_LEFT;

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

export class Maze {
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

export class MazeGenerator {
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

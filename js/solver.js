// BFS solver for shortest path in a perfect maze.
// (A* isn't necessary here, but BFS is fast and guarantees shortest path.)

export function bfsShortestPath(maze, startIndex, endIndex) {
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
export function buildNextStepToEnd(maze, endIndex) {
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

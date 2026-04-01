import { MazeGenerator } from "./maze-generator-fixed.js";
import { MazeRenderer } from "./maze-renderer.js";
import { bfsShortestPath, buildNextStepToEnd } from "./solver.js";
import { PlayerController } from "./player-controller.js";
import { SoundFX } from "./sound.js";

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



import Phaser from "phaser";

// ── Simulation constants ───────────────────────────────────────────────────────
const NODE_COUNT    = 20;
const REST_SLACK    = 1.022;   // rope length / straight-line distance; drives sag
const SAG_PX        = 52;      // initial parabolic midpoint dip
const GRAVITY       = 900;     // px/s²
const SUBSTEPS      = 3;       // Verlet sub-steps per frame
const CONSTR_ITERS  = 10;      // constraint solver iterations per sub-step

// ── Visual constants ───────────────────────────────────────────────────────────
const ROPE_Y_FRAC   = 0.38;    // rope attach height as fraction of screen height
const TAPE_Y_OFFSET = 22;      // px below rope anchor
const TAPE_H        = 38;
const POLE_W        = 14;
const POLE_COLOR    = 0x9b7722;
const ROPE_COLOR    = 0xe8d9a0;
const ROPE_THICK    = 4;

// ── Types ──────────────────────────────────────────────────────────────────────
type FinishState = "scrolling" | "triggered" | "done";

interface Node {
  x:  number;
  y:  number;
  px: number; // previous x (Verlet)
  py: number; // previous y (Verlet)
  pinned: boolean;
}

// ── FinishLine ────────────────────────────────────────────────────────────────
export class FinishLine {
  private readonly scene:    Phaser.Scene;
  private readonly onFinish: () => void;

  private readonly W:          number;
  private readonly H:          number;
  private readonly lineWidth:  number;
  private readonly ropeY:      number;
  private readonly tapeY:      number;
  private readonly groundY:    number;
  private readonly restLen:    number;

  private gfx!:  Phaser.GameObjects.Graphics;
  private tape!: Phaser.GameObjects.TileSprite;

  private finishX: number;  // screen-x of the line's centre
  private state:   FinishState = "scrolling";
  private nodes:   Node[] = [];
  private destroyed = false;

  constructor(scene: Phaser.Scene, onFinish: () => void) {
    this.scene    = scene;
    this.onFinish = onFinish;

    this.W         = scene.scale.width;
    this.H         = scene.scale.height;
    this.lineWidth = Math.round(this.W * 0.22);
    this.ropeY     = Math.round(this.H * ROPE_Y_FRAC);
    this.tapeY     = this.ropeY + TAPE_Y_OFFSET;
    this.groundY   = Math.round(this.H * 0.85);

    // Segment rest-length based on narrower line width
    const straightSeg = this.lineWidth / (NODE_COUNT - 1);
    this.restLen      = straightSeg * REST_SLACK;

    // Start far enough right that even the left pole is off-screen
    this.finishX = this.W + this.lineWidth / 2 + 100;

    this.ensureTextures();
    this.buildVisuals();
    this.initNodes();
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  /**
   * Call from GameScene.update() every frame.
   * Pass speed=0 once the game has ended to let only the break physics run.
   */
  update(delta: number, speed: number): void {
    if (this.state === "done") return;

    // Cap dt to prevent physics explosion on tab-back / slow frames
    const dt = Math.min(delta / 1000, 1 / 30);

    if (this.state === "scrolling") {
      const dx = -speed * dt;
      this.translateNodes(dx);
      this.finishX += dx;
      this.tape.setX(this.finishX - this.lineWidth / 2);

      // Finish line stops when left pole reaches the player
      const stopX = this.W * 0.15 + this.lineWidth / 2 + 60;
      if (this.finishX <= stopX) {
        this.finishX = stopX;
        this.tape.setX(this.finishX - this.lineWidth / 2);
        this.triggerBreak();
      }
    } else if (this.state === "triggered") {
      this.simulate(dt);
    }

    this.draw();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.gfx.active)  this.gfx.destroy();
    if (this.tape.active) this.tape.destroy();
  }

  // ── Break trigger ──────────────────────────────────────────────────────────

  private triggerBreak(): void {
    this.state = "triggered";

    // Unpin every node and scatter them outward / upward
    for (const n of this.nodes) {
      n.pinned = false;

      const angle = Phaser.Math.FloatBetween(-2.6, -0.5); // mostly upward
      const spd   = Phaser.Math.Between(180, 550);        // px/s
      const kickDt = 1 / 60;
      n.px = n.x - Math.cos(angle) * spd * kickDt;
      n.py = n.y - Math.sin(angle) * spd * kickDt;
    }

    this.playVictorySound();

    // Fade + cleanup after the scatter settles
    this.scene.tweens.add({
      targets:  [this.gfx, this.tape],
      alpha:    0,
      delay:    420,
      duration: 680,
      ease:     "Sine.easeIn",
      onComplete: () => this.destroy(),
    });

    this.onFinish();
  }

  // ── Verlet simulation ──────────────────────────────────────────────────────

  private simulate(dt: number): void {
    const subDt = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      this.integrate(subDt);
      this.solveConstraints();
    }
  }

  private integrate(dt: number): void {
    const g = GRAVITY * dt * dt;
    for (const n of this.nodes) {
      if (n.pinned) continue;
      const vx = n.x - n.px;
      const vy = n.y - n.py;
      n.px = n.x;
      n.py = n.y;
      n.x += vx;
      n.y += vy + g;
    }
  }

  private solveConstraints(): void {
    for (let iter = 0; iter < CONSTR_ITERS; iter++) {
      for (let i = 0; i < this.nodes.length - 1; i++) {
        const a = this.nodes[i];
        const b = this.nodes[i + 1];

        const dx  = b.x - a.x;
        const dy  = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const err = (len - this.restLen) / len; // >0 means too far apart

        const aMoves = !a.pinned;
        const bMoves = !b.pinned;
        if (!aMoves && !bMoves) continue;

        const share = aMoves && bMoves ? 0.5 : 1.0;
        if (aMoves) { a.x += dx * err * share;  a.y += dy * err * share;  }
        if (bMoves) { b.x -= dx * err * share;  b.y -= dy * err * share;  }
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Translate entire rope as a rigid body (used during scroll-in). */
  private translateNodes(dx: number): void {
    for (const n of this.nodes) {
      n.x  += dx;
      n.px += dx; // preserve implicit velocity
    }
  }

  private initNodes(): void {
    const lx = this.finishX - this.lineWidth / 2;
    const rx = this.finishX + this.lineWidth / 2;

    for (let i = 0; i < NODE_COUNT; i++) {
      const t   = i / (NODE_COUNT - 1);
      const x   = lx + (rx - lx) * t;
      const sag = SAG_PX * 4 * t * (1 - t); // parabola; max dip at midpoint
      const y   = this.ropeY + sag;
      this.nodes.push({ x, y, px: x, py: y, pinned: i === 0 || i === NODE_COUNT - 1 });
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private buildVisuals(): void {
    // Tape spans the finish line width only
    this.tape = this.scene.add
      .tileSprite(this.finishX - this.lineWidth / 2, this.tapeY, this.lineWidth, TAPE_H, "finish_tape")
      .setOrigin(0, 0.5)
      .setDepth(9);

    this.gfx = this.scene.add.graphics().setDepth(10);
  }

  private draw(): void {
    this.gfx.clear();

    const lx         = this.finishX - this.lineWidth / 2;
    const rx         = this.finishX + this.lineWidth / 2;
    const poleHeight = Math.min(this.H * 0.25, 180);
    const poleTop    = this.groundY - poleHeight;

    // Poles — metallic gradient approximated with two tones
    this.gfx.fillStyle(POLE_COLOR, 1);
    this.gfx.fillRect(lx, poleTop, POLE_W, poleHeight);
    this.gfx.fillRect(rx - POLE_W, poleTop, POLE_W, poleHeight);

    // Pole highlight (left edge lighter strip)
    this.gfx.fillStyle(0xffd97a, 0.45);
    this.gfx.fillRect(lx, poleTop, 3, poleHeight);
    this.gfx.fillRect(rx - POLE_W, poleTop, 3, poleHeight);

    // Rope — connect all nodes with line segments
    if (this.nodes.length >= 2) {
      // Shadow pass for depth
      this.gfx.lineStyle(ROPE_THICK + 2, 0x000000, 0.35);
      this.gfx.beginPath();
      this.gfx.moveTo(this.nodes[0].x + 2, this.nodes[0].y + 2);
      for (let i = 1; i < this.nodes.length; i++) {
        this.gfx.lineTo(this.nodes[i].x + 2, this.nodes[i].y + 2);
      }
      this.gfx.strokePath();

      // Main rope pass
      this.gfx.lineStyle(ROPE_THICK, ROPE_COLOR, 1);
      this.gfx.beginPath();
      this.gfx.moveTo(this.nodes[0].x, this.nodes[0].y);
      for (let i = 1; i < this.nodes.length; i++) {
        this.gfx.lineTo(this.nodes[i].x, this.nodes[i].y);
      }
      this.gfx.strokePath();

      // Bright highlight pass (top half of rope)
      this.gfx.lineStyle(1, 0xfffff0, 0.55);
      this.gfx.beginPath();
      this.gfx.moveTo(this.nodes[0].x, this.nodes[0].y - 1);
      for (let i = 1; i < this.nodes.length; i++) {
        this.gfx.lineTo(this.nodes[i].x, this.nodes[i].y - 1);
      }
      this.gfx.strokePath();
    }
  }

  // ── Placeholder textures ──────────────────────────────────────────────────

  private ensureTextures(): void {
    if (!this.scene.textures.exists("finish_tape")) this.makeCheckerTape();
    if (!this.scene.textures.exists("rope_segment")) this.makeRopeSegment();
  }

  /** Classic black-and-white checkered finish banner. */
  private makeCheckerTape(): void {
    const w    = 80;  // tile width (TileSprite repeats it)
    const h    = TAPE_H;
    const cell = h / 2;
    const gfx  = this.scene.make.graphics({ x: 0, y: 0 }, false);

    for (let tx = 0; tx < Math.ceil(w / cell); tx++) {
      for (let ty = 0; ty < 2; ty++) {
        gfx.fillStyle((tx + ty) % 2 === 0 ? 0x111111 : 0xffffff, 1);
        gfx.fillRect(tx * cell, ty * cell, cell, cell);
      }
    }
    // Thin gold border top & bottom
    gfx.fillStyle(0xffcc44, 1);
    gfx.fillRect(0, 0, w, 3);
    gfx.fillRect(0, h - 3, w, 3);

    gfx.generateTexture("finish_tape", w, h);
    gfx.destroy();
  }

  /** Small tileable rope texture (used as a future asset hint; not rendered). */
  private makeRopeSegment(): void {
    const gfx = this.scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(0xddc878, 1);
    gfx.fillRect(0, 0, 32, 8);
    gfx.fillStyle(0xbba855, 1);
    gfx.fillRect(0, 2, 32, 4);
    gfx.generateTexture("rope_segment", 32, 8);
    gfx.destroy();
  }

  // ── Victory sound ─────────────────────────────────────────────────────────

  private playVictorySound(): void {
    if (!(this.scene.sound instanceof Phaser.Sound.WebAudioSoundManager)) return;
    const ctx = this.scene.sound.context;

    // C5 – E5 – G5 – C6 ascending fanfare
    const notes    = [523.25, 659.25, 783.99, 1046.50];
    const noteDur  = 0.13;
    const velocity = 0.18;

    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = "triangle";
      const t = ctx.currentTime + i * noteDur;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(velocity, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDur * 0.88);
      osc.start(t);
      osc.stop(t + noteDur);
    });
  }
}

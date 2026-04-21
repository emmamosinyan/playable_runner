import Phaser from "phaser";

// ── Physics constants ─────────────────────────────────────────────────────────
const GRAVITY       = 1200;
const JUMP_VELOCITY = -700;

// Ground surface is at H * GROUND_FRAC — must match GameScene.groundY
const GROUND_FRAC = 0.82;

// ── Player spritesheet frame layout ──────────────────────────────────────────
// Source image: 1446×781 px, loaded as a plain image (not spritesheet)
// All rows share: leftMargin = 35, stride = 170
//
// Row 1 — stand  ( 4 frames)  y =   0  w = 120  h = 200
// Row 2 — run    ( 8 frames)  y = 193  w = 120  h = 200
// Row 3 — jump   ( 7 frames)  y = 393  w = 120  h = 200
// Row 4 — damage ( 4 frames)  y = 619  w = 120  h = 162
const MARGIN   = 35;
const STRIDE   = 170;
const FRAME_H  = 200;  // stand/run row height; used for spawn Y calculation

const ROWS = [
  { prefix: "stand",  y:   0, count:  4, w: 140, h: 195 },
  { prefix: "run",    y: 193, count:  8, w: 140, h: 195 },
  { prefix: "jump",   y: 393, count:  7, w: 180, h: 195 },
  { prefix: "damage", y: 619, count:  4, w: 140, h: 162 },
] as const;

function registerPlayerFrames(scene: Phaser.Scene): void {
  const texture = scene.textures.get("player");
  for (const { prefix, count } of ROWS) {
    for (let i = 0; i < count; i++) {
      texture.remove(`${prefix}_${i}`);
    }
  }
  for (const { prefix, y, count, w, h } of ROWS) {
    for (let i = 0; i < count; i++) {
      texture.add(`${prefix}_${i}`, 0, MARGIN + i * STRIDE, y, w, h);
    }
  }
}

// ── Dust constants ────────────────────────────────────────────────────────────
const DUST_FRAME_W = 16;
const DUST_FRAME_H = 16;
const DUST_FRAMES  =  4;

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerState = "idle" | "running" | "dead" | "finished";

interface AnimDef {
  key:    string;
  prefix: string;
  count:  number;
  rate:   number;
  repeat: number;
}

// ── Player ────────────────────────────────────────────────────────────────────
export class Player extends Phaser.Physics.Arcade.Sprite {
  private playerState: PlayerState = "idle";
  private canDoubleJump = false;
  private wasGrounded   = false;
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private lives       = 3;
  private isInvincible = false;
  private flashTimer: Phaser.Time.TimerEvent | null = null;
  private readonly INVINCIBLE_MS  = 1500;
  private readonly FLASH_INTERVAL = 100;

  constructor(
    scene: Phaser.Scene,
    groundGroup: Phaser.Physics.Arcade.StaticGroup,
    groundY = Math.round(scene.scale.height * GROUND_FRAC),
  ) {
    // Register named frames before super() — Phaser resolves 'stand_0' immediately
    registerPlayerFrames(scene);

    const scale = (scene.scale.height * 0.22) / 188;
    const x     = Math.round(scene.scale.width * 0.15);
    const y     = groundY - Math.round(FRAME_H * scale) + 5;

    super(scene, x, y, "player", "stand_0");

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(scale);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setGravityY(GRAVITY);
    body.setMaxVelocityY(1400);
    body.setSize(90, 165);
    body.setOffset(32, 20);

    scene.physics.add.collider(this, groundGroup);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.flashTimer?.remove();
    });

    this.ensureDustTexture();
    this.createAnimations();
    this.createDustEmitter();
    this.registerInput();

    this.play("player-stand");
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  public rescale(): void {
    const H     = this.scene.scale.height;
    const scale = (H * 0.22) / 188;
    this.setScale(scale);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(90, 165);
    body.setOffset(32, 20);

    const groundY = Math.round(H * 0.82);
    this.setY(groundY - Math.round(200 * scale) + 5);
  }

  // ── Lifecycle (called by GameScene.update) ────────────────────────────────

  tick(): void {
    if (this.playerState === "dead" || this.playerState === "finished") return;

    const body     = this.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down;

    if (!this.wasGrounded && grounded) {
      this.handleLanding();
    }
    this.wasGrounded = grounded;

    // Keep jump anim active for the full airborne window
    if (this.playerState === "running" && !grounded) {
      if (this.anims.currentAnim?.key !== "player-jump") {
        this.play("player-jump", true);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  startRunning(): void {
    this.playerState = "running";
    this.play("player-run", true);
  }

  die(): void {
    if (this.playerState === "dead") return;
    this.playerState = "dead";
    this.play("player-dead", true);
    (this.body as Phaser.Physics.Arcade.Body).setVelocityY(-280);
  }

  finish(): void {
    if (this.playerState === "finished") return;
    this.playerState = "finished";
    this.play("player-run", true);
  }

  getLives(): number { return this.lives; }

  resetLives(): void {
    this.lives        = 3;
    this.isInvincible = false;
    this.flashTimer?.remove();
    this.flashTimer = null;
    this.setAlpha(1);
  }

  takeDamage(): boolean {
    if (this.isInvincible) return false;

    this.lives--;

    this.play("player-dead", true);
    this.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.lives > 0) this.play("player-run", true);
    });

    if (this.lives <= 0) {
      this.isInvincible = true; // prevent double death
      return true;
    }

    this.isInvincible = true;
    let flashCount    = 0;
    const maxFlashes  = this.INVINCIBLE_MS / this.FLASH_INTERVAL;

    this.flashTimer = this.scene.time.addEvent({
      delay:    this.FLASH_INTERVAL,
      repeat:   maxFlashes - 1,
      callback: () => {
        this.setAlpha(this.alpha === 1 ? 0.3 : 1);
        flashCount++;
        if (flashCount >= maxFlashes) {
          this.setAlpha(1);
          this.isInvincible = false;
        }
      },
    });

    return false;
  }

  // ── Jump ──────────────────────────────────────────────────────────────────

  tryJump(): void {
    if (this.playerState !== "running") return;

    const body = this.body as Phaser.Physics.Arcade.Body;

    if (body.blocked.down) {
      body.setVelocityY(JUMP_VELOCITY);
      this.canDoubleJump = true;
      this.play("player-jump", true);
    } else if (this.canDoubleJump) {
      body.setVelocityY(JUMP_VELOCITY);
      this.canDoubleJump = false;
      this.play("player-jump", true);
    }
  }

  private handleLanding(): void {
    this.canDoubleJump = false;

    if (this.playerState === "running") {
      this.play("player-run", false);
    }

    this.dustEmitter.explode(
      8,
      this.x,
      this.y + this.displayHeight * 0.5,
    );
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private registerInput(): void {
    this.scene.input.on("pointerdown", this.tryJump, this);
  }

  // ── Animations ────────────────────────────────────────────────────────────

  private createAnimations(): void {
    const anims = this.scene.anims;

    const defs: AnimDef[] = [
      { key: "player-stand", prefix: "stand",  count:  4, rate:  5, repeat: -1 },
      { key: "player-run",   prefix: "run",    count:  5, rate:  5, repeat: -1 },
      { key: "player-jump",  prefix: "jump",   count:  5, rate: 10, repeat:  0 },
      { key: "player-dead",  prefix: "damage", count:  4, rate:  8, repeat:  0 },
    ];

    for (const { key, prefix, count, rate, repeat } of defs) {
      if (anims.exists(key)) anims.remove(key);
      anims.create({
        key,
        frames: Array.from({ length: count }, (_, i) => ({
          key:   "player",
          frame: `${prefix}_${i}`,
        })),
        frameRate: rate,
        repeat,
      });
    }
  }

  // ── Dust particles ────────────────────────────────────────────────────────

  private ensureDustTexture(): void {
    if (this.scene.textures.exists("particle_dust")) return;

    const gfx = this.scene.make.graphics({ x: 0, y: 0 }, false);

    for (let i = 0; i < DUST_FRAMES; i++) {
      const t      = i / DUST_FRAMES;
      const radius = (DUST_FRAME_W / 2) * (1 - t * 0.75);
      gfx.fillStyle(0xd4b896, 0.9 - t * 0.7);
      gfx.fillCircle(
        i * DUST_FRAME_W + DUST_FRAME_W / 2,
        DUST_FRAME_H / 2,
        radius,
      );
    }

    gfx.generateTexture("particle_dust", DUST_FRAME_W * DUST_FRAMES, DUST_FRAME_H);
    gfx.destroy();

    const texture = this.scene.textures.get("particle_dust");
    for (let i = 0; i < DUST_FRAMES; i++) {
      texture.add(i, 0, i * DUST_FRAME_W, 0, DUST_FRAME_W, DUST_FRAME_H);
    }
  }

  private createDustEmitter(): void {
    this.dustEmitter = this.scene.add.particles(0, 0, "particle_dust", {
      frame:    [0, 1, 2, 3],
      lifespan: 380,
      speed:    { min: 25, max: 85 },
      angle:    { min: -165, max: -15 },
      scale:    { start: 1.0, end: 0  },
      alpha:    { start: 0.9, end: 0  },
      emitting: false,
    });
  }
}

import Phaser from "phaser";

// ── Physics constants ─────────────────────────────────────────────────────────
const GRAVITY = 1200;

// Ground surface is at H * GROUND_FRAC — must match GameScene.groundY
const GROUND_FRAC = 0.82;

// ── Player spritesheet frame layout ──────────────────────────────────────────
// Source image: 1423×752 px, 8 cols × 4 rows → frameWidth=177, frameHeight=188
// stand  row 0: frames  0– 3
// run    row 1: frames  8–15
// jump   row 2: frames 16–23
// damage row 3: frames 24–27
const FRAME_H = 189; // spritesheet frame height; base for scale

// ── Dust constants ────────────────────────────────────────────────────────────
const DUST_FRAME_W = 16;
const DUST_FRAME_H = 16;
const DUST_FRAMES  =  4;

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerState = "idle" | "running" | "damaged" | "dead" | "finished";

// ── Player ────────────────────────────────────────────────────────────────────
export class Player extends Phaser.Physics.Arcade.Sprite {
  /** Current jump peak in px above ground — read by CoinManager to size arcs. */
  public static jumpPeakPx = 0;

  private playerState: PlayerState = "idle";
  private wasGrounded = false;
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  private lives        = 3;
  private isInvincible = false;
  private flashTimer: Phaser.Time.TimerEvent | null = null;
  readonly INVINCIBLE_MS  = 1500;
  private readonly FLASH_INTERVAL = 100;

  private jumpVelocity: number;

  constructor(
    scene: Phaser.Scene,
    groundGroup: Phaser.Physics.Arcade.StaticGroup,
    groundY = Math.round(scene.scale.height * GROUND_FRAC),
  ) {
    const scale = (scene.scale.height * 0.22) / FRAME_H;
    const x     = Math.round(scene.scale.width * 0.15);
    const y     = groundY; // origin is bottom-center, so y = ground level

    super(scene, x, y, "player", 0);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    // Bottom-center origin: feet always sit exactly on groundY
    this.setOrigin(0.5, 1);

    this.jumpVelocity  = this.calcJumpVelocity();
    Player.jumpPeakPx  = (this.jumpVelocity * this.jumpVelocity) / (2 * 1200);

    this.setScale(scale);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setGravityY(GRAVITY);
    body.setMaxVelocityY(1400);
    // Frame is 177w × 188h local pixels.
    // Body: 60w (~34%), 155h (~82%). offset x=58, offset y=30
    body.setSize(60, 155);
    body.setOffset(58, 30);

    scene.physics.add.collider(this, groundGroup);

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.flashTimer?.remove();
    });

    this.ensureDustTexture();
    this.createAnimations();
    this.createDustEmitter();
    this.registerInput();

    this.safePlay("player-stand");
  }

  // ── Jump velocity ─────────────────────────────────────────────────────────

  private calcJumpVelocity(): number {
    const H      = this.scene.scale.height;
    // Enemy height = H * 0.22; player needs to clear it with comfortable margin
    const peakPx = H * 0.22 * 1.25;
    return -Math.sqrt(2 * 1200 * peakPx);
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  public rescale(): void {
    const H     = this.scene.scale.height;
    const scale = (H * 0.22) / FRAME_H;
    this.setScale(scale);
    this.jumpVelocity  = this.calcJumpVelocity();
    Player.jumpPeakPx  = (this.jumpVelocity * this.jumpVelocity) / (2 * 1200);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(60, 155);
    body.setOffset(58, 30);

    const groundY = Math.round(H * 0.82);
    this.setY(groundY); // origin is bottom-center
  }

  // ── Lifecycle (called by GameScene.update) ────────────────────────────────

  tick(): void {
    if (this.playerState === "dead"     ||
        this.playerState === "finished" ||
        this.playerState === "damaged") return;

    const body     = this.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down;

    if (!this.wasGrounded && grounded) {
      this.handleLanding();
    }
    this.wasGrounded = grounded;

    // Keep jump anim active for the full airborne window
    if (this.playerState === "running" && !grounded) {
      if (this.anims.currentAnim?.key !== "player-jump") {
        this.safePlay("player-jump");
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  startRunning(): void {
    this.playerState = "running";
    this.safePlay("player-run");
  }

  die(): void {
    if (this.playerState === "dead") return;
    this.playerState = "dead";
    this.safePlay("player-dead");
    (this.body as Phaser.Physics.Arcade.Body).setVelocityY(-280);
  }

  finish(): void {
    if (this.playerState === "finished") return;
    this.playerState = "finished";
    this.safePlay("player-stand");
  }

  getLives(): number { return this.lives; }

  public getIsInvincible(): boolean { return this.isInvincible; }

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

    if (this.lives <= 0) {
      this.isInvincible = true; // prevent double death
      return true;
    }

    this.isInvincible = true;
    this.playerState  = "damaged"; // prevent tick() from overriding the anim

    // Play damage animation
    this.safePlay("player-dead");

    // Use delayedCall instead of ANIMATION_COMPLETE so it always fires
    // regardless of animation state. 4 frames @ 10 fps = 400 ms.
    this.scene.time.delayedCall(400, () => {
      // Only return to running if still in damaged state
      // (not dead/finished from a later hit)
      if (this.playerState === "damaged") {
        this.playerState = "running";
        this.safePlay("player-run");
      }
    });

    // Flash effect
    let flashCount   = 0;
    const maxFlashes = this.INVINCIBLE_MS / this.FLASH_INTERVAL;

    this.flashTimer?.remove();
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
      body.setVelocityY(this.jumpVelocity);
      this.safePlay("player-jump");
    }
  }

  private handleLanding(): void {
    if (this.playerState === "running") {
      if (!this.scene.anims.exists("player-run")) this.createAnimations();
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

  private safePlay(key: string): void {
    // Recreate all animations if the requested one is missing
    if (!this.scene.anims.exists(key)) {
      this.createAnimations();
    }
    if (this.scene.anims.exists(key)) {
      this.play(key, true);
    }
  }

  private createAnimations(): void {
    if (!this.scene.textures.exists("player")) return;

    const anims = this.scene.anims;

    const defs = [
      { key: "player-stand", start:  0, end:  3, rate:  6, repeat: -1 },
      { key: "player-run",   start:  8, end: 15, rate:  8, repeat: -1 },
      { key: "player-jump",  start: 16, end: 23, rate:  5, repeat:  0 },
      { key: "player-dead",  start: 24, end: 27, rate: 10, repeat:  0 },
    ];

    for (const { key, start, end, rate, repeat } of defs) {
      if (anims.exists(key)) anims.remove(key);
      anims.create({
        key,
        frames:    anims.generateFrameNumbers("player", { start, end }),
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

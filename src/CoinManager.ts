import Phaser from "phaser";

// ── Config ────────────────────────────────────────────────────────────────────
const COIN_DISPLAY  = 90;  // rendered px (square)
const POOL_MAX      = 15;

interface ActiveCoin {
  sprite:    Phaser.Physics.Arcade.Sprite;
  collected: boolean;
}

// ── CoinManager ───────────────────────────────────────────────────────────────
export class CoinManager {
  private readonly scene:   Phaser.Scene;
  private readonly group:   Phaser.Physics.Arcade.StaticGroup;
  private readonly groundY: number;
  private readonly onMiss:  () => void; // called when a coin exits off-screen uncollected

  private speed           = 300;
  private frozen          = false;
  private spawningEnabled = true;

  private readonly active: ActiveCoin[] = [];
  private readonly pool:   Phaser.Physics.Arcade.Sprite[] = [];

  constructor(scene: Phaser.Scene, groundY: number, onMiss: () => void) {
    this.scene   = scene;
    this.groundY = groundY;
    this.onMiss  = onMiss;
    this.group   = scene.physics.add.staticGroup();
    this.ensureAnimation();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setSpeed(n: number): void { this.speed = n; }

  getGroup(): Phaser.Physics.Arcade.StaticGroup { return this.group; }

  /** Called from the physics overlap callback with the coin sprite. */
  collectCoin(sprite: Phaser.Physics.Arcade.Sprite): void {
    const idx = this.active.findIndex((a) => a.sprite === sprite);
    if (idx === -1) return;
    this.active[idx].collected = true;
    this.active.splice(idx, 1);
    this.recycle(sprite);
  }

  update(delta: number): void {
    if (this.frozen) return;
    this.scrollActive(delta);
  }

  freeze(): void { this.frozen = true; }

  stopSpawning(): void { this.spawningEnabled = false; }

  clearActive(): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      this.recycleCoin(this.active[i].sprite);
    }
    this.active.length = 0;
  }

  private recycleCoin(sprite: Phaser.Physics.Arcade.Sprite): void {
    sprite.setActive(false).setVisible(false);
    const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
    body.enable = false;
    body.reset(-500, -500);
    if (this.pool.length < POOL_MAX) {
      this.pool.push(sprite);
    } else {
      sprite.destroy();
    }
  }

  destroy(): void {
    for (const { sprite } of this.active) sprite.destroy();
    this.active.length = 0;
    for (const s of this.pool) s.destroy();
    this.pool.length = 0;
  }

  // ── Scroll & recycle ──────────────────────────────────────────────────────

  private scrollActive(delta: number): void {
    const dx = this.speed * (delta / 1000);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      entry.sprite.x -= dx;
      entry.sprite.refreshBody();

      if (entry.sprite.x < -80) {
        const missed = !entry.collected;
        this.active.splice(i, 1);
        this.recycle(entry.sprite);
        if (missed) this.onMiss();
      }
    }
  }

  // ── Public arc spawn (called by ObstacleManager when a ball is placed) ───

  spawnArc(centerX: number, groundY: number): void {
    const count     = 5;
    const coinSize  = COIN_DISPLAY;
    const gap       = 12;
    const spacing   = coinSize + gap;
    const arcWidth  = spacing * (count - 1);
    const arcHeight = 130;
    const startX    = centerX - arcWidth / 2;

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = startX + i * spacing;
      const y = groundY - arcHeight * Math.sin(t * Math.PI) - coinSize / 2;
      this.spawnCoinAt(x, y);
    }
  }

  private spawnCoinAt(x: number, y: number): void {
    const sprite = this.acquire();
    sprite.setPosition(x, y).setDisplaySize(COIN_DISPLAY, COIN_DISPLAY);

    const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(COIN_DISPLAY * 0.75, COIN_DISPLAY * 0.75);
    body.reset(x, y);
    body.enable = true;

    sprite.play("coin-spin", true);
  }

  // ── Pool ──────────────────────────────────────────────────────────────────

  private acquire(): Phaser.Physics.Arcade.Sprite {
    if (this.pool.length > 0) {
      const sprite = this.pool.pop()!;
      sprite.setActive(true).setVisible(true);
      (sprite.body as Phaser.Physics.Arcade.StaticBody).enable = true;
      this.active.push({ sprite, collected: false });
      return sprite;
    }
    const sprite = this.group.create(
      -200, -200, "coin", 0,
    ) as Phaser.Physics.Arcade.Sprite;
    this.active.push({ sprite, collected: false });
    return sprite;
  }

  private recycle(sprite: Phaser.Physics.Arcade.Sprite): void {
    this.recycleCoin(sprite);
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  private ensureAnimation(): void {
    if (this.scene.anims.exists("coin-spin")) return;
    // coin spritesheet: 5 cols × 2 rows, 8 frames (5 face-on→edge + 3 edge→face)
    this.scene.anims.create({
      key:       "coin-spin",
      frames:    this.scene.anims.generateFrameNumbers("coin", { start: 0, end: 7 }),
      frameRate: 12,
      repeat:    -1,
    });
  }
}

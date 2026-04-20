import Phaser from "phaser";
import { CoinManager } from "./CoinManager";

// ── Types & config ────────────────────────────────────────────────────────────

type ObstacleVariant = "low" | "mid";

interface VariantConfig {
  texture: string;
  w: number;
  h: number;
  yOffset: number;
  frameCount: number;
  animRate: number;
}

// "low" ≈ soccer ball on ground — player must jump over it
// "mid" ≈ running opponent     — player must jump over it
// Balls: static (frame 0 only); enemy: 8-frame running animation, dynamic body
const VARIANTS: Record<ObstacleVariant, VariantConfig> = {
  low: { texture: "ball",  w:  80, h:  80, yOffset: 0, frameCount: 1, animRate:  1 },
  mid: { texture: "enemy", w: 148, h: 200, yOffset: 0, frameCount: 8, animRate: 10 },
};

// Weighted selection: low 60 %, mid 40 %
const WEIGHTS: ReadonlyArray<[ObstacleVariant, number]> = [
  ["low", 60],
  ["mid", 40],
];
const TOTAL_WEIGHT = WEIGHTS.reduce((s, [, w]) => s + w, 0);

const POOL_MAX = 10;
const MIN_GAP = 400;
const MIN_GAP_LO = 250;
const COMBO_GAP = 220;
const COMBO_PROB = 0.25;

// ── Internal record ───────────────────────────────────────────────────────────

interface ActiveBall {
  sprite: Phaser.Physics.Arcade.Sprite;
  texture: string;
}

// ── ObstacleManager ───────────────────────────────────────────────────────────

export class ObstacleManager {
  private readonly scene: Phaser.Scene;
  private readonly group: Phaser.Physics.Arcade.Group; // balls only
  /** Dynamic group — wire to physics.add.overlap in GameScene for enemy hits */
  public readonly enemyGroup: Phaser.Physics.Arcade.Group;
  private readonly groundY: number;

  private coinManager: CoinManager | null = null;

  private speed = 300;
  private frozen = false;
  private spawningEnabled = true;

  private spawnTimer = 0;
  private nextDelay = 0;
  private comboQueued = false;

  // Ball state (static physics)
  private readonly activeBalls: ActiveBall[] = [];
  private readonly ballPools: Map<string, Phaser.Physics.Arcade.Sprite[]>;

  // Enemy state (dynamic physics)
  private readonly activeEnemies: Phaser.Physics.Arcade.Sprite[] = [];
  private readonly enemyPool: Phaser.Physics.Arcade.Sprite[] = [];

  constructor(scene: Phaser.Scene, groundY: number) {
    this.scene = scene;
    this.groundY = groundY;
    this.group = scene.physics.add.group();
    this.enemyGroup = scene.physics.add.group();

    // Pool map covers only ball textures
    const ballTextures = [
      ...new Set(
        Object.values(VARIANTS)
          .filter((v) => v.texture !== "enemy")
          .map((v) => v.texture),
      ),
    ];
    this.ballPools = new Map(ballTextures.map((k) => [k, []]));

    this.createAnimations();
    this.scheduleNormal();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setSpeed(n: number): void { this.speed = n; }

  setCoinManager(cm: CoinManager): void { this.coinManager = cm; }

  /** Dynamic Group containing all ball obstacles — pass to physics.add.overlap */
  getGroup(): Phaser.Physics.Arcade.Group {
    return this.group;
  }

  /** Force-spawn one obstacle immediately */
  spawn(): void {
    this.spawnOne(this.selectVariant());
  }

  update(delta: number): void {
    if (this.frozen) return;

    this.scrollBalls(delta);
    this.scrollEnemies(delta);

    if (!this.spawningEnabled) return;

    this.spawnTimer += delta;
    if (this.spawnTimer >= this.nextDelay) {
      this.spawnTimer = 0;
      this.tick();
    }
  }

  freeze(): void {
    this.frozen = true;
  }

  stopSpawning(): void {
    this.spawningEnabled = false;
  }

  clearActive(): void {
    for (let i = this.activeBalls.length - 1; i >= 0; i--) {
      const entry = this.activeBalls[i];
      this.recycleBall(entry.sprite, entry.texture);
    }
    this.activeBalls.length = 0;

    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      this.recycleEnemy(this.activeEnemies[i]);
    }
    this.activeEnemies.length = 0;
  }

  destroy(): void {
    for (const { sprite } of this.activeBalls) sprite.destroy();
    this.activeBalls.length = 0;
    for (const sprites of this.ballPools.values()) {
      for (const s of sprites) s.destroy();
      sprites.length = 0;
    }
    for (const sprite of this.activeEnemies) sprite.destroy();
    this.activeEnemies.length = 0;
    for (const sprite of this.enemyPool) sprite.destroy();
    this.enemyPool.length = 0;
  }

  // ── Scroll ────────────────────────────────────────────────────────────────

  private scrollBalls(delta: number): void {
    const dx = this.speed * (delta / 1000);
    for (let i = this.activeBalls.length - 1; i >= 0; i--) {
      const entry = this.activeBalls[i];
      const newX = entry.sprite.x - dx;
      entry.sprite.setX(newX);
      (entry.sprite.body as Phaser.Physics.Arcade.Body).reset(newX, entry.sprite.y);
      if (newX < -150) {
        this.activeBalls.splice(i, 1);
        this.recycleBall(entry.sprite, entry.texture);
      }
    }
  }

  private scrollEnemies(delta: number): void {
    const dx = this.speed * 1.7 * (delta / 1000);
    for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
      const sprite = this.activeEnemies[i];

      const newX = sprite.x - dx;
      sprite.setX(newX);

      if (newX < -150) {
        this.activeEnemies.splice(i, 1);
        this.recycleEnemy(sprite);
      }
    }
  }

  // ── Spawn scheduling ──────────────────────────────────────────────────────

  private tick(): void {
    this.spawnOne(this.selectVariant());

    if (this.comboQueued) {
      this.comboQueued = false;
      this.scheduleNormal();
      return;
    }

    if (Math.random() < COMBO_PROB) {
      this.comboQueued = true;
      this.nextDelay = (COMBO_GAP / this.speed) * 1000;
    } else {
      this.scheduleNormal();
    }
  }

  private scheduleNormal(): void {
    const gap = Math.max(MIN_GAP - (this.speed - 300) * 0.5, MIN_GAP_LO);
    this.nextDelay = (gap / this.speed) * 1000;
  }

  // ── Spawn one obstacle ────────────────────────────────────────────────────

  private spawnOne(variant: ObstacleVariant): void {
    const cfg = VARIANTS[variant];
    const spawnX = this.scene.scale.width + 100;
    const spawnY = this.groundY + cfg.yOffset - cfg.h / 2;

    if (cfg.texture === "enemy") {
      this.spawnEnemy(cfg, spawnX, spawnY);
    } else {
      this.spawnBall(cfg, spawnX, spawnY);
    }
  }

  private spawnBall(cfg: VariantConfig, spawnX: number, spawnY: number): void {
    const sprite = this.acquireBall(cfg.texture);
    sprite.setPosition(spawnX, spawnY).setDisplaySize(cfg.w, cfg.h);

    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.allowGravity = false;
    body.setSize(cfg.w * 0.8, cfg.h * 0.8);
    body.reset(spawnX, spawnY);
    body.enable = true;

    sprite.setFrame(0);

    this.coinManager?.spawnArc(spawnX, this.groundY);
  }

  private spawnEnemy(cfg: VariantConfig, spawnX: number, spawnY: number): void {
    const sprite = this.acquireEnemy();
    sprite
      .setPosition(spawnX, spawnY)
      .setDisplaySize(cfg.w, cfg.h)
      .setActive(true)
      .setVisible(true);

    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.allowGravity = false;
    body.setSize(Math.round(cfg.w * 0.5), Math.round(cfg.h * 0.7));
    body.reset(spawnX, spawnY);
    body.enable = true;

    sprite.play("enemy-run", true);
    this.activeEnemies.push(sprite);
  }

  // ── Ball pool ─────────────────────────────────────────────────────────────

  private acquireBall(texture: string): Phaser.Physics.Arcade.Sprite {
    const pool = this.ballPools.get(texture)!;
    if (pool.length > 0) {
      const sprite = pool.pop()!;
      sprite.setActive(true).setVisible(true);
      (sprite.body as Phaser.Physics.Arcade.Body).enable = true;
      this.activeBalls.push({ sprite, texture });
      return sprite;
    }
    const sprite = this.scene.physics.add.sprite(-200, -200, texture, 0);
    sprite.setActive(true).setVisible(true);
    (sprite.body as Phaser.Physics.Arcade.Body).allowGravity = false;
    this.group.add(sprite);
    this.activeBalls.push({ sprite, texture });
    return sprite;
  }

  private recycleBall(
    sprite: Phaser.Physics.Arcade.Sprite,
    texture: string,
  ): void {
    sprite.setActive(false).setVisible(false);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.reset(-500, -500);

    const pool = this.ballPools.get(texture)!;
    if (pool.length < POOL_MAX) {
      pool.push(sprite);
    } else {
      sprite.destroy();
    }
  }

  // ── Enemy pool ────────────────────────────────────────────────────────────

  private acquireEnemy(): Phaser.Physics.Arcade.Sprite {
    if (this.enemyPool.length > 0) {
      const sprite = this.enemyPool.pop()!;
      sprite.setFlipX(false);
      (sprite.body as Phaser.Physics.Arcade.Body).enable = true;
      return sprite;
    }
    const sprite = this.scene.physics.add.sprite(-200, -200, "enemy", 0);
    sprite.setFlipX(false);
    this.enemyGroup.add(sprite);
    return sprite;
  }

  private recycleEnemy(sprite: Phaser.Physics.Arcade.Sprite): void {
    sprite.setActive(false).setVisible(false);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.reset(-500, -500);

    if (this.enemyPool.length < POOL_MAX) {
      this.enemyPool.push(sprite);
    } else {
      this.enemyGroup.remove(sprite, true, true);
    }
  }

  // ── Weighted random selection ─────────────────────────────────────────────

  private selectVariant(): ObstacleVariant {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const [variant, weight] of WEIGHTS) {
      r -= weight;
      if (r <= 0) return variant;
    }
    return WEIGHTS[0][0];
  }

  // ── Animations ────────────────────────────────────────────────────────────

  private createAnimations(): void {
    const anims = this.scene.anims;

    if (!anims.exists("enemy-run")) {
      anims.create({
        key: "enemy-run",
        frames: anims.generateFrameNumbers("enemy", { start: 0, end: 7 }),
        frameRate: 10,
        repeat: -1,
      });
    }
  }
}

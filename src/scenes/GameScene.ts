import Phaser from "phaser";
import { Player } from "../Player";
import { ObstacleManager } from "../ObstacleManager";
import { CoinManager } from "../CoinManager";
import { FinishLine } from "../FinishLine";

// ── Constants ─────────────────────────────────────────────────────────────────
const SPEED_INITIAL  = 300;
const SPEED_MAX      = 600;
const SPEED_STEP     =   5;
const SPEED_TICK_MS  = 3000;
const PX_PER_METER   =  100;
const LS_BEST_DIST   = "runner_best_distance";
const LS_BEST_COINS  = "runner_best_coins";

// Ground surface is at this fraction of screen height (must match Player.ts)
const GROUND_FRAC    = 0.82;

// Phaser passes this union to overlap/collider callbacks
type ArcadeObj =
  | Phaser.Physics.Arcade.Body
  | Phaser.Physics.Arcade.StaticBody
  | Phaser.Types.Physics.Arcade.GameObjectWithBody
  | Phaser.Tilemaps.Tile;

// ── Payload types (exported for UIScene) ──────────────────────────────────────
export type GameState = "waiting" | "playing" | "dead" | "finished";

export interface ScorePayload {
  distance:   number;
  speed:      number;
  coins:      number;
  combo:      number;
  multiplier: number;
}

export interface CoinPayload {
  total:      number;
  combo:      number;
  multiplier: number;
  earned:     number;
}

export interface ResultPayload {
  distance:     number;
  coins:        number;
  bestDistance: number;
  bestCoins:    number;
  isNewBest:    boolean;
}

// ── Scene ─────────────────────────────────────────────────────────────────────
export class GameScene extends Phaser.Scene {
  // Public — read by UIScene / entities
  gameState: GameState = "waiting";
  gameSpeed            = SPEED_INITIAL;
  distanceTraveled     = 0;

  // Background: two images side-by-side for seamless infinite scroll
  private bg1!: Phaser.GameObjects.Image;
  private bg2!: Phaser.GameObjects.Image;

  // Physics & entities
  groundGroup!:           Phaser.Physics.Arcade.StaticGroup;
  private groundBodySprite!: Phaser.Physics.Arcade.Sprite;
  player!:                Player;
  private obstacles!:     ObstacleManager;
  private coins!:         CoinManager;
  private finishLine:     FinishLine | null = null;
  private finishSpawned = false;

  // Scoring
  private coinScore      = 0;
  private coinCombo      = 0;
  private comboMultiplier = 1;
  private bestDistance   = 0;
  private bestCoins      = 0;

  private speedTimer!: Phaser.Time.TimerEvent;

  constructor() { super({ key: "GameScene" }); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create(): void {
    this.gameState        = "waiting";
    this.gameSpeed        = SPEED_INITIAL;
    this.distanceTraveled = 0;
    this.coinScore        = 0;
    this.coinCombo        = 0;
    this.comboMultiplier  = 1;
    this.finishLine       = null;
    this.finishSpawned    = false;

    this.bestDistance = parseInt(localStorage.getItem(LS_BEST_DIST)  ?? "0", 10);
    this.bestCoins    = parseInt(localStorage.getItem(LS_BEST_COINS) ?? "0", 10);

    this.buildWorld();

    this.player    = new Player(this, this.groundGroup, this.groundY);
    this.obstacles = new ObstacleManager(this, this.groundY);
    this.coins     = new CoinManager(this, this.groundY, () => this.onCoinMissed());
    this.obstacles.setCoinManager(this.coins);

    this.physics.add.overlap(
      this.player,
      this.obstacles.getGroup(),
      this.onObstacleOverlap,
      undefined,
      this,
    );

    this.physics.add.overlap(
      this.player,
      this.obstacles.enemyGroup,
      this.onObstacleOverlap,
      undefined,
      this,
    );

    this.physics.add.overlap(
      this.player,
      this.coins.getGroup(),
      this.onCoinOverlap,
      undefined,
      this,
    );

    this.setupSpeedTimer();
    this.setupInput();
    this.scene.launch("UIScene");

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.obstacles.destroy();
      this.coins.destroy();
      this.finishLine?.destroy();
    });
  }

  update(_time: number, delta: number): void {
    if (this.player && this.player.y > this.groundY + 50) {
      this.player.setY(this.groundY - 10);
      (this.player.body as Phaser.Physics.Arcade.Body).setVelocityY(0);
    }

    this.player.tick();

    // Finish line physics runs even after game ends (break animation)
    if (this.finishLine) this.finishLine.update(delta, this.gameSpeed);

    if (this.gameState !== "playing") return;

    const dt = delta / 1000;
    const dx = this.gameSpeed * dt;
    const W  = this.scale.width;

    // Dual-image infinite background scroll
    this.bg1.x -= dx;
    this.bg2.x -= dx;
    const dW1 = (this.bg1.getData("displayW") as number) ?? W;
    const dW2 = (this.bg2.getData("displayW") as number) ?? W;
    if (this.bg1.x + dW1 <= 0) this.bg1.setX(this.bg2.x + dW2);
    if (this.bg2.x + dW2 <= 0) this.bg2.setX(this.bg1.x + dW1);

    this.obstacles.setSpeed(this.gameSpeed);
    this.obstacles.update(delta);

    this.coins.setSpeed(this.gameSpeed);
    this.coins.update(delta);

    this.distanceTraveled += dx / PX_PER_METER;

    // Spawn finish line once threshold is crossed
    if (!this.finishSpawned && this.distanceTraveled >= 45) {
      this.finishSpawned = true;

      // Stop NEW spawns but keep existing obstacles/coins moving
      this.obstacles.stopSpawning();
      this.coins.stopSpawning();

      this.finishLine = new FinishLine(this, () => this.triggerFinish());
    }

    this.events.emit("score-update", {
      distance:   Math.floor(this.distanceTraveled),
      speed:      Math.floor(this.gameSpeed),
      coins:      this.coinScore,
      combo:      this.coinCombo,
      multiplier: this.comboMultiplier,
    } satisfies ScorePayload);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  triggerGameOver(): void {
    if (this.gameState === "dead" || this.gameState === "finished") return;
    this.gameState = "dead";
    this.speedTimer.paused = true;
    this.obstacles.freeze();
    this.coins.freeze();
    this.player.die();

    this.cameras.main.shake(300, 0.012);

    const payload = this.buildResultPayload();
    this.events.emit("game-over", payload);

    this.time.delayedCall(1500, () => {
      this.events.emit("show-restart", payload);
    });
  }

  triggerFinish(): void {
    if (this.gameState === "finished") return;
    this.gameState = "finished";
    this.speedTimer.paused = true;
    this.obstacles.freeze();
    this.coins.freeze();
    this.player.finish();

    const payload = this.buildResultPayload();
    this.events.emit("game-finished", payload);

    this.time.delayedCall(500, () => {
      this.events.emit("show-restart", payload);
    });
  }

  // Ground surface Y — top of the invisible physics collider
  get groundY(): number {
    return Math.round(this.scale.height * GROUND_FRAC);
  }

  // ── Overlap callbacks ─────────────────────────────────────────────────────

  private onObstacleOverlap(): void {
    if (this.gameState !== "playing") return;

    const isDead = this.player.takeDamage();
    this.events.emit("lives-update", this.player.getLives());

    if (isDead) {
      this.triggerGameOver();
    } else {
      this.cameras.main.shake(150, 0.008);
    }
  }

  private onCoinOverlap(_player: ArcadeObj, coinObj: ArcadeObj): void {
    if (this.gameState !== "playing") return;
    this.coins.collectCoin(coinObj as Phaser.Physics.Arcade.Sprite);
    this.onCoinCollected();
  }

  // ── Coin / combo logic ────────────────────────────────────────────────────

  private onCoinCollected(): void {
    this.coinCombo++;
    this.comboMultiplier = this.coinCombo >= 3 ? 2 : 1;

    const earned    = 10 * this.comboMultiplier;
    this.coinScore += earned;

    this.playCoinSound();

    this.events.emit("coin-collected", {
      total:      this.coinScore,
      combo:      this.coinCombo,
      multiplier: this.comboMultiplier,
      earned,
    } satisfies CoinPayload);
  }

  private onCoinMissed(): void {
    if (this.coinCombo === 0) return;
    this.coinCombo       = 0;
    this.comboMultiplier = 1;
    this.events.emit("combo-reset");
  }

  // ── Best score ────────────────────────────────────────────────────────────

  private buildResultPayload(): ResultPayload {
    const distance  = Math.floor(this.distanceTraveled);
    const coins     = this.coinScore;
    let   isNewBest = false;

    if (distance > this.bestDistance) {
      this.bestDistance = distance;
      localStorage.setItem(LS_BEST_DIST, String(distance));
      isNewBest = true;
    }
    if (coins > this.bestCoins) {
      this.bestCoins = coins;
      localStorage.setItem(LS_BEST_COINS, String(coins));
      isNewBest = true;
    }

    return { distance, coins, bestDistance: this.bestDistance, bestCoins: this.bestCoins, isNewBest };
  }

  // ── Procedural coin sound ────────────────────────────────────────────────

  private playCoinSound(): void {
    if (!(this.sound instanceof Phaser.Sound.WebAudioSoundManager)) return;
    const ctx = this.sound.context;
    const now = ctx.currentTime;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(1046.5, now);
    osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.06);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private setupInput(): void {
    this.input.once("pointerdown", this.onFirstTap, this);

    const spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    spaceKey.on("down", () => {
      if (this.gameState === "waiting") {
        this.onFirstTap();
      } else {
        this.player.tryJump();
      }
    });
  }

  private onFirstTap(): void {
    if (this.gameState !== "waiting") return;
    this.gameState         = "playing";
    this.speedTimer.paused = false;
    this.player.startRunning();
    this.events.emit("game-started");
  }

  // ── Speed ramp ────────────────────────────────────────────────────────────

  private setupSpeedTimer(): void {
    this.speedTimer = this.time.addEvent({
      delay:    SPEED_TICK_MS,
      loop:     true,
      paused:   true,
      callback: () => {
        this.gameSpeed = Math.min(this.gameSpeed + SPEED_STEP, SPEED_MAX);
      },
    });
  }

  // ── World construction ────────────────────────────────────────────────────

  private buildWorld(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // ── Background: two images side-by-side, scrolled and wrapped ────────
    this.bg1 = this.add.image(0, 0, "background")
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.bg2 = this.add.image(0, 0, "background")
      .setOrigin(0, 0)
      .setScrollFactor(0);
    this.scaleBg(this.bg1, W, H);
    this.scaleBg(this.bg2, W, H);
    this.bg2.setX((this.bg1.getData("displayW") as number) ?? W);

    // ── Invisible physics ground ──────────────────────────────────────────
    // groundY (H * GROUND_FRAC) aligns with the visible pitch in background.jpg.
    // The body is 20 px tall so the player rests with feet right at groundY.
    // Adjust GROUND_FRAC (0.82) if the player appears to float or sink.
    const groundY = this.groundY;
    this.groundGroup       = this.physics.add.staticGroup();
    this.groundBodySprite  = this.groundGroup.create(
      W / 2, groundY, "__DEFAULT",
    ) as Phaser.Physics.Arcade.Sprite;
    this.groundBodySprite
      .setDisplaySize(W, 20)
      .refreshBody()
      .setVisible(false);

    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
    });
    this.scale.on("resize", this.onResize, this);
  }

  private scaleBg(img: Phaser.GameObjects.Image, W: number, H: number): void {
    const imgW   = 1380;
    const imgH   = 676;
    const scale  = Math.max(W / imgW, H / imgH); // cover
    img.setScale(scale);
    img.setY((H - imgH * scale) / 2);
    img.setData("displayW", imgW * scale);
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    const W = gameSize.width;
    const H = gameSize.height;

    if (!W || !H || W < 100 || H < 100) return;

    this.physics.world.pause();

    // Resize physics world bounds
    this.physics.world.setBounds(0, 0, W, H * 10);

    // Background
    this.scaleBg(this.bg1, W, H);
    this.scaleBg(this.bg2, W, H);
    const dW = (this.bg1.getData("displayW") as number) ?? W;
    this.bg1.setX(0);
    this.bg2.setX(dW);

    // Ground
    const groundY = Math.round(H * GROUND_FRAC);
    this.groundBodySprite.setPosition(W / 2, groundY);
    this.groundBodySprite.setDisplaySize(W, 20);
    this.groundBodySprite.refreshBody();

    // Player
    if (this.player?.active) {
      this.player.rescale();
      this.player.setX(Math.round(W * 0.15));
    }

    // Resume physics after two frames
    this.time.delayedCall(32, () => {
      if (this.groundBodySprite?.active) {
        this.groundBodySprite.refreshBody();
      }
      this.physics.world.resume();
    });
  }
}

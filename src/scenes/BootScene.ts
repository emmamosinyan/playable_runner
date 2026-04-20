import Phaser from "phaser";

// Real asset imports — Vite inlines these as base64 data URLs at build time
import playerUrl      from "../assets/player.png?url";
import ballUrl        from "../assets/balls.png?url";
import coinUrl        from "../assets/coins.png?url";
import enemyUrl       from "../assets/enemy.png?url";
import backgroundUrl  from "../assets/background.jpg?url";
import footerLargeUrl from "../assets/footer_large.webp?url";
import footerUrl      from "../assets/footer.webp?url";

// ── Asset dimensions ─────────────────────────────────────────────────────
// player.png  1408×768  loaded as image; frames registered manually in Player.ts
//                       (rows have per-row left margins — 60/40/40/60 px)
// balls.png   1408×768   5 cols × 2 rows  → frameWidth=281  frameHeight=384  (frame 0 static)
// coins.png   1408×768   5 cols × 2 rows  → frameWidth=281  frameHeight=384  (8 frames spin)
// enemy.png   1400×752   4 cols × 2 rows  → frameWidth=350  frameHeight=376  (8 frames run)

export class BootScene extends Phaser.Scene {
  private barBg!:     Phaser.GameObjects.Graphics;
  private barFill!:   Phaser.GameObjects.Graphics;
  private barBounds!: Phaser.Geom.Rectangle;

  constructor() { super({ key: "BootScene" }); }

  preload(): void {
    this.createLoadingUI();
    this.load.on("progress", (value: number) => this.setBarFill(value));

    // ── Player: loaded as plain image; frames are registered manually in
    //    Player.ts using exact pixel coordinates per row (variable margins)
    this.load.image("player", playerUrl);

    // ── Other spritesheets ────────────────────────────────────────────────
    // ball: static obstacle — full spritesheet loaded so frame 0 is accessible
    this.load.spritesheet("ball", ballUrl, {
      frameWidth: 281, frameHeight: 384,
    });
    this.load.spritesheet("coin", coinUrl, {
      frameWidth: 281, frameHeight: 384,
    });
    this.load.spritesheet("enemy", enemyUrl, {
      frameWidth: 350, frameHeight: 376,
    });

    // ── Static images ─────────────────────────────────────────────────────
    this.load.image("background",   backgroundUrl);
    this.load.image("footer_large", footerLargeUrl);
    this.load.image("footer",       footerUrl);
  }

  create(): void {
    const state = { fill: 0 };
    this.tweens.add({
      targets:  state,
      fill:     1,
      duration: 400,
      ease:     "Sine.easeInOut",
      onUpdate: () => this.setBarFill(state.fill),
      onComplete: () => {
        this.time.delayedCall(200, () => {
          this.barBg.destroy();
          this.barFill.destroy();
          this.scene.start("GameScene");
        });
      },
    });
  }

  // ── Loading bar ──────────────────────────────────────────────────────────

  private createLoadingUI(): void {
    const { centerX, centerY } = this.cameras.main;
    const barW = 320, barH = 28;
    const x = centerX - barW / 2;
    const y = centerY - barH / 2;

    this.barBounds = new Phaser.Geom.Rectangle(x, y, barW, barH);

    this.barBg = this.add.graphics();
    this.barBg.fillStyle(0x000000, 0.6);
    this.barBg.fillRoundedRect(x - 2, y - 2, barW + 4, barH + 4, 6);
    this.barBg.lineStyle(2, 0xffffff, 0.4);
    this.barBg.strokeRoundedRect(x - 2, y - 2, barW + 4, barH + 4, 6);

    this.barFill = this.add.graphics();

    this.add.text(centerX, y - 28, "Loading…", {
      fontFamily: "monospace", fontSize: "16px", color: "#ffffff",
    }).setOrigin(0.5, 1);
  }

  private setBarFill(value: number): void {
    const { x, y, width, height } = this.barBounds;
    const v = Phaser.Math.Clamp(value, 0, 1);
    this.barFill.clear();
    if (v <= 0) return;
    this.barFill.fillStyle(0x44aaff, 1);
    this.barFill.fillRoundedRect(x, y, width * v, height, 4);
    this.barFill.fillStyle(0xaaddff, 0.5);
    this.barFill.fillRoundedRect(x, y, width * v, height * 0.45, 4);
  }
}

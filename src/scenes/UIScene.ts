import Phaser from "phaser";
import type {
  GameScene,
  ScorePayload,
  CoinPayload,
  ResultPayload,
} from "./GameScene";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  white: "#ffffff",
  gold: "#ffcc00",
  orange: "#ff9900",
  cyan: "#00ffee",
  red: "#ff3344",
  green: "#44dd88",
  dim: "#aaaaaa",
  dark: "#111111",
  overlay: 0x000000,
} as const;

const FONT = "'Arial Black', sans-serif";
const FONT_ALT = "'Arial Black', sans-serif";

function txt(
  extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: "24px",
    color: C.white,
    stroke: C.dark,
    strokeThickness: 4,
    ...extra,
  };
}

// ── Confetti palette ──────────────────────────────────────────────────────────
const CONFETTI_COLORS = [
  0xff4455, 0xffcc00, 0x44dd88, 0x00ffee, 0xff9900, 0xcc44ff, 0x4488ff,
];

// ── UIScene ───────────────────────────────────────────────────────────────────
export class UIScene extends Phaser.Scene {
  // HUD
  private hudGroup!: Phaser.GameObjects.Container;
  private coinIcon!: Phaser.GameObjects.Image;
  private coinText!: Phaser.GameObjects.Text;
  private txtCombo!: Phaser.GameObjects.Text;
  private heartGraphics!: Phaser.GameObjects.Graphics;
  private currentLives = 3;
  private comboVisible = false;

  // Start screen
  private startGroup!: Phaser.GameObjects.Container;
  private startOverlay!: Phaser.GameObjects.Rectangle;
  private startTitle!: Phaser.GameObjects.Text;
  private startGlow!: Phaser.GameObjects.Text;
  private startTapLabel!: Phaser.GameObjects.Text;
  private startArrow!: Phaser.GameObjects.Text;
  private startHint!: Phaser.GameObjects.Text;

  // Game-over (dynamic objects, created on each game-over)
  private gameOverObjects: Phaser.GameObjects.GameObject[] = [];
  private gameOverGfx: Phaser.GameObjects.Graphics | null = null;
  private gameOverTexts: Phaser.GameObjects.Text[] = [];
  private gameOverBtn: Phaser.GameObjects.Container | null = null;

  // Win screen (dynamic objects, created on each win)
  private winObjects: Phaser.GameObjects.GameObject[] = [];
  private winGfx: Phaser.GameObjects.Graphics | null = null;
  private winTexts: Phaser.GameObjects.Text[] = [];
  private winBtn: Phaser.GameObjects.Container | null = null;
  private confettiEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  // Footer
  private footerImage!: Phaser.GameObjects.Image;
  private footerVisible = false;
  private downloadButton!: Phaser.GameObjects.Container;

  // routing
  private isWin = false;

  constructor() {
    super({ key: "UIScene" });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create(): void {
    this.input.setTopOnly(false);

    const W = this.scale.width;
    const H = this.scale.height;

    this.isWin = false;
    this.comboVisible = false;

    this.ensureConfettiTexture();

    this.buildHUD(W);
    this.buildStartScreen(W, H);

    this.subscribeToGameScene();

    this.createFooter();

    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      const W = gameSize.width;
      const H = gameSize.height;

      if (!W || !H || W < 50 || H < 50) return;

      // Force camera to cover new screen size
      this.cameras.main.setViewport(0, 0, W, H);
      this.cameras.main.setSize(W, H);

      // Hearts — redraw at same position
      if (this.heartGraphics) {
        this.heartGraphics.setPosition(0, 0);
        this.drawHearts(this.currentLives);
      }

      // Coin icon + text
      const coinSize = Math.round(H * 0.07);
      const iconX = W - 16 - coinSize / 2;
      const iconY = coinSize / 2 + 8;
      this.coinIcon
        ?.setDisplaySize(coinSize, coinSize)
        .setPosition(iconX, iconY);
      this.coinText
        ?.setPosition(iconX - coinSize / 2 - 8, iconY)
        .setFontSize(`${Math.round(coinSize * 0.55)}px`);

      // Footer — crossfade to swapped texture on orientation change
      if (this.footerImage) {
        const isLandscape = W > H;
        const key = isLandscape ? "footer_large" : "footer";
        const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
        const displayH = (tex.height / tex.width) * W;

        this.tweens.killTweensOf(this.footerImage);
        this.tweens.add({
          targets: this.footerImage,
          alpha: 0,
          duration: 120,
          ease: "Linear",
          onComplete: () => {
            this.footerImage
              .setTexture(key)
              .setPosition(0, H)
              .setDisplaySize(W, displayH);
            this.tweens.add({
              targets: this.footerImage,
              alpha: 1,
              duration: 180,
              ease: "Linear",
            });
            this.repositionDownloadButton();
          },
        });
      } else {
        this.repositionDownloadButton();
      }

      // Reposition start screen elements if visible
      if (this.startGroup?.visible) {
        const cx = W / 2;
        const cy = H / 2;
        this.startOverlay?.setSize(W, H);
        const titleSize = Math.min(Math.round(W * 0.1), 52);
        const tapSize = Math.min(Math.round(W * 0.07), 32);
        this.startTitle?.setFontSize(`${titleSize}px`);
        this.startTapLabel?.setFontSize(`${tapSize}px`);
        this.startTitle?.setPosition(cx, cy - H * 0.18);
        this.startGlow?.setPosition(cx, cy - H * 0.02);
        this.startTapLabel?.setPosition(cx, cy + H * 0.12);
        this.startArrow?.setPosition(cx, cy + H * 0.23);
        this.startHint?.setPosition(cx, cy + H * 0.35);
      }
      if (this.gameOverGfx?.active) {
        this.drawFullOverlay(this.gameOverGfx, 0x000000, 0.55);
        const cx = W / 2;
        const cy = H / 2;
        this.gameOverTexts[0]?.setPosition(cx, cy - 100);
        this.gameOverTexts[1]?.setPosition(cx, cy - 40);
        this.gameOverTexts[2]?.setPosition(cx, cy + 10);
        this.gameOverBtn?.setPosition(cx, cy + 80);
      }
      if (this.winGfx?.active) {
        this.drawFullOverlay(this.winGfx, 0x000000, 0.6);
        const cx = W / 2;
        const cy = H / 2;
        this.winTexts[0]?.setPosition(cx, cy - 80);
        this.winTexts[1]?.setPosition(cx, cy - 10);
        this.winBtn?.setPosition(cx, cy + 70);
      }
    });
  }

  private createFooter(): void {
    const isLandscape = this.scale.width > this.scale.height;
    const key = isLandscape ? "footer_large" : "footer";

    const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const naturalW = tex.width;
    const naturalH = tex.height;

    const displayW = this.scale.width;
    const displayH = (naturalH / naturalW) * displayW;

    this.footerImage = this.add
      .image(0, this.scale.height, key)
      .setOrigin(0, 1)
      .setDisplaySize(displayW, displayH)
      .setDepth(100)
      .setScrollFactor(0);

    this.footerImage.removeInteractive();

    this.footerVisible = true;

    this.createDownloadButton();
  }

  private createDownloadButton(): void {
    const btnW = 200;
    const btnH = 70;

    const bg = this.add.graphics();
    bg.fillStyle(0xff6b00, 1);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
    bg.fillStyle(0xff8c00, 0.4);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH / 2, 10);

    const label = this.add
      .text(0, 0, "⬇ Download", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffffff",
        fontStyle: "bold",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0.5);

    this.downloadButton = this.add
      .container(0, 0, [bg, label])
      .setDepth(200)
      .setSize(btnW, btnH)
      .setInteractive(
        new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH),
        Phaser.Geom.Rectangle.Contains,
        true,
      );

    this.downloadButton.on("pointerdown", () => {
      this.tweens.add({
        targets: this.downloadButton,
        scaleX: 0.93,
        scaleY: 0.93,
        duration: 80,
        yoyo: true,
        onComplete: () => {
          window.open("https://example.com", "_blank");
        },
      });
    });

    this.downloadButton.on("pointerover", () =>
      this.downloadButton.setScale(1.05),
    );
    this.downloadButton.on("pointerout", () => this.downloadButton.setScale(1));

    this.repositionDownloadButton();
  }

  private repositionDownloadButton(): void {
    if (!this.footerImage || !this.downloadButton) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const isPortrait = H > W;

    const footerBottom = this.footerImage.y;
    const footerTop = footerBottom - this.footerImage.displayHeight;
    const footerMidY = footerTop + this.footerImage.displayHeight / 2;

    if (isPortrait) {
      this.downloadButton.setScale(0.65);
      this.downloadButton.setPosition(W - 80, footerMidY);
    } else {
      this.downloadButton.setScale(1);
      this.downloadButton.setPosition(W - 150, footerMidY + 20);
    }
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  private subscribeToGameScene(): void {
    const gs = this.scene.get("GameScene") as GameScene;

    const handlers: [string, (...args: unknown[]) => void][] = [
      ["game-started", this.onGameStarted.bind(this)],
      ["score-update", (p) => this.onScoreUpdate(p as ScorePayload)],
      [
        "coin-collected",
        (p) => {
          const payload = p as CoinPayload;
          this.onCoinCollected(payload);
          this.flyCoinToHUD(payload.worldX, payload.worldY);
        },
      ],
      ["combo-reset", this.onComboReset.bind(this)],
      [
        "lives-update",
        (n) => {
          this.currentLives = n as number;
          this.drawHearts(n as number);
        },
      ],
      [
        "game-over",
        (p) => {
          this.isWin = false;
          this.onResult(p as ResultPayload);
        },
      ],
      [
        "game-finished",
        (p) => {
          this.isWin = true;
          this.onResult(p as ResultPayload);
        },
      ],
      ["show-restart", (p) => this.onShowRestart(p as ResultPayload)],
    ];

    for (const [event, handler] of handlers) gs.events.on(event, handler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const [event, handler] of handlers) gs.events.off(event, handler);
    });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  private buildHUD(W: number): void {
    const coinSize = Math.round(this.scale.height * 0.07);

    const iconX = W - 16 - coinSize / 2;
    const iconY = coinSize / 2 + 8;

    this.coinIcon = this.add
      .image(iconX, iconY, "coin", 0)
      .setFrame(0)
      .setDepth(50)
      .setScrollFactor(0)
      .setAlpha(0);

    // Get original width
    const baseWidth = this.coinIcon.width;

    // Scale uniformly (keeps 1:1 ratio)
    const scale = coinSize / baseWidth;

    this.coinIcon.setScale(scale);

    this.coinText = this.add
      .text(iconX - coinSize / 2 - 8, iconY, "× 0", {
        fontFamily: "monospace",
        fontSize: `${Math.round(coinSize * 0.55)}px`,
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(1, 0.5)
      .setDepth(50)
      .setAlpha(0);

    this.txtCombo = this.add
      .text(
        W / 2,
        68,
        "×2 COMBO!",
        txt({
          fontSize: "28px",
          color: C.orange,
          strokeThickness: 5,
        }),
      )
      .setOrigin(0.5, 0)
      .setVisible(false)
      .setAlpha(0);

    this.hudGroup = this.add.container(0, 0, [this.txtCombo]);

    this.createHearts();
  }
  private createHearts(): void {
    this.heartGraphics = this.add.graphics().setDepth(50);
    this.currentLives = 3;
    this.drawHearts(3);
  }

  private drawHearts(lives: number): void {
    this.heartGraphics.clear();
    const size = 18;
    const padding = 8;
    const startX = 20;
    const startY = 20;

    for (let i = 0; i < 3; i++) {
      const x = startX + i * (size + padding);
      const y = startY;
      const filled = i < lives;

      if (filled) {
        this.heartGraphics.fillStyle(0xe63946, 1);
      } else {
        this.heartGraphics.fillStyle(0x444444, 0.6);
      }

      this.heartGraphics.fillCircle(
        x + size * 0.27,
        y + size * 0.3,
        size * 0.27,
      );
      this.heartGraphics.fillCircle(
        x + size * 0.73,
        y + size * 0.3,
        size * 0.27,
      );
      this.heartGraphics.fillTriangle(
        x,
        y + size * 0.45,
        x + size,
        y + size * 0.45,
        x + size * 0.5,
        y + size,
      );
    }
  }

  // ── Start screen ──────────────────────────────────────────────────────────

  private buildStartScreen(W: number, H: number): void {
    const cx = W / 2;
    const cy = H / 2;

    const overlay = this.add
      .rectangle(0, 0, W, H, 0x000a1a, 0.55)
      .setOrigin(0, 0);

    const titleSize = Math.min(Math.round(W * 0.1), 52);
    const title = this.add
      .text(
        cx,
        cy - H * 0.18,
        "PLAYABLE\nRUNNER",
        txt({
          fontSize: `${titleSize}px`,
          color: C.cyan,
          strokeThickness: 8,
          align: "center",
        }),
      )
      .setOrigin(0.5);

    const glow = this.add
      .text(cx, cy - H * 0.02, "infinite runner", {
        fontFamily: FONT_ALT,
        fontSize: "18px",
        color: C.dim,
        letterSpacing: 6,
      })
      .setOrigin(0.5);

    const tapLabel = this.add
      .text(
        cx,
        cy + H * 0.12,
        "TAP TO START",
        txt({
          fontSize: `${Math.min(Math.round(W * 0.07), 32)}px`,
          color: C.gold,
          strokeThickness: 6,
        }),
      )
      .setOrigin(0.5);

    this.tweens.add({
      targets: tapLabel,
      alpha: 0.3,
      duration: 680,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const arrow = this.add
      .text(
        cx,
        cy + H * 0.23,
        "▼",
        txt({
          fontSize: "34px",
          color: C.white,
          strokeThickness: 3,
        }),
      )
      .setOrigin(0.5);

    this.tweens.add({
      targets: arrow,
      y: cy + H * 0.23 + 14,
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const hint = this.add
      .text(cx, cy + H * 0.35, "tap / click  or  SPACE to jump", {
        fontFamily: FONT_ALT,
        fontSize: "17px",
        color: C.dim,
      })
      .setOrigin(0.5);

    this.startOverlay = overlay;
    this.startTitle = title;
    this.startGlow = glow;
    this.startTapLabel = tapLabel;
    this.startArrow = arrow;
    this.startHint = hint;

    this.startGroup = this.add.container(0, 0, [
      overlay,
      title,
      glow,
      tapLabel,
      arrow,
      hint,
    ]);
  }

  // ── Install & Earn button ─────────────────────────────────────────────────

  private makeInstallButton(
    cx: number,
    btnY: number,
  ): Phaser.GameObjects.Container {
    const btnW = 220;
    const btnH = 60;

    const bg = this.add.graphics();
    bg.fillStyle(0xe63946, 1);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 14);
    bg.fillStyle(0xff6b6b, 0.35);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH / 2, 14);

    const label = this.add
      .text(0, 0, "Install & Earn", {
        fontFamily: "Arial Black, sans-serif",
        fontSize: "22px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5);

    const btn = this.add
      .container(cx, btnY, [bg, label])
      .setDepth(200)
      .setSize(btnW, btnH)
      .setInteractive(
        new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH),
        Phaser.Geom.Rectangle.Contains,
        { useHandCursor: true },
      );

    btn.on("pointerover", () => {
      this.tweens.killTweensOf(btn);
      this.tweens.add({
        targets: btn,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 100,
      });
    });
    btn.on("pointerout", () => {
      this.tweens.killTweensOf(btn);
      this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 100 });
    });
    btn.on("pointerdown", () => {
      this.tweens.killTweensOf(btn);
      this.tweens.add({
        targets: btn,
        scaleX: 0.93,
        scaleY: 0.93,
        duration: 80,
        yoyo: true,
        onComplete: () => window.open("https://example.com", "_blank"),
      });
    });

    return btn;
  }

  // ── Button factory ────────────────────────────────────────────────────────

  private makeButton(
    x: number,
    y: number,
    label: string,
    bgColor: number,
    textColor: string,
    onClick: () => void,
    w = 220,
    h = 52,
    fontSize = "22px",
  ): Phaser.GameObjects.Container {
    const bg = this.add.graphics();
    bg.fillStyle(bgColor, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);

    const lbl = this.add
      .text(
        0,
        0,
        label,
        txt({
          fontSize,
          color: textColor,
          strokeThickness: 0,
          stroke: textColor,
        }),
      )
      .setOrigin(0.5);

    const btn = this.add
      .container(x, y, [bg, lbl])
      .setSize(w, h)
      .setInteractive({ useHandCursor: true });

    btn.on("pointerover", () =>
      this.tweens.add({
        targets: btn,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 100,
      }),
    );
    btn.on("pointerout", () =>
      this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 100 }),
    );
    btn.on("pointerdown", () =>
      this.tweens.add({
        targets: btn,
        scaleX: 0.94,
        scaleY: 0.94,
        duration: 70,
      }),
    );
    btn.on("pointerup", () => {
      this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 80 });
      onClick();
    });

    return btn;
  }

  // ── Confetti ──────────────────────────────────────────────────────────────

  private ensureConfettiTexture(): void {
    if (this.textures.exists("confetti")) return;
    const cw = 8,
      ch = 6;
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    CONFETTI_COLORS.forEach((col, i) => {
      gfx.fillStyle(col, 1);
      gfx.fillRect(i * cw, 0, cw, ch);
    });
    gfx.generateTexture("confetti", cw * CONFETTI_COLORS.length, ch);
    gfx.destroy();

    const tex = this.textures.get("confetti");
    CONFETTI_COLORS.forEach((_, i) => {
      tex.add(i, 0, i * cw, 0, cw, ch);
    });
  }

  private burstConfetti(W: number, H: number): void {
    // Clean up previous emitters
    for (const e of this.confettiEmitters) {
      if (e.active) e.destroy();
    }
    this.confettiEmitters = [];

    const fracs = [0.1, 0.22, 0.38, 0.5, 0.62, 0.78, 0.9];
    for (const frac of fracs) {
      const emitter = this.add.particles(W * frac, -20, "confetti", {
        frame: CONFETTI_COLORS.map((_, i) => i),
        lifespan: { min: 1800, max: 3200 },
        speedY: { min: 120, max: 320 },
        speedX: { min: -60, max: 60 },
        rotate: { min: 0, max: 360 },
        scale: { min: 1.2, max: 2.4 },
        alpha: { start: 1, end: 0 },
        gravityY: 180,
        emitting: false,
      });
      emitter.explode(28);
      this.confettiEmitters.push(emitter);
    }

    // Second wave with slight delay for depth
    this.time.delayedCall(320, () => {
      const fracs2 = [0.15, 0.45, 0.7, 0.88];
      for (const frac of fracs2) {
        const e = this.add.particles(W * frac, -10, "confetti", {
          frame: CONFETTI_COLORS.map((_, i) => i),
          lifespan: { min: 2200, max: 3800 },
          speedY: { min: 90, max: 260 },
          speedX: { min: -80, max: 80 },
          rotate: { min: 0, max: 360 },
          scale: { min: 1.0, max: 2.0 },
          alpha: { start: 1, end: 0 },
          gravityY: 160,
          emitting: false,
        });
        e.explode(18);
        this.confettiEmitters.push(e);
      }
    });
  }

  // ── Overlay helper ────────────────────────────────────────────────────────

  private drawFullOverlay(
    gfx: Phaser.GameObjects.Graphics,
    color: number,
    alpha: number,
  ): void {
    const W = this.scale.width;
    const H = this.scale.height;
    gfx.clear();
    gfx.fillStyle(color, alpha);
    gfx.fillRect(0, 0, W, H);
  }

  // ── Show screens ──────────────────────────────────────────────────────────

  private showGameOverScreen(payload: ResultPayload): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    const overlay = this.add.graphics().setDepth(60).setScrollFactor(0);
    this.drawFullOverlay(overlay, 0x000000, 0.55);
    this.gameOverGfx = overlay;

    const title = this.add
      .text(cx, cy - 100, "You didn't make it!", {
        fontFamily: "Arial Black, sans-serif",
        fontSize: `${Math.min(Math.round(W * 0.07), 38)}px`,
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(61);

    const sub = this.add
      .text(cx, cy - 40, "Try again on the app", {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.min(Math.round(W * 0.045), 22)}px`,
        color: "#cccccc",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(61);

    const coinMsg = this.add
      .text(cx, cy + 10, `Coins collected: ${payload.coins}`, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.min(Math.round(W * 0.04), 20)}px`,
        color: "#FFD700",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(61);

    const installBtn = this.makeInstallButton(cx, cy + 80);

    this.gameOverObjects = [overlay, title, sub, coinMsg, installBtn];
    this.gameOverTexts = [title, sub, coinMsg];
    this.gameOverBtn = installBtn;
  }

  private showWin(payload: ResultPayload): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    const overlay = this.add.graphics().setDepth(60).setScrollFactor(0);
    this.drawFullOverlay(overlay, 0x000000, 0.6);
    this.winGfx = overlay;

    const title = this.add
      .text(cx, cy - 80, "Congratulations! 🎉", {
        fontFamily: "Arial Black, sans-serif",
        fontSize: `${Math.min(Math.round(W * 0.07), 36)}px`,
        color: "#FFD700",
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(61)
      .setScale(0);

    this.tweens.add({
      targets: title,
      scaleX: 1,
      scaleY: 1,
      duration: 400,
      ease: "Back.easeOut",
    });

    const coinMsg = this.add
      .text(cx, cy - 10, `Coins collected: ${payload.coins}`, {
        fontFamily: "Arial, sans-serif",
        fontSize: `${Math.min(Math.round(W * 0.04), 22)}px`,
        color: "#FFD700",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(61);

    const installBtn = this.makeInstallButton(cx, cy + 70);
    this.burstConfetti(W, H);

    this.winObjects = [overlay, title, coinMsg, installBtn];
    this.winTexts = [title, coinMsg];
    this.winBtn = installBtn;
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private onGameStarted(): void {
    const targets = [
      this.startOverlay,
      this.startTitle,
      this.startGlow,
      this.startTapLabel,
      this.startArrow,
      this.startHint,
    ].filter(Boolean);

    this.tweens.add({
      targets,
      alpha: 0,
      duration: 380,
      ease: "Quad.easeIn",
      onComplete: () => this.startGroup?.setVisible(false),
    });

    this.tweens.add({
      targets: [this.coinIcon, this.coinText],
      alpha: 1,
      duration: 300,
    });
  }

  private onScoreUpdate(p: ScorePayload): void {
    this.coinText.setText(`× ${p.coins}`);

    if (p.multiplier > 1 && !this.comboVisible)
      this.showComboBadge(p.multiplier);
    if (p.multiplier === 1 && this.comboVisible) this.hideComboBadge();
  }

  private onCoinCollected(p: CoinPayload): void {
    if (p.multiplier > 1) {
      this.txtCombo.setText(`×${p.multiplier} COMBO!  +${p.earned}`);
    }
  }

  private onComboReset(): void {
    this.hideComboBadge();
  }

  private onResult(_p: ResultPayload): void {
    // nothing — wait for show-restart
  }

  private onShowRestart(p: ResultPayload): void {
    if (this.isWin) {
      this.showWin(p);
    } else {
      this.showGameOverScreen(p);
    }
  }

  // ── Coin fly-to-HUD animation ─────────────────────────────────────────────

  private flyCoinToHUD(worldX: number, worldY: number): void {
    const coinSize = Math.round(this.scale.height * 0.07);

    const iconX = this.scale.width - 16 - coinSize / 2;
    const iconY = coinSize / 2 + 8;

    const flyIcon = this.add
      .image(worldX, worldY, "coin", 0)
      .setFrame(0)
      .setDepth(150)
      .setScrollFactor(0);

    // Scale correctly (keeps ratio)
    const baseWidth = flyIcon.width;
    const scale = coinSize / baseWidth;

    flyIcon.setScale(scale);

    this.tweens.add({
      targets: flyIcon,
      x: iconX,
      y: iconY,
      scaleX: scale,
      scaleY: scale,
      duration: 500,
      ease: "Cubic.easeIn",

      onComplete: () => {
        flyIcon.destroy();

        const baseHudWidth = this.coinIcon.width;
        const hudScale = coinSize / baseHudWidth;

        const popScale = hudScale * 1.3;

        this.tweens.add({
          targets: this.coinIcon,
          scaleX: popScale,
          scaleY: popScale,
          duration: 80,
          yoyo: true,

          onComplete: () => {
            this.coinIcon.setScale(hudScale);
          },
        });
      },
    });
  }

  // ── Combo badge ───────────────────────────────────────────────────────────

  private showComboBadge(multiplier: number): void {
    this.comboVisible = true;
    this.txtCombo.setText(`×${multiplier} COMBO!`).setVisible(true);
    this.tweens.killTweensOf(this.txtCombo);
    this.tweens.add({
      targets: this.txtCombo,
      alpha: 1,
      duration: 180,
      ease: "Quad.easeOut",
    });
    this.tweens.add({
      targets: this.txtCombo,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private hideComboBadge(): void {
    if (!this.comboVisible) return;
    this.comboVisible = false;
    this.tweens.killTweensOf(this.txtCombo);
    this.tweens.add({
      targets: this.txtCombo,
      alpha: 0,
      scaleX: 0.8,
      scaleY: 0.8,
      duration: 180,
      onComplete: () => this.txtCombo.setVisible(false).setScale(1),
    });
  }

  // ── Restart ───────────────────────────────────────────────────────────────

  private restartGame(): void {
    this.gameOverObjects.forEach((o) => o.destroy());
    this.gameOverObjects = [];
    this.gameOverGfx = null;
    this.gameOverTexts = [];
    this.gameOverBtn = null;
    this.winObjects.forEach((o) => o.destroy());
    this.winObjects = [];
    this.winGfx = null;
    this.winTexts = [];
    this.winBtn = null;
    this.drawHearts(3);
    this.scene.stop("UIScene");
    this.scene.start("GameScene");
  }
}

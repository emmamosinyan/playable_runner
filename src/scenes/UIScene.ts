import Phaser from "phaser";
import type { GameScene, ScorePayload, CoinPayload, ResultPayload } from "./GameScene";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  white:   "#ffffff",
  gold:    "#ffcc00",
  orange:  "#ff9900",
  cyan:    "#00ffee",
  red:     "#ff3344",
  green:   "#44dd88",
  dim:     "#aaaaaa",
  dark:    "#111111",
  overlay: 0x000000,
} as const;

const FONT     = "'Orbitron', 'Arial Black', sans-serif";
const FONT_ALT = "'Arial Black', sans-serif";

function txt(
  extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily:      FONT,
    fontSize:        "24px",
    color:           C.white,
    stroke:          C.dark,
    strokeThickness: 4,
    ...extra,
  };
}

// ── Confetti palette ──────────────────────────────────────────────────────────
const CONFETTI_COLORS = [0xff4455, 0xffcc00, 0x44dd88, 0x00ffee, 0xff9900, 0xcc44ff, 0x4488ff];

// ── UIScene ───────────────────────────────────────────────────────────────────
export class UIScene extends Phaser.Scene {
  // HUD
  private hudGroup!:  Phaser.GameObjects.Container;
  private coinIcon!:  Phaser.GameObjects.Image;
  private coinText!:  Phaser.GameObjects.Text;
  private txtCombo!:      Phaser.GameObjects.Text;
  private heartGraphics!: Phaser.GameObjects.Graphics;
  private currentLives    = 3;
  private comboVisible    = false;

  // Start screen
  private startGroup!:  Phaser.GameObjects.Container;

  // Game-over (dynamic objects, created on each game-over)
  private gameOverObjects: Phaser.GameObjects.GameObject[] = [];

  // Win screen (dynamic objects, created on each win)
  private winObjects: Phaser.GameObjects.GameObject[] = [];
  private confettiEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  // Footer
  private footerImage!:      Phaser.GameObjects.Image;
  private footerVisible       = false;
  private downloadButton!:   Phaser.GameObjects.Container;

  // routing
  private isWin = false;

  constructor() { super({ key: "UIScene" }); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  create(): void {
    this.input.setTopOnly(false);

    const W = this.scale.width;
    const H = this.scale.height;

    this.isWin       = false;
    this.comboVisible = false;

    this.ensureConfettiTexture();

    this.buildHUD(W);
    this.buildStartScreen(W, H);

    this.subscribeToGameScene();

    this.createFooter();

    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      const W = gameSize.width;
      const H = gameSize.height;

      // Hearts — redraw at same position
      if (this.heartGraphics) {
        this.heartGraphics.setPosition(0, 0);
        this.drawHearts(this.currentLives);
      }

      // Coin icon + text
      this.coinIcon?.setPosition(W - 115, 28);
      this.coinText?.setPosition(W - 96, 28);

      // Footer — crossfade to swapped texture on orientation change
      if (this.footerImage) {
        const isLandscape = W > H;
        const key = isLandscape ? "footer_large" : "footer";
        const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
        const displayH = (tex.height / tex.width) * W;

        this.tweens.killTweensOf(this.footerImage);
        this.tweens.add({
          targets:  this.footerImage,
          alpha:    0,
          duration: 120,
          ease:     "Linear",
          onComplete: () => {
            this.footerImage
              .setTexture(key)
              .setPosition(0, H)
              .setDisplaySize(W, displayH);
            this.tweens.add({
              targets:  this.footerImage,
              alpha:    1,
              duration: 180,
              ease:     "Linear",
            });
            this.repositionDownloadButton();
          },
        });
      } else {
        this.repositionDownloadButton();
      }
    });
  }

  private createFooter(): void {
    const isLandscape = this.scale.width > this.scale.height;
    const key = isLandscape ? "footer_large" : "footer";

    const tex      = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const naturalW = tex.width;
    const naturalH = tex.height;

    const displayW = this.scale.width;
    const displayH = (naturalH / naturalW) * displayW;

    this.footerImage = this.add.image(0, this.scale.height, key)
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
    bg.fillStyle(0xFF6B00, 1);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 10);
    bg.fillStyle(0xFF8C00, 0.4);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH / 2, 10);

    const label = this.add.text(0, 0, "⬇ Download", {
      fontFamily:      "monospace",
      fontSize:        "16px",
      color:           "#ffffff",
      fontStyle:       "bold",
      stroke:          "#000000",
      strokeThickness: 2,
    }).setOrigin(0.5, 0.5);

    this.downloadButton = this.add.container(0, 0, [bg, label])
      .setDepth(200)
      .setSize(btnW, btnH)
      .setInteractive(
        new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH),
        Phaser.Geom.Rectangle.Contains,
        true,
      );

    this.downloadButton.on("pointerdown", () => {
      this.tweens.add({
        targets:  this.downloadButton,
        scaleX:   0.93,
        scaleY:   0.93,
        duration: 80,
        yoyo:     true,
        onComplete: () => {
          window.open("https://example.com", "_blank");
        },
      });
    });

    this.downloadButton.on("pointerover", () => this.downloadButton.setScale(1.05));
    this.downloadButton.on("pointerout",  () => this.downloadButton.setScale(1));

    this.repositionDownloadButton();
  }

  private repositionDownloadButton(): void {
    if (!this.footerImage || !this.downloadButton) return;

    const W = this.scale.width;
    const H = this.scale.height;
    const isPortrait = H > W;

    const footerBottom = this.footerImage.y;
    const footerTop    = footerBottom - this.footerImage.displayHeight;
    const footerMidY   = footerTop + this.footerImage.displayHeight / 2;

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
      ["game-started",   this.onGameStarted.bind(this)],
      ["score-update",   (p) => this.onScoreUpdate(p as ScorePayload)],
      ["coin-collected", (p) => this.onCoinCollected(p as CoinPayload)],
      ["combo-reset",    this.onComboReset.bind(this)],
      ["lives-update",   (n) => { this.currentLives = n as number; this.drawHearts(n as number); }],
      ["game-over",      (p) => { this.isWin = false; this.onResult(p as ResultPayload); }],
      ["game-finished",  (p) => { this.isWin = true;  this.onResult(p as ResultPayload); }],
      ["show-restart",   (p) => this.onShowRestart(p as ResultPayload)],
    ];

    for (const [event, handler] of handlers) gs.events.on(event, handler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const [event, handler] of handlers) gs.events.off(event, handler);
    });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  private buildHUD(W: number): void {
    this.coinIcon = this.add.image(W - 115, 28, "coin", 0)
      .setDisplaySize(32, 32)
      .setDepth(50)
      .setScrollFactor(0)
      .setAlpha(0);

    this.coinText = this.add.text(W - 96, 28, "× 0", {
      fontFamily:      "monospace",
      fontSize:        "20px",
      color:           "#ffffff",
      stroke:          "#000000",
      strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(50).setAlpha(0);

    this.txtCombo = this.add.text(W / 2, 68, "×2 COMBO!", txt({
      fontSize:        "28px",
      color:           C.orange,
      strokeThickness: 5,
    })).setOrigin(0.5, 0).setVisible(false).setAlpha(0);

    this.hudGroup = this.add.container(0, 0, [this.txtCombo]);

    this.createHearts();
  }

  private createHearts(): void {
    this.heartGraphics = this.add.graphics().setDepth(50);
    this.currentLives  = 3;
    this.drawHearts(3);
  }

  private drawHearts(lives: number): void {
    this.heartGraphics.clear();
    const size    = 18;
    const padding = 8;
    const startX  = 20;
    const startY  = 20;

    for (let i = 0; i < 3; i++) {
      const x      = startX + i * (size + padding);
      const y      = startY;
      const filled = i < lives;

      if (filled) {
        this.heartGraphics.fillStyle(0xe63946, 1);
      } else {
        this.heartGraphics.fillStyle(0x444444, 0.6);
      }

      this.heartGraphics.fillCircle(x + size * 0.27, y + size * 0.3, size * 0.27);
      this.heartGraphics.fillCircle(x + size * 0.73, y + size * 0.3, size * 0.27);
      this.heartGraphics.fillTriangle(
        x,            y + size * 0.45,
        x + size,     y + size * 0.45,
        x + size * 0.5, y + size,
      );
    }
  }

  // ── Start screen ──────────────────────────────────────────────────────────

  private buildStartScreen(W: number, H: number): void {
    const cx = W / 2;
    const cy = H / 2;

    // Dark gradient overlay
    const overlay = this.add.graphics();
    overlay.fillGradientStyle(0x000000, 0x000000, 0x000a1a, 0x000a1a, 0.55);
    overlay.fillRect(-cx, -cy, W, H);

    // Title
    const title = this.add.text(0, -H * 0.18, "PLAYABLE\nRUNNER", txt({
      fontSize:        "72px",
      color:           C.cyan,
      strokeThickness: 8,
      align:           "center",
    })).setOrigin(0.5);

    // Subtitle glow strip
    const glow = this.add.text(0, -H * 0.02, "infinite runner", {
      fontFamily:      FONT_ALT,
      fontSize:        "18px",
      color:           C.dim,
      letterSpacing:   6,
    }).setOrigin(0.5);

    // TAP TO START
    const tapLabel = this.add.text(0, H * 0.12, "TAP TO START", txt({
      fontSize:        "40px",
      color:           C.gold,
      strokeThickness: 6,
    })).setOrigin(0.5);

    this.tweens.add({
      targets:  tapLabel,
      alpha:    0.3,
      duration: 680,
      yoyo:     true,
      repeat:   -1,
      ease:     "Sine.easeInOut",
    });

    // Bouncing arrow
    const arrow = this.add.text(0, H * 0.23, "▼", txt({
      fontSize:        "34px",
      color:           C.white,
      strokeThickness: 3,
    })).setOrigin(0.5);

    this.tweens.add({
      targets:  arrow,
      y:        H * 0.23 + 14,
      duration: 520,
      yoyo:     true,
      repeat:   -1,
      ease:     "Sine.easeInOut",
    });

    // Controls hint
    const hint = this.add.text(0, H * 0.35, "tap / click  or  SPACE to jump", {
      fontFamily: FONT_ALT,
      fontSize:   "17px",
      color:      C.dim,
    }).setOrigin(0.5);

    this.startGroup = this.add.container(cx, cy, [overlay, title, glow, tapLabel, arrow, hint]);
  }


  // ── Install & Earn button ─────────────────────────────────────────────────

  private makeInstallButton(cx: number, btnY: number): Phaser.GameObjects.Container {
    const btnW = 220;
    const btnH = 60;

    const bg = this.add.graphics();
    bg.fillStyle(0xe63946, 1);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, 14);
    bg.fillStyle(0xff6b6b, 0.35);
    bg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH / 2, 14);

    const label = this.add.text(0, 0, "Install & Earn", {
      fontFamily:      "Arial Black, sans-serif",
      fontSize:        "22px",
      color:           "#ffffff",
      stroke:          "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5, 0.5);

    const btn = this.add.container(cx, btnY, [bg, label])
      .setDepth(200)
      .setSize(btnW, btnH)
      .setInteractive(
        new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH),
        Phaser.Geom.Rectangle.Contains,
        { useHandCursor: true },
      );

    btn.on("pointerover", () => {
      this.tweens.killTweensOf(btn);
      this.tweens.add({ targets: btn, scaleX: 1.06, scaleY: 1.06, duration: 100 });
    });
    btn.on("pointerout", () => {
      this.tweens.killTweensOf(btn);
      this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 100 });
    });
    btn.on("pointerdown", () => {
      this.tweens.killTweensOf(btn);
      this.tweens.add({
        targets:  btn,
        scaleX:   0.93,
        scaleY:   0.93,
        duration: 80,
        yoyo:     true,
        onComplete: () => window.open("https://example.com", "_blank"),
      });
    });

    return btn;
  }

  // ── Button factory ────────────────────────────────────────────────────────

  private makeButton(
    x: number, y: number,
    label: string,
    bgColor: number,
    textColor: string,
    onClick: () => void,
    w = 220, h = 52,
    fontSize = "22px",
  ): Phaser.GameObjects.Container {
    const bg = this.add.graphics();
    bg.fillStyle(bgColor, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);

    const lbl = this.add.text(0, 0, label, txt({
      fontSize,
      color:           textColor,
      strokeThickness: 0,
      stroke:          textColor,
    })).setOrigin(0.5);

    const btn = this.add.container(x, y, [bg, lbl])
      .setSize(w, h)
      .setInteractive({ useHandCursor: true });

    btn.on("pointerover",  () => this.tweens.add({ targets: btn, scaleX: 1.06, scaleY: 1.06, duration: 100 }));
    btn.on("pointerout",   () => this.tweens.add({ targets: btn, scaleX: 1,    scaleY: 1,    duration: 100 }));
    btn.on("pointerdown",  () => this.tweens.add({ targets: btn, scaleX: 0.94, scaleY: 0.94, duration: 70  }));
    btn.on("pointerup",    () => {
      this.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 80 });
      onClick();
    });

    return btn;
  }

  // ── Confetti ──────────────────────────────────────────────────────────────

  private ensureConfettiTexture(): void {
    if (this.textures.exists("confetti")) return;
    const cw = 8, ch = 6;
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
        frame:      CONFETTI_COLORS.map((_, i) => i),
        lifespan:   { min: 1800, max: 3200 },
        speedY:     { min: 120,  max: 320 },
        speedX:     { min: -60,  max: 60  },
        rotate:     { min: 0,    max: 360 },
        scale:      { min: 1.2,  max: 2.4 },
        alpha:      { start: 1,  end: 0   },
        gravityY:   180,
        emitting:   false,
      });
      emitter.explode(28);
      this.confettiEmitters.push(emitter);
    }

    // Second wave with slight delay for depth
    this.time.delayedCall(320, () => {
      const fracs2 = [0.15, 0.45, 0.7, 0.88];
      for (const frac of fracs2) {
        const e = this.add.particles(W * frac, -10, "confetti", {
          frame:    CONFETTI_COLORS.map((_, i) => i),
          lifespan: { min: 2200, max: 3800 },
          speedY:   { min: 90,   max: 260 },
          speedX:   { min: -80,  max: 80  },
          rotate:   { min: 0,    max: 360 },
          scale:    { min: 1.0,  max: 2.0 },
          alpha:    { start: 1,  end: 0   },
          gravityY: 160,
          emitting: false,
        });
        e.explode(18);
        this.confettiEmitters.push(e);
      }
    });
  }

  // ── Show screens ──────────────────────────────────────────────────────────

  private showGameOverScreen(payload: ResultPayload): void {
    const W  = this.scale.width;
    const H  = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    const overlay = this.add.rectangle(cx, cy, W, H, 0x000000, 0.55)
      .setDepth(60).setScrollFactor(0);
    overlay.removeInteractive();

    const title = this.add.text(cx, cy - 100, "You didn't make it!", {
      fontFamily:      "Arial Black, sans-serif",
      fontSize:        "42px",
      color:           "#ffffff",
      stroke:          "#000000",
      strokeThickness: 6,
      align:           "center",
    }).setOrigin(0.5).setDepth(61);

    const sub = this.add.text(cx, cy - 40, "Try again on the app", {
      fontFamily:      "Arial, sans-serif",
      fontSize:        "24px",
      color:           "#cccccc",
      stroke:          "#000000",
      strokeThickness: 3,
      align:           "center",
    }).setOrigin(0.5).setDepth(61);

    const coinMsg = this.add.text(cx, cy + 10, `Coins collected: ${payload.coins}`, {
      fontFamily:      "Arial, sans-serif",
      fontSize:        "22px",
      color:           "#FFD700",
      stroke:          "#000000",
      strokeThickness: 3,
      align:           "center",
    }).setOrigin(0.5).setDepth(61);

    const installBtn = this.makeInstallButton(cx, cy + 80);
    this.gameOverObjects = [overlay, title, sub, coinMsg, installBtn];
  }

  private showWin(payload: ResultPayload): void {
    const W  = this.scale.width;
    const H  = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    const overlay = this.add.rectangle(cx, cy, W, H, 0x000000, 0.6)
      .setDepth(60)
      .setScrollFactor(0);
    overlay.removeInteractive();

    const title = this.add.text(cx, cy - 80, "Congratulations! 🎉", {
      fontFamily:      "Arial Black, sans-serif",
      fontSize:        "40px",
      color:           "#FFD700",
      stroke:          "#000000",
      strokeThickness: 6,
      align:           "center",
    }).setOrigin(0.5).setDepth(61).setScale(0);

    this.tweens.add({
      targets:  title,
      scaleX:   1,
      scaleY:   1,
      duration: 400,
      ease:     "Back.easeOut",
    });

    const coinMsg = this.add.text(cx, cy - 10, `Coins collected: ${payload.coins}`, {
      fontFamily:      "Arial, sans-serif",
      fontSize:        "24px",
      color:           "#FFD700",
      stroke:          "#000000",
      strokeThickness: 3,
      align:           "center",
    }).setOrigin(0.5).setDepth(61);

    const installBtn = this.makeInstallButton(cx, cy + 70);
    this.burstConfetti(W, H);
    this.winObjects = [overlay, title, coinMsg, installBtn];
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  private onGameStarted(): void {
    // Dismiss start screen
    this.tweens.add({
      targets:  this.startGroup,
      alpha:    0,
      y:        this.startGroup.y - 50,
      duration: 380,
      ease:     "Quad.easeIn",
      onComplete: () => this.startGroup.setVisible(false),
    });

    // Fade in HUD elements
    this.tweens.add({
      targets:  [this.coinIcon, this.coinText],
      alpha:    1,
      duration: 300,
    });
  }

  private onScoreUpdate(p: ScorePayload): void {
    this.coinText.setText(`× ${p.coins}`);

    if (p.multiplier > 1 && !this.comboVisible) this.showComboBadge(p.multiplier);
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

  // ── Combo badge ───────────────────────────────────────────────────────────

  private showComboBadge(multiplier: number): void {
    this.comboVisible = true;
    this.txtCombo.setText(`×${multiplier} COMBO!`).setVisible(true);
    this.tweens.killTweensOf(this.txtCombo);
    this.tweens.add({
      targets:  this.txtCombo,
      alpha:    1,
      duration: 180,
      ease:     "Quad.easeOut",
    });
    this.tweens.add({
      targets:  this.txtCombo,
      scaleX:   1.08, scaleY: 1.08,
      duration: 480,
      yoyo:     true,
      repeat:   -1,
      ease:     "Sine.easeInOut",
    });
  }

  private hideComboBadge(): void {
    if (!this.comboVisible) return;
    this.comboVisible = false;
    this.tweens.killTweensOf(this.txtCombo);
    this.tweens.add({
      targets:  this.txtCombo,
      alpha:    0,
      scaleX:   0.8, scaleY: 0.8,
      duration: 180,
      onComplete: () => this.txtCombo.setVisible(false).setScale(1),
    });
  }

  // ── Restart ───────────────────────────────────────────────────────────────

  private restartGame(): void {
    this.gameOverObjects.forEach((o) => o.destroy());
    this.gameOverObjects = [];
    this.winObjects.forEach((o) => o.destroy());
    this.winObjects = [];
    this.drawHearts(3);
    this.scene.stop("UIScene");
    this.scene.start("GameScene");
  }
}

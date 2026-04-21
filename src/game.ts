import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { GameScene } from "./scenes/GameScene";
import { UIScene } from "./scenes/UIScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: "#87CEEB",
  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: "game-container",
    width: "100%",
    height: "100%",
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 }, // per-body gravity used instead
      debug: false,
    },
  },
  scene: [BootScene, GameScene, UIScene],
};

const game = new Phaser.Game(config);

window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    game.scale.refresh();
    game.scale.setGameSize(window.innerWidth, window.innerHeight);
  }, 150);
  setTimeout(() => {
    game.scale.refresh();
    game.scale.setGameSize(window.innerWidth, window.innerHeight);
  }, 400);
});

window.addEventListener("resize", () => {
  game.scale.refresh();
});

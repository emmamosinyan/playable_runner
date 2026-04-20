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

new Phaser.Game(config);

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  create(): void {
    this.scene.launch("UIScene");
  }

  update(): void {}
}

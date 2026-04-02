import Phaser from 'phaser'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  backgroundColor: '#1a1a2e',
  scene: {
    create() {
      const text = (this as Phaser.Scene).add.text(400, 300, 'Tennis 1v1', {
        fontSize: '32px',
        color: '#ffffff',
      })
      text.setOrigin(0.5)
    },
  },
}

new Phaser.Game(config)

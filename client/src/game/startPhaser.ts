import Phaser from 'phaser'

let current: Phaser.Game | null = null

export function destroyGame(): void {
  current?.destroy(true)
  current = null
}

export function startPhaserPlaceholder(
  rootId: string,
  nickname: string,
  mode: 'create' | 'bot',
): void {
  destroyGame()
  const el = document.getElementById(rootId)
  if (!el) return
  el.innerHTML = ''
  current = new Phaser.Game({
    type: Phaser.AUTO,
    parent: rootId,
    width: 800,
    height: 600,
    backgroundColor: '#1a1a2e',
    scene: {
      create() {
        const scene = this as Phaser.Scene
        scene.add
          .text(400, 180, `Игрок: ${nickname}`, {
            fontSize: '22px',
            color: '#e8e8e8',
            fontFamily: 'system-ui, sans-serif',
          })
          .setOrigin(0.5)
        scene.add
          .text(
            400,
            240,
            mode === 'bot' ? 'Режим: игра с ботом' : 'Режим: создать игру',
            { fontSize: '18px', color: '#a8a8b8', fontFamily: 'system-ui, sans-serif' },
          )
          .setOrigin(0.5)
        scene.add
          .text(400, 300, 'Игровой процесс — эпик 03 и далее', {
            fontSize: '15px',
            color: '#6c6c7c',
            fontFamily: 'system-ui, sans-serif',
          })
          .setOrigin(0.5)
      },
    },
  })
}

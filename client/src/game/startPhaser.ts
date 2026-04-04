import Phaser from 'phaser'
import type { Socket } from 'socket.io-client'
import { createMatchGame, type MatchGameHandle, type MatchSceneOpts } from './matchScene'
import type { Side } from './gameTypes'

let current: Phaser.Game | MatchGameHandle | null = null

export function destroyGame(): void {
  if (!current) return
  const anyCur = current as MatchGameHandle
  const sc = anyCur.scene?.getScene?.('match') as { shutdown?: () => void } | undefined
  sc?.shutdown?.()
  current.destroy(true)
  current = null
}

export function startPhaserPlaceholder(
  rootId: string,
  nickname: string,
  mode: 'create' | 'bot' | 'online',
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
            mode === 'bot'
              ? 'Режим: игра с ботом (эпик 05)'
              : mode === 'online'
                ? 'Режим: онлайн-матч'
                : 'Режим: создать игру',
            { fontSize: '18px', color: '#a8a8b8', fontFamily: 'system-ui, sans-serif' },
          )
          .setOrigin(0.5)
        scene.add
          .text(400, 300, 'Онлайн-матч запускается из лобби после отсчёта.', {
            fontSize: '15px',
            color: '#6c6c7c',
            fontFamily: 'system-ui, sans-serif',
          })
          .setOrigin(0.5)
      },
    },
  })
}

export function startOnlineMatch(
  rootId: string,
  mySide: Side,
  socket: Socket,
  nickname: string,
  onMatchEnd: MatchSceneOpts['onMatchEnd'],
  opts?: { spectator?: boolean },
): void {
  destroyGame()
  const el = document.getElementById(rootId)
  if (!el) return
  el.innerHTML = ''
  current = createMatchGame(rootId, {
    socket,
    mySide,
    nickname,
    spectator: opts?.spectator,
    onMatchEnd,
  })
}

export function startBotMatch(
  rootId: string,
  socket: Socket,
  nickname: string,
  opts: {
    opponentName: string
    onMatchEnd: MatchSceneOpts['onMatchEnd']
  },
): void {
  destroyGame()
  const el = document.getElementById(rootId)
  if (!el) return
  el.innerHTML = ''
  current = createMatchGame(rootId, {
    socket,
    mySide: 'left',
    nickname,
    isBot: true,
    opponentName: opts.opponentName,
    onMatchEnd: opts.onMatchEnd,
  })
}

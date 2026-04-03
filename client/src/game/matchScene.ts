import Phaser from 'phaser'
import type { Socket } from 'socket.io-client'
import type { GameStateWire, Score, Side } from './gameTypes'
import { matchAudio } from './matchAudio'

const COURT_W = 8.23
const COURT_L = 23.77

const SIDES_FLIP_MS = 2600

export type MatchSceneOpts = {
  socket: Socket
  mySide: Side
  nickname: string
  /** Наблюдатель: без ввода, нейтральные подписи */
  spectator?: boolean
  /** Матч с ботом: пауза P, вкладка, без индикаторов на стороне бота (сервер не шлёт) */
  isBot?: boolean
  opponentName?: string
  onMatchEnd: (payload: {
    winner: Side
    reason: string
    sets: [number, number][]
    technical?: boolean
  }) => void
}

let matchBootstrap: MatchSceneOpts | null = null

function courtPixelY(yM: number, my: Side, ch: number): number {
  const t = my === 'left' ? yM / COURT_L : (COURT_L - yM) / COURT_L
  return t * ch
}

function courtPixelX(xM: number, cw: number): number {
  return (xM / COURT_W) * cw
}

function reasonUsesEventSoundOnly(reason: string): boolean {
  return (
    reason.includes('Аут') ||
    reason.includes('Сетка') ||
    reason.includes('сетк') ||
    reason.includes('Двойн') ||
    reason.includes('ошибк')
  )
}

export class MatchScene extends Phaser.Scene {
  private opts!: MatchSceneOpts
  private lastState: GameStateWire | null = null
  private graphics!: Phaser.GameObjects.Graphics
  private ballG!: Phaser.GameObjects.Arc
  private leftG!: Phaser.GameObjects.Arc
  private rightG!: Phaser.GameObjects.Arc
  private courtLayer!: Phaser.GameObjects.Container
  private sidesDim!: Phaser.GameObjects.Rectangle
  private scoreText!: Phaser.GameObjects.Text
  private toastText!: Phaser.GameObjects.Text
  private serveText!: Phaser.GameObjects.Text
  private sidesBanner!: Phaser.GameObjects.Text
  private cw = 1
  private ch = 1
  private ox = 0
  private oy = 0
  private scalePx = 1
  private keys?: {
    w: Phaser.Input.Keyboard.Key
    a: Phaser.Input.Keyboard.Key
    s: Phaser.Input.Keyboard.Key
    d: Phaser.Input.Keyboard.Key
    up: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
    space: Phaser.Input.Keyboard.Key
  }
  private indicatorMode: 'direction' | 'power' | null = null
  private indicatorStart = 0
  private indicatorEl: HTMLDivElement | null = null
  private indicatorBar: HTMLDivElement | null = null
  private pointerTarget: { xM: number; yM: number } | null = null
  private moveEmitAcc = 0
  private prevBallVy: number | null = null
  private bounceCd = 0
  private sidesFlipTween: Phaser.Tweens.Tween | null = null
  private pauseKey?: Phaser.Input.Keyboard.Key
  private pauseOverlayEl: HTMLDivElement | null = null
  private pauseCountdownTimer: ReturnType<typeof setInterval> | null = null
  private visibilityListener?: () => void

  private readonly onState = (s: GameStateWire): void => {
    this.lastState = s
  }
  private readonly onIndicator = (p: { phase: 'direction' | 'power' }): void => {
    if (this.opts.spectator) return
    this.showIndicator(p.phase)
  }
  private readonly onPoint = (p: { reason: string; score: Score }): void => {
    const before = this.lastState?.score
    if (before && p.score.sets.length > before.sets.length) {
      matchAudio.setWon()
    } else if (
      before &&
      (p.score.games[0] !== before.games[0] || p.score.games[1] !== before.games[1])
    ) {
      matchAudio.gameWon()
    } else if (!reasonUsesEventSoundOnly(p.reason)) {
      matchAudio.point()
    }
    this.flashToast(p.reason)
  }
  private readonly onEvent = (p: { type: string }): void => {
    const map: Record<string, string> = {
      ace: 'Эйс',
      net: 'Сетка',
      out: 'Аут',
      let: 'Лет',
      fault: 'Ошибка',
    }
    switch (p.type) {
      case 'ace':
        matchAudio.ace()
        break
      case 'net':
        matchAudio.net()
        break
      case 'out':
        matchAudio.out()
        break
      case 'let':
        matchAudio.let()
        break
      case 'fault':
        matchAudio.fault()
        break
      default:
        matchAudio.point()
    }
    this.flashToast(map[p.type] ?? p.type)
  }
  private readonly onSides = (): void => {
    matchAudio.sidesChange()
    this.startSidesFlipAnimation()
  }
  private readonly onOver = (p: {
    winner: Side
    reason: string
    sets?: [number, number][]
    technical?: boolean
  }): void => {
    this.hidePauseOverlay()
    if (!this.opts.spectator) {
      if (p.winner === this.opts.mySide) matchAudio.matchWin()
      else matchAudio.matchLose()
    }
    this.hideIndicator()
    this.opts.onMatchEnd({
      winner: p.winner,
      reason: p.reason,
      sets: p.sets ?? [],
      technical: p.technical,
    })
  }

  private readonly onGamePause = (p: { reason?: string; seconds?: number; source?: string }): void => {
    if (p.reason === 'disconnect' && p.seconds !== undefined) {
      const peerMsg = 'Соперник отключился. Идёт отсчёт до завершения матча.'
      const tabMsg = 'Вкладка неактивна — вернитесь, иначе засчитается поражение.'
      this.showPauseOverlay(p.source === 'peer' ? peerMsg : tabMsg, p.seconds)
    }
  }

  private readonly onGameResume = (): void => {
    this.hidePauseOverlay()
  }

  private readonly onBotPauseState = (p: { paused: boolean }): void => {
    if (p.paused) {
      this.showPauseOverlay('Пауза. Нажмите P, чтобы продолжить.')
    } else {
      this.hidePauseOverlay()
    }
  }

  private showPauseOverlay(mainMsg: string, countdownFrom?: number): void {
    const parent = this.game.canvas?.parentElement
    if (!parent) return
    this.hidePauseOverlay()
    const el = document.createElement('div')
    el.className = 'match-pause-overlay'
    el.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(10,10,22,0.9);z-index:40;color:#e8e8f0;font:15px system-ui,sans-serif;text-align:center;padding:20px;white-space:pre-line'
    const t = document.createElement('div')
    el.appendChild(t)
    parent.appendChild(el)
    this.pauseOverlayEl = el
    if (countdownFrom !== undefined && countdownFrom > 0) {
      let left = countdownFrom
      const tick = (): void => {
        t.textContent = `${mainMsg}\nОсталось: ${left} с`
        left -= 1
        if (left < 0 && this.pauseCountdownTimer) {
          clearInterval(this.pauseCountdownTimer)
          this.pauseCountdownTimer = null
        }
      }
      tick()
      this.pauseCountdownTimer = setInterval(tick, 1000)
    } else {
      t.textContent = mainMsg
    }
  }

  private hidePauseOverlay(): void {
    if (this.pauseCountdownTimer) {
      clearInterval(this.pauseCountdownTimer)
      this.pauseCountdownTimer = null
    }
    this.pauseOverlayEl?.remove()
    this.pauseOverlayEl = null
  }

  constructor() {
    super('match')
  }

  init(data?: MatchSceneOpts): void {
    if (data && data.socket) {
      this.opts = data
    } else if (matchBootstrap) {
      this.opts = matchBootstrap
    } else {
      throw new Error('MatchScene: нет опций инициализации')
    }
    matchBootstrap = null
  }

  create(): void {
    const { width, height } = this.scale

    this.courtLayer = this.add.container(0, 0)
    this.graphics = this.add.graphics()
    this.ballG = this.add.circle(0, 0, 8, 0xf5d547, 1)
    this.leftG = this.add.circle(0, 0, 18, 0x4a90d9, 1)
    this.rightG = this.add.circle(0, 0, 18, 0xe85d75, 1)
    this.courtLayer.add([this.graphics, this.ballG, this.leftG, this.rightG])
    this.courtLayer.setDepth(2)

    this.sidesDim = this.add
      .rectangle(width / 2, height / 2, width, height, 0x0a0a14, 0.45)
      .setScrollFactor(0)
      .setDepth(4)
      .setVisible(false)

    this.sidesBanner = this.add
      .text(width / 2, height / 2, 'Смена сторон', {
        fontSize: '26px',
        color: '#f0f0f8',
        fontFamily: 'system-ui, sans-serif',
        fontStyle: '600',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(6)
      .setAlpha(0)

    this.scoreText = this.add
      .text(width / 2, 18, '', { fontSize: '16px', color: '#e8e8f0', fontFamily: 'system-ui' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(10)
    this.toastText = this.add
      .text(width / 2, height / 2 - 120, '', {
        fontSize: '20px',
        color: '#ffffff',
        fontFamily: 'system-ui',
        backgroundColor: '#00000088',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(10)
      .setVisible(false)
    this.serveText = this.add
      .text(width / 2, 42, '', { fontSize: '14px', color: '#a8c8ff', fontFamily: 'system-ui' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(10)

    if (this.opts.opponentName) {
      this.add
        .text(width / 2, 58, `vs ${this.opts.opponentName}`, {
          fontSize: '13px',
          color: '#9c9cb8',
          fontFamily: 'system-ui',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(10)
    }

    const kbd = this.input.keyboard
    if (kbd && !this.opts.spectator) {
      this.keys = {
        w: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        left: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        down: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        right: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        space: kbd.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      }
      if (this.opts.isBot) {
        this.pauseKey = kbd.addKey(Phaser.Input.Keyboard.KeyCodes.P)
      }
    }

    const sock = this.opts.socket
    sock.on('game:state', this.onState)
    sock.on('game:indicator:show', this.onIndicator)
    sock.on('game:point', this.onPoint)
    sock.on('game:event', this.onEvent)
    sock.on('game:sides:change', this.onSides)
    sock.on('game:over', this.onOver)

    if (this.opts.isBot) {
      this.visibilityListener = () => {
        sock.emit('bot:visibility', { hidden: document.visibilityState === 'hidden' })
      }
      document.addEventListener('visibilitychange', this.visibilityListener)
      sock.on('game:pause', this.onGamePause)
      sock.on('game:resume', this.onGameResume)
      sock.on('bot:pause:state', this.onBotPauseState)
    } else {
      sock.on('game:pause', this.onGamePause)
      sock.on('game:resume', this.onGameResume)
    }

    if (!this.opts.spectator) {
      this.input.on('pointerdown', this.onPointerDown, this)
    }

    this.layoutCourt(width, height)
    this.scale.on('resize', this.onResize, this)
  }

  private startSidesFlipAnimation(): void {
    this.sidesFlipTween?.stop()
    this.courtLayer.setRotation(0)
    const { width, height } = this.scale
    this.sidesDim.setPosition(width / 2, height / 2)
    this.sidesDim.setSize(width, height)
    this.sidesDim.setVisible(true)
    this.sidesBanner.setPosition(width / 2, height / 2)
    this.tweens.add({
      targets: this.sidesBanner,
      alpha: 1,
      duration: 280,
      yoyo: false,
    })
    this.sidesFlipTween = this.tweens.add({
      targets: this.courtLayer,
      rotation: Math.PI,
      duration: SIDES_FLIP_MS,
      ease: 'Cubic.easeInOut',
      onComplete: () => {
        this.courtLayer.setRotation(0)
        this.sidesFlipTween = null
        this.sidesDim.setVisible(false)
        this.tweens.add({
          targets: this.sidesBanner,
          alpha: 0,
          duration: 400,
        })
      },
    })
  }

  private readonly onResize = (sz: { width: number; height: number }): void => {
    this.layoutCourt(sz.width, sz.height)
    this.sidesDim.setPosition(sz.width / 2, sz.height / 2)
    this.sidesDim.setSize(sz.width, sz.height)
    this.sidesBanner.setPosition(sz.width / 2, sz.height / 2)
    this.scoreText.setPosition(sz.width / 2, 12)
    this.serveText.setPosition(sz.width / 2, 34)
    this.toastText.setPosition(sz.width / 2, sz.height / 2 - 120)
  }

  private readonly onPointerDown = (p: Phaser.Input.Pointer): void => {
    if (this.opts.spectator) return
    if (this.indicatorMode) {
      this.commitIndicator()
      return
    }
    const m = this.screenToCourtMeters(p.x, p.y)
    if (!m) return
    const self = this.selfMeters()
    if (!self) return
    const dxp = (m.xM - self.x) * this.scalePx
    const dyp = (m.yM - self.y) * this.scalePx
    if (Math.hypot(dxp, dyp) < 22) {
      this.pointerTarget = null
      this.opts.socket.emit('game:input:move', { dx: 0, dy: 0 })
      return
    }
    this.pointerTarget = { xM: m.xM, yM: m.yM }
  }

  private layoutCourt(width: number, height: number): void {
    const pad = 56
    const innerW = width - pad * 2
    const innerH = height - pad * 2 - 72
    this.scalePx = Math.min(innerW / COURT_W, innerH / COURT_L)
    this.cw = COURT_W * this.scalePx
    this.ch = COURT_L * this.scalePx
    this.ox = (width - this.cw) / 2
    this.oy = pad + 48
    this.courtLayer.setPosition(this.ox + this.cw / 2, this.oy + this.ch / 2)
  }

  private worldToScreen(xM: number, yM: number): { x: number; y: number } {
    return {
      x: this.ox + courtPixelX(xM, this.cw),
      y: this.oy + courtPixelY(yM, this.opts.mySide, this.ch),
    }
  }

  private worldToLayer(xM: number, yM: number): { x: number; y: number } {
    const g = this.worldToScreen(xM, yM)
    const cx = this.ox + this.cw / 2
    const cy = this.oy + this.ch / 2
    return { x: g.x - cx, y: g.y - cy }
  }

  private screenToCourtMeters(sx: number, sy: number): { xM: number; yM: number } | null {
    const lx = sx - this.ox
    const ly = sy - this.oy
    if (lx < 0 || ly < 0 || lx > this.cw || ly > this.ch) return null
    const xM = (lx / this.cw) * COURT_W
    const t = ly / this.ch
    const yM =
      this.opts.mySide === 'left' ? t * COURT_L : (1 - t) * COURT_L
    return { xM, yM }
  }

  private selfMeters(): { x: number; y: number } | null {
    const s = this.lastState
    if (!s) return null
    const p = this.opts.mySide === 'left' ? s.players.left : s.players.right
    return { x: p.x * COURT_W, y: p.y * COURT_L }
  }

  private showIndicator(phase: 'direction' | 'power'): void {
    this.indicatorMode = phase
    this.indicatorStart = this.time.now
    const parent = this.game.canvas.parentElement
    if (!parent) return
    if (!this.indicatorEl) {
      const root = document.createElement('div')
      root.className = 'match-indicator'
      root.style.cssText =
        'position:absolute;left:50%;bottom:12%;transform:translateX(-50%);width:min(360px,88vw);text-align:center;z-index:10;'
      const label = document.createElement('div')
      label.style.cssText = 'color:#e8e8f0;font:14px system-ui;margin-bottom:8px;'
      label.id = 'match-ind-label'
      const bar = document.createElement('div')
      bar.style.cssText =
        'position:relative;height:14px;border-radius:7px;background:#2a2a3e;overflow:hidden;border:1px solid #4a4a60;'
      const fill = document.createElement('div')
      fill.style.cssText =
        'position:absolute;top:0;left:0;bottom:0;width:50%;background:linear-gradient(90deg,#4a90d9,#f5d547);'
      bar.appendChild(fill)
      const hint = document.createElement('div')
      hint.style.cssText = 'color:#8888a0;font:12px system-ui;margin-top:8px;'
      hint.textContent = 'Пробел / тап — зафиксировать'
      root.append(label, bar, hint)
      parent.appendChild(root)
      this.indicatorEl = root
      this.indicatorBar = fill
    }
    const lab = this.indicatorEl.querySelector('#match-ind-label')
    if (lab) {
      lab.textContent =
        phase === 'power'
          ? 'Сила (центр — максимум)'
          : this.lastState?.phase === 'serving'
            ? 'Точность подачи'
            : 'Направление удара'
    }
    this.indicatorEl.style.display = 'block'
  }

  private hideIndicator(): void {
    this.indicatorMode = null
    if (this.indicatorEl) this.indicatorEl.style.display = 'none'
  }

  private commitIndicator(): void {
    if (!this.indicatorMode || !this.indicatorBar) return
    const t = (this.time.now - this.indicatorStart) / 1000
    const v = 0.5 + 0.5 * Math.sin(t * (this.indicatorMode === 'power' ? 2.8 : 2.2))
    matchAudio.racketHit()
    this.opts.socket.emit('game:input:indicator', {
      phase: this.indicatorMode,
      value: Math.max(0, Math.min(1, v)),
    })
    this.hideIndicator()
  }

  private flashToast(msg: string, ms = 1400): void {
    this.toastText.setText(msg)
    this.toastText.setVisible(true)
    this.time.delayedCall(ms, () => this.toastText.setVisible(false))
  }

  update(_t: number, dtMs: number): void {
    const dt = dtMs / 1000
    const s = this.lastState
    if (s) {
      if (s.phase === 'playing' && this.bounceCd <= 0) {
        const vy = s.ball.vy
        if (this.prevBallVy !== null && this.prevBallVy * vy < 0) {
          const mag = Math.max(Math.abs(this.prevBallVy), Math.abs(vy))
          if (mag > 0.015) {
            matchAudio.ballBounce()
            this.bounceCd = 0.22
          }
        }
        this.prevBallVy = vy
      } else {
        this.prevBallVy = null
      }
      this.bounceCd = Math.max(0, this.bounceCd - dt)

      this.drawCourt()
      this.drawBodies(s)
      this.scoreText.setText(this.formatScore(s))
      const srv = this.opts.spectator
        ? s.serving === 'left'
          ? 'Подача слева'
          : 'Подача справа'
        : s.serving === this.opts.mySide
          ? 'Ваша подача'
          : 'Подача соперника'
      this.serveText.setText(s.phase === 'serving' || s.phase === 'playing' ? srv : '')
    }

    if (this.indicatorMode && this.indicatorBar) {
      const t = (this.time.now - this.indicatorStart) / 1000
      const v = 0.5 + 0.5 * Math.sin(t * (this.indicatorMode === 'power' ? 2.8 : 2.2))
      this.indicatorBar.style.width = `${Math.round(v * 100)}%`
    }

    if (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.space) && this.indicatorMode) {
      this.commitIndicator()
    }

    if (this.opts.isBot && this.pauseKey && Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
      this.opts.socket.emit('bot:toggle_pause')
    }

    let dx = 0
    let dy = 0
    if (!this.opts.spectator && this.keys) {
      let vr = 0
      let vu = 0
      if (this.keys.a.isDown || this.keys.left.isDown) vr -= 1
      if (this.keys.d.isDown || this.keys.right.isDown) vr += 1
      if (this.keys.w.isDown || this.keys.up.isDown) vu += 1
      if (this.keys.s.isDown || this.keys.down.isDown) vu -= 1
      dx = vr
      dy = this.opts.mySide === 'left' ? -vu : vu
      const l = Math.hypot(dx, dy)
      if (l > 1e-6) {
        dx /= l
        dy /= l
      }

      if (this.pointerTarget && s && (s.phase === 'playing' || s.phase === 'serving')) {
        const self = this.opts.mySide === 'left' ? s.players.left : s.players.right
        const xM = self.x * COURT_W
        const yM = self.y * COURT_L
        const tx = this.pointerTarget.xM - xM
        const ty = this.pointerTarget.yM - yM
        const ll = Math.hypot(tx, ty)
        if (ll < 0.15) {
          this.pointerTarget = null
          dx = 0
          dy = 0
        } else {
          dx = tx / ll
          dy = ty / ll
        }
      }
    }

    this.moveEmitAcc += dt
    if (this.moveEmitAcc > 1 / 30) {
      this.moveEmitAcc = 0
      this.opts.socket.emit('game:input:move', { dx, dy })
    }
  }

  private formatScore(s: GameStateWire): string {
    const g = s.score.games
    const sets = s.score.sets.map((p) => `${p[0]}-${p[1]}`).join(' · ')
    const tb = s.score.isTiebreak ? ' (ТБ)' : ''
    let pts: string
    if (s.score.isTiebreak) {
      pts = `${s.score.points[0]}-${s.score.points[1]}`
    } else if (s.score.isDeuce) {
      pts =
        s.score.advantage === null
          ? 'Ровно'
          : this.opts.spectator
            ? s.score.advantage === 'left'
              ? 'ВП слева'
              : 'ВП справа'
            : s.score.advantage === this.opts.mySide
              ? 'ВП'
              : 'ВП соперника'
    } else {
      pts = `${s.score.points[0]}-${s.score.points[1]}`
    }
    return `${sets ? `${sets} | ` : ''}Гейм ${g[0]}-${g[1]}${tb} · Очки ${pts}`
  }

  private drawCourt(): void {
    const g = this.graphics
    g.clear()
    const hw = this.cw / 2
    const hh = this.ch / 2
    g.lineStyle(2, 0x6c6c8a, 1)
    g.strokeRect(-hw, -hh, this.cw, this.ch)
    g.lineStyle(3, 0xffffff, 0.35)
    g.lineBetween(-hw, 0, hw, 0)
    g.lineStyle(1, 0xffffff, 0.2)
    g.lineBetween(0, -hh, 0, hh)
  }

  private drawBodies(s: GameStateWire): void {
    const bx = s.ball.x * COURT_W
    const by = s.ball.y * COURT_L
    const bp = this.worldToLayer(bx, by)
    this.ballG.setPosition(bp.x, bp.y)

    const lp = this.worldToLayer(s.players.left.x * COURT_W, s.players.left.y * COURT_L)
    const rp = this.worldToLayer(s.players.right.x * COURT_W, s.players.right.y * COURT_L)
    this.leftG.setPosition(lp.x, lp.y)
    this.rightG.setPosition(rp.x, rp.y)
  }

  shutdown(): void {
    this.sidesFlipTween?.stop()
    this.sidesFlipTween = null
    const sock = this.opts?.socket
    if (sock) {
      sock.off('game:state', this.onState)
      sock.off('game:indicator:show', this.onIndicator)
      sock.off('game:point', this.onPoint)
      sock.off('game:event', this.onEvent)
      sock.off('game:sides:change', this.onSides)
      sock.off('game:over', this.onOver)
      sock.off('game:pause', this.onGamePause)
      sock.off('game:resume', this.onGameResume)
      sock.off('bot:pause:state', this.onBotPauseState)
    }
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener)
      this.visibilityListener = undefined
    }
    this.hidePauseOverlay()
    if (!this.opts.spectator) {
      this.input.off('pointerdown', this.onPointerDown, this)
    }
    this.scale.off('resize', this.onResize, this)
    this.hideIndicator()
    this.indicatorEl?.remove()
    this.indicatorEl = null
    this.indicatorBar = null
  }
}

export function createMatchGame(parent: string, opts: MatchSceneOpts): Phaser.Game {
  matchBootstrap = opts
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1a1a2e',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: Math.max(320, window.innerWidth),
      height: Math.max(480, window.innerHeight),
    },
    scene: MatchScene,
    audio: { noAudio: true },
  })
}

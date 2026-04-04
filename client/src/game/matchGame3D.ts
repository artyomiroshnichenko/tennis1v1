import * as THREE from 'three'
import type { Socket } from 'socket.io-client'
import {
  ALLEY_W,
  COURT_L,
  COURT_W_DOUBLE,
  COURT_W_SINGLE,
  NET_Y,
  SERVICE_DEPTH,
} from './courtConstants'
import type { GameStateWire, Score, Side } from './gameTypes'
import { matchAudio } from './matchAudio'

export type MatchSceneOpts = {
  socket: Socket
  mySide: Side
  nickname: string
  spectator?: boolean
  isBot?: boolean
  opponentName?: string
  onMatchEnd: (payload: {
    winner: Side | null
    reason: string
    sets: [number, number][]
    technical?: boolean
    doubleDefeat?: boolean
  }) => void
}

/** Совместимость с destroyGame(): ожидается scene.getScene('match').shutdown() и destroy(). */
export type MatchGameHandle = {
  destroy: (force?: boolean) => void
  scene: { getScene: (name: string) => { shutdown?: () => void } | undefined }
}

const SIDES_FLIP_MS = 2600

function reasonUsesEventSoundOnly(reason: string): boolean {
  return (
    reason.includes('Аут') ||
    reason.includes('Сетка') ||
    reason.includes('сетк') ||
    reason.includes('Двойн') ||
    reason.includes('ошибк')
  )
}

/** Нормализованные координаты сервера → метры одиночки. */
function normToMeters(px: number, py: number): { xM: number; yM: number } {
  return { xM: px * COURT_W_SINGLE, yM: py * COURT_L }
}

/** Метры (x по одиночке, y вдоль корта) → мир Three.js (Y вверх, корт в XZ). */
function courtToWorld(xM: number, yM: number): THREE.Vector3 {
  const x = xM + ALLEY_W - COURT_W_DOUBLE / 2
  const z = yM - COURT_L / 2
  return new THREE.Vector3(x, 0, z)
}

function buildCourtLinePositions(): Float32Array {
  const hw = COURT_W_DOUBLE / 2
  const hh = COURT_L / 2
  const sw = COURT_W_SINGLE / 2
  const zsN = NET_Y - SERVICE_DEPTH - COURT_L / 2
  const zsS = NET_Y + SERVICE_DEPTH - COURT_L / 2
  const tick = Math.max(0.25, COURT_L * 0.04)
  const pairs: number[] = []
  const L = (ax: number, az: number, bx: number, bz: number): void => {
    pairs.push(ax, 0.03, az, bx, 0.03, bz)
  }
  L(-hw, -hh, hw, -hh)
  L(-hw, hh, hw, hh)
  L(-hw, -hh, -hw, hh)
  L(hw, -hh, hw, hh)
  L(-sw, -hh, -sw, hh)
  L(sw, -hh, sw, hh)
  L(-sw, -hh, sw, -hh)
  L(-sw, hh, sw, hh)
  L(-hw, 0, hw, 0)
  L(0, zsN, 0, zsS)
  L(-sw, zsN, sw, zsN)
  L(-sw, zsS, sw, zsS)
  L(0, -hh, 0, -hh + tick)
  L(0, hh, 0, hh - tick)
  return new Float32Array(pairs)
}

function makePlayerFigure(shirtHex: number, shortsHex: number): THREE.Group {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8c4a8, roughness: 0.6 })
  const shirt = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.55 })
  const shorts = new THREE.MeshStandardMaterial({ color: shortsHex, roughness: 0.65 })
  const shoe = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 })
  const racketDark = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.35 })
  const strings = new THREE.MeshStandardMaterial({ color: 0xd8e8f8, roughness: 0.25, metalness: 0.15 })

  const legGeo = new THREE.CapsuleGeometry(0.11, 0.38, 4, 8)
  const legL = new THREE.Mesh(legGeo, shoe)
  legL.position.set(-0.14, 0.32, 0.06)
  legL.rotation.x = 0.12
  const legR = new THREE.Mesh(legGeo, shoe)
  legR.position.set(0.14, 0.32, 0.06)
  legR.rotation.x = 0.12
  g.add(legL, legR)

  const hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.22, 4, 8), shorts)
  hip.position.y = 0.62
  g.add(hip)

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 10), shirt)
  torso.position.y = 1.05
  g.add(torso)

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.35, 4, 6), skin)
  armL.position.set(-0.38, 1.12, 0.05)
  armL.rotation.z = 0.35
  g.add(armL)

  const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.32, 4, 6), skin)
  armR.position.set(0.42, 1.08, 0.08)
  armR.rotation.z = -0.5
  g.add(armR)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), skin)
  head.position.y = 1.52
  g.add(head)

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 8), racketDark)
  handle.rotation.z = Math.PI / 2
  handle.position.set(0.62, 1.05, 0.12)
  g.add(handle)

  const headR = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.38), strings)
  headR.position.set(0.88, 1.12, 0.12)
  g.add(headR)
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.4), racketDark)
  rim.position.set(0.88, 1.12, 0.12)
  g.add(rim)

  g.position.y = 0
  return g
}

export class MatchGame3D {
  private readonly opts: MatchSceneOpts
  private readonly parentId: string
  private root!: HTMLDivElement
  private canvas!: HTMLCanvasElement
  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private courtRoot!: THREE.Group
  private ball!: THREE.Mesh
  private ballGlow!: THREE.Mesh
  private ballVelHelper!: THREE.ArrowHelper
  private plLeft!: THREE.Group
  private plRight!: THREE.Group
  private raycaster = new THREE.Raycaster()
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private tmpV = new THREE.Vector3()
  private lastState: GameStateWire | null = null
  private raf = 0
  private moveEmitAcc = 0
  private pointerTarget: { xM: number; yM: number } | null = null
  private keysDown = new Set<string>()
  private indicatorMode: 'direction' | 'power' | null = null
  private indicatorStart = 0
  private indicatorEl: HTMLDivElement | null = null
  private indicatorBar: HTMLDivElement | null = null
  private indicatorArrowWrap: HTMLDivElement | null = null
  private indicatorArrowEl: HTMLDivElement | null = null
  private pauseOverlayEl: HTMLDivElement | null = null
  private pauseCountdownTimer: ReturnType<typeof setInterval> | null = null
  private visibilityListener?: () => void
  private resizeListener = (): void => this.onResize()
  private boundKeyDown = (e: KeyboardEvent): void => this.onKeyDown(e)
  private boundKeyUp = (e: KeyboardEvent): void => this.onKeyUp(e)
  private boundPointerDown = (e: PointerEvent): void => this.onPointerDown(e)

  private scoreEl!: HTMLDivElement
  private serveEl!: HTMLDivElement
  private toastEl!: HTMLDivElement
  private sidesDim!: HTMLDivElement
  private sidesBanner!: HTMLDivElement
  private flipT0 = 0
  private flipping = false

  private scalePx = 1

  constructor(parentId: string, opts: MatchSceneOpts) {
    this.parentId = parentId
    this.opts = opts
  }

  mount(): MatchGameHandle {
    const host = document.getElementById(this.parentId)
    if (!host) throw new Error(`MatchGame3D: нет #${this.parentId}`)

    this.root = document.createElement('div')
    this.root.style.cssText =
      'position:relative;width:100%;height:100%;min-height:420px;overflow:hidden;background:linear-gradient(180deg,#3d6b45 0%,#2a4a32 40%,#1a2e20 100%)'
    host.innerHTML = ''
    host.appendChild(this.root)

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'
    this.root.appendChild(this.canvas)

    this.initHud()
    this.layoutHud()
    this.initThree()
    this.bindSocket()
    this.bindInput()
    window.addEventListener('resize', this.resizeListener)
    this.onResize()
    this.loop()

    const self = this
    return {
      destroy: () => self.destroy(),
      scene: {
        getScene(name: string) {
          return name === 'match' ? { shutdown: () => self.destroy() } : undefined
        },
      },
    }
  }

  private initHud(): void {
    const mk = (css: string): HTMLDivElement => {
      const el = document.createElement('div')
      el.style.cssText = css
      this.root.appendChild(el)
      return el
    }
    this.scoreEl = mk(
      'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:12;color:#f0f0f8;font:16px system-ui,sans-serif;text-shadow:0 1px 3px #000;text-align:center;pointer-events:none',
    )
    this.serveEl = mk(
      'position:absolute;left:50%;top:36px;transform:translateX(-50%);z-index:12;color:#a8c8ff;font:14px system-ui,sans-serif;pointer-events:none',
    )
    this.toastEl = mk(
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-120px);z-index:14;display:none;color:#fff;font:20px system-ui,sans-serif;background:#00000088;padding:10px 14px;border-radius:10px;pointer-events:none',
    )
    if (this.opts.opponentName) {
      mk(
        'position:absolute;left:50%;top:58px;transform:translateX(-50%);z-index:12;color:#9c9cb8;font:13px system-ui,sans-serif;pointer-events:none',
      ).textContent = `vs ${this.opts.opponentName}`
    }
    this.sidesDim = mk(
      'position:absolute;inset:0;z-index:18;display:none;background:#0a0a1470;pointer-events:none',
    )
    this.sidesBanner = mk(
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:20;display:none;color:#f0f0f8;font:26px system-ui,sans-serif;font-weight:600;pointer-events:none',
    )
  }

  private layoutHud(): void {
    const w = this.root.clientWidth
    const h = this.root.clientHeight
    const pad = 10
    const topHud = 52
    const innerW = w - pad * 2
    const innerH = h - pad * 2 - topHud
    this.scalePx = Math.min(innerW / COURT_W_DOUBLE, innerH / COURT_L) * 1.02
  }

  private initThree(): void {
    const w = Math.max(320, this.root.clientWidth)
    const h = Math.max(400, this.root.clientHeight)

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x3a6042)

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 220)
    this.camera.position.set(0, 16, 18)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const sun = new THREE.DirectionalLight(0xfff5e6, 1.05)
    sun.position.set(-8, 28, 12)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 2
    sun.shadow.camera.far = 60
    sun.shadow.camera.left = -18
    sun.shadow.camera.right = 18
    sun.shadow.camera.top = 18
    sun.shadow.camera.bottom = -18
    this.scene.add(sun)

    this.courtRoot = new THREE.Group()
    this.scene.add(this.courtRoot)

    const green = new THREE.MeshStandardMaterial({ color: 0x5aaf5a, roughness: 0.85 })
    const blue = new THREE.MeshStandardMaterial({ color: 0x1a6cb5, roughness: 0.72 })

    const gPlane = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W_DOUBLE, COURT_L), green)
    gPlane.rotation.x = -Math.PI / 2
    gPlane.receiveShadow = true
    this.courtRoot.add(gPlane)

    const bPlane = new THREE.Mesh(new THREE.PlaneGeometry(COURT_W_SINGLE, COURT_L), blue)
    bPlane.rotation.x = -Math.PI / 2
    bPlane.position.y = 0.008
    bPlane.receiveShadow = true
    this.courtRoot.add(bPlane)

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(buildCourtLinePositions(), 3))
    const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xf8f8ff }))
    this.courtRoot.add(lines)

    const netMat = new THREE.MeshStandardMaterial({
      color: 0xf0f0f8,
      transparent: true,
      opacity: 0.92,
      roughness: 0.35,
    })
    const net = new THREE.Mesh(new THREE.BoxGeometry(COURT_W_DOUBLE, 0.95, 0.07), netMat)
    net.position.set(0, 0.48, 0)
    net.castShadow = true
    this.courtRoot.add(net)
    const netMesh = new THREE.Mesh(
      new THREE.BoxGeometry(COURT_W_DOUBLE * 0.98, 0.55, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x3a3a44, transparent: true, opacity: 0.35 }),
    )
    netMesh.position.set(0, 0.52, 0)
    this.courtRoot.add(netMesh)

    this.plLeft = makePlayerFigure(0xffd54a, 0x1a1a22)
    this.plRight = makePlayerFigure(0xe53935, 0x1a1a22)
    this.plLeft.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    this.plRight.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) o.castShadow = true
    })
    this.courtRoot.add(this.plLeft, this.plRight)

    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xfff59d,
      roughness: 0.35,
      emissive: 0x443a10,
      emissiveIntensity: 0.15,
    })
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), ballMat)
    this.ball.castShadow = true
    this.courtRoot.add(this.ball)

    this.ballGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.12 }),
    )
    this.courtRoot.add(this.ballGlow)

    this.ballVelHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0.9, 0),
      2.2,
      0x7fffab,
      0.35,
      0.22,
    )
    this.ballVelHelper.visible = false
    this.courtRoot.add(this.ballVelHelper)
  }

  private bindSocket(): void {
    const sock = this.opts.socket
    sock.on('game:state', this.onState)
    sock.on('game:indicator:show', this.onIndicator)
    sock.on('game:point', this.onPoint)
    sock.on('game:event', this.onEvent)
    sock.on('game:sides:change', this.onSides)
    sock.on('game:over', this.onOver)
    sock.on('game:pause', this.onGamePause)
    sock.on('game:resume', this.onGameResume)
    sock.on('game:resync', this.onGameResync)
    sock.on('chat:reaction', this.onChatReaction)
    sock.on('bot:pause:state', this.onBotPauseState)

    if (this.opts.isBot) {
      this.visibilityListener = () => {
        sock.emit('bot:visibility', { hidden: document.visibilityState === 'hidden' })
      }
      document.addEventListener('visibilitychange', this.visibilityListener)
    }
  }

  private readonly onState = (s: GameStateWire): void => {
    this.lastState = s
  }

  private readonly onIndicator = (p: { phase: 'direction' | 'power' }): void => {
    if (this.opts.spectator) return
    this.showIndicator(p.phase)
  }

  private readonly onPoint = (p: { reason: string; score: Score }): void => {
    const before = this.lastState?.score
    if (before && p.score.sets.length > before.sets.length) matchAudio.setWon()
    else if (
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
    this.startSidesFlip()
  }

  private readonly onOver = (p: {
    winner: Side | null
    reason: string
    sets?: [number, number][]
    technical?: boolean
    doubleDefeat?: boolean
  }): void => {
    this.hidePauseOverlay()
    if (!this.opts.spectator && p.winner !== null) {
      if (p.winner === this.opts.mySide) matchAudio.matchWin()
      else matchAudio.matchLose()
    }
    this.hideIndicator()
    this.opts.onMatchEnd({
      winner: p.winner,
      reason: p.reason,
      sets: p.sets ?? [],
      technical: p.technical,
      doubleDefeat: p.doubleDefeat,
    })
  }

  private readonly onGameResync = (p: { initialState: GameStateWire }): void => {
    this.lastState = p.initialState
  }

  private readonly onGamePause = (p: {
    reason?: string
    seconds?: number
    source?: string
    deadlineTs?: number
  }): void => {
    if (p.reason === 'resume_countdown' && p.deadlineTs !== undefined) {
      this.showPauseOverlay('Скоро продолжение матча…', undefined, p.deadlineTs)
      return
    }
    if (p.reason === 'disconnect') {
      if (p.source === 'tab' && p.seconds !== undefined) {
        this.showPauseOverlay('Вкладка неактивна — вернитесь, иначе засчитается поражение.', p.seconds)
        return
      }
      if (p.source === 'peer') {
        const msg =
          p.seconds !== undefined && p.seconds > 90
            ? 'Соперник отключился. Ожидание до 3 минут; можно писать в чат. Если не вернётся — техническая победа.'
            : 'Соперник отключился. Идёт отсчёт до завершения матча.'
        if (p.deadlineTs !== undefined) this.showPauseOverlay(msg, undefined, p.deadlineTs)
        else if (p.seconds !== undefined) this.showPauseOverlay(msg, p.seconds)
      }
    }
  }

  private readonly onGameResume = (): void => {
    this.hidePauseOverlay()
  }

  private readonly onBotPauseState = (p: { paused: boolean }): void => {
    if (p.paused) this.showPauseOverlay('Пауза. Нажмите P, чтобы продолжить.')
    else this.hidePauseOverlay()
  }

  private readonly onChatReaction = (p: { type: string; anchor?: string }): void => {
    const map: Record<string, string> = {
      heart: '❤️',
      fire: '🔥',
      cry: '😭',
      halo: '😇',
      angry: '😡',
    }
    const emoji = map[p.type] ?? '💬'
    const a = p.anchor ?? 'spectator'
    const s = this.lastState
    let world: THREE.Vector3
    if (a === 'left' && s) {
      const m = normToMeters(s.players.left.x, s.players.left.y)
      world = courtToWorld(m.xM, m.yM).setY(1.6)
    } else if (a === 'right' && s) {
      const m = normToMeters(s.players.right.x, s.players.right.y)
      world = courtToWorld(m.xM, m.yM).setY(1.6)
    } else if (s) {
      const m = normToMeters(s.ball.x, s.ball.y)
      world = courtToWorld(m.xM, m.yM).setY(1.2)
    } else {
      world = new THREE.Vector3(0, 1.5, 0)
    }
    const scr = this.worldToScreen(world)
    const el = document.createElement('div')
    el.textContent = emoji
    el.style.cssText = `position:absolute;left:${scr.x}px;top:${scr.y}px;transform:translate(-50%,-100%);font-size:42px;z-index:30;pointer-events:none;transition:opacity 2.5s ease-out,transform 2.5s ease-out`
    this.root.appendChild(el)
    requestAnimationFrame(() => {
      el.style.opacity = '0'
      el.style.transform = 'translate(-50%,-160%)'
    })
    setTimeout(() => el.remove(), 2600)
    switch (p.type) {
      case 'heart':
        matchAudio.reactionHeart()
        break
      case 'fire':
        matchAudio.reactionFire()
        break
      case 'cry':
        matchAudio.reactionCry()
        break
      case 'halo':
        matchAudio.reactionHalo()
        break
      case 'angry':
        matchAudio.reactionAngry()
        break
      default:
        matchAudio.point()
    }
  }

  private worldToScreen(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    const x = rect.left + ((p.x + 1) / 2) * rect.width
    const y = rect.top + ((-p.y + 1) / 2) * rect.height
    return { x, y }
  }

  private startSidesFlip(): void {
    this.flipping = true
    this.flipT0 = performance.now()
    this.sidesDim.style.display = 'block'
    this.sidesBanner.style.display = 'block'
    this.sidesBanner.style.opacity = '1'
  }

  private updateSidesFlip(): void {
    if (!this.flipping) return
    const t = (performance.now() - this.flipT0) / SIDES_FLIP_MS
    if (t >= 1) {
      this.flipping = false
      this.courtRoot.rotation.y = 0
      this.sidesDim.style.display = 'none'
      this.sidesBanner.style.opacity = '0'
      this.sidesBanner.style.display = 'none'
      return
    }
    this.courtRoot.rotation.y = t * Math.PI
  }

  private bindInput(): void {
    window.addEventListener('keydown', this.boundKeyDown)
    window.addEventListener('keyup', this.boundKeyUp)
    if (!this.opts.spectator) {
      this.canvas.addEventListener('pointerdown', this.boundPointerDown)
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.keysDown.add(e.code)
    if (e.code === 'Space') e.preventDefault()
    if (e.code === 'Space' && this.indicatorMode) {
      this.commitIndicator()
    }
    if (this.opts.isBot && e.code === 'KeyP') {
      this.opts.socket.emit('bot:toggle_pause')
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code)
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.opts.spectator) return
    if (this.indicatorMode) {
      this.commitIndicator()
      return
    }
    const m = this.pointerToCourtMeters(e.clientX, e.clientY)
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

  private pointerToCourtMeters(clientX: number, clientY: number): { xM: number; yM: number } | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    if (!this.raycaster.ray.intersectPlane(this.plane, this.tmpV)) return null
    const xFromDoubleLeft = this.tmpV.x + COURT_W_DOUBLE / 2
    const xM = Math.max(0, Math.min(COURT_W_SINGLE, xFromDoubleLeft - ALLEY_W))
    const yM = this.tmpV.z + COURT_L / 2
    if (yM < 0 || yM > COURT_L || xFromDoubleLeft < 0 || xFromDoubleLeft > COURT_W_DOUBLE) return null
    return { xM, yM }
  }

  private selfMeters(): { x: number; y: number } | null {
    const s = this.lastState
    if (!s) return null
    const p = this.opts.mySide === 'left' ? s.players.left : s.players.right
    return { x: p.x * COURT_W_SINGLE, y: p.y * COURT_L }
  }

  private onResize(): void {
    this.layoutHud()
    const w = Math.max(320, this.root.clientWidth)
    const h = Math.max(400, this.root.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = 1 / 60
    const s = this.lastState
    if (s) {
      this.syncScene(s)
      this.scoreEl.textContent = this.formatScore(s)
      const srv = this.opts.spectator
        ? s.serving === 'left'
          ? 'Подача слева'
          : 'Подача справа'
        : s.serving === this.opts.mySide
          ? 'Ваша подача'
          : 'Подача соперника'
      this.serveEl.textContent = s.phase === 'serving' || s.phase === 'playing' ? srv : ''
    }
    this.updateSidesFlip()
    this.updateCamera()
    this.updateIndicatorAnimation()
    this.emitMovement(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private syncScene(s: GameStateWire): void {
    const bl = normToMeters(s.ball.x, s.ball.y)
    const bw = courtToWorld(bl.xM, bl.yM)
    this.ball.position.set(bw.x, 0.88, bw.z)
    this.ballGlow.position.copy(this.ball.position)

    const vxn = s.ball.vx * COURT_W_SINGLE
    const vzn = s.ball.vy * COURT_L
    const spd = Math.hypot(vxn, vzn)
    if (spd > 0.04) {
      const dir = new THREE.Vector3(vxn, 0, vzn).normalize()
      this.ballVelHelper.visible = true
      this.ballVelHelper.position.set(bw.x, 1.05, bw.z)
      this.ballVelHelper.setDirection(dir)
      const len = Math.min(4.5, 1.2 + spd * 8)
      this.ballVelHelper.setLength(len, len * 0.12, len * 0.08)
    } else {
      this.ballVelHelper.visible = false
    }

    const l = normToMeters(s.players.left.x, s.players.left.y)
    const r = normToMeters(s.players.right.x, s.players.right.y)
    const lw = courtToWorld(l.xM, l.yM)
    const rw = courtToWorld(r.xM, r.yM)
    this.plLeft.position.set(lw.x, 0, lw.z)
    this.plRight.position.set(rw.x, 0, rw.z)

    const faceBall = (grp: THREE.Group, px: number, pz: number): void => {
      const dx = bw.x - px
      const dz = bw.z - pz
      grp.rotation.y = Math.atan2(dx, dz)
    }
    faceBall(this.plLeft, lw.x, lw.z)
    faceBall(this.plRight, rw.x, rw.z)
  }

  private updateCamera(): void {
    const s = this.lastState
    if (!s) return
    const self = normToMeters(
      this.opts.mySide === 'left' ? s.players.left.x : s.players.right.x,
      this.opts.mySide === 'left' ? s.players.left.y : s.players.right.y,
    )
    const sw = courtToWorld(self.xM, self.yM)
    const bl = normToMeters(s.ball.x, s.ball.y)
    const bw = courtToWorld(bl.xM, bl.yM)
    const behind = this.opts.mySide === 'left' ? 13 : -13
    const cx = sw.x + 1.2
    const cz = sw.z + behind
    this.camera.position.lerp(new THREE.Vector3(cx, 13.5, cz), 0.08)
    const lookY = 2.2
    const tx = bw.x * 0.35 + sw.x * 0.65
    const tz = bw.z * 0.35 + sw.z * 0.65
    this.camera.lookAt(tx, lookY, tz)
  }

  private updateIndicatorAnimation(): void {
    if (!this.indicatorMode || !this.indicatorEl) return
    const t = (performance.now() - this.indicatorStart) / 1000
    const v = 0.5 + 0.5 * Math.sin(t * (this.indicatorMode === 'power' ? 2.8 : 2.2))
    if (this.indicatorMode === 'power' && this.indicatorBar) {
      this.indicatorBar.style.width = `${Math.round(v * 100)}%`
    }
    if (this.indicatorMode === 'direction' && this.indicatorArrowEl) {
      const deg = -88 + v * 176
      this.indicatorArrowEl.style.transform = `rotate(${deg}deg)`
    }
  }

  private emitMovement(dt: number): void {
    if (this.opts.spectator) return
    let dx = 0
    let dy = 0
    const kd = this.keysDown
    let vr = 0
    let vu = 0
    if (kd.has('KeyA') || kd.has('ArrowLeft')) vr -= 1
    if (kd.has('KeyD') || kd.has('ArrowRight')) vr += 1
    if (kd.has('KeyW') || kd.has('ArrowUp')) vu += 1
    if (kd.has('KeyS') || kd.has('ArrowDown')) vu -= 1
    dx = vr
    dy = this.opts.mySide === 'left' ? -vu : vu
    const l = Math.hypot(dx, dy)
    if (l > 1e-6) {
      dx /= l
      dy /= l
    }
    const s = this.lastState
    if (this.pointerTarget && s && (s.phase === 'playing' || s.phase === 'serving')) {
      const self = this.opts.mySide === 'left' ? s.players.left : s.players.right
      const xM = self.x * COURT_W_SINGLE
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

  private flashToast(msg: string): void {
    this.toastEl.textContent = msg
    this.toastEl.style.display = 'block'
    window.setTimeout(() => {
      this.toastEl.style.display = 'none'
    }, 1400)
  }

  private showIndicator(phase: 'direction' | 'power'): void {
    this.indicatorMode = phase
    this.indicatorStart = performance.now()
    if (!this.indicatorEl) {
      const root = document.createElement('div')
      root.className = 'match-indicator'
      root.style.cssText =
        'position:absolute;left:50%;bottom:10%;transform:translateX(-50%);width:min(360px,88vw);text-align:center;z-index:24;'
      const label = document.createElement('div')
      label.style.cssText = 'color:#e8e8f0;font:14px system-ui;margin-bottom:8px;'
      label.id = 'match-ind-label'
      const bar = document.createElement('div')
      bar.id = 'match-ind-bar'
      bar.style.cssText =
        'position:relative;height:14px;border-radius:7px;background:#2a2a3e;overflow:hidden;border:1px solid #4a4a60;'
      const fill = document.createElement('div')
      fill.style.cssText =
        'position:absolute;top:0;left:0;bottom:0;width:50%;background:linear-gradient(90deg,#4a90d9,#f5d547);'
      bar.appendChild(fill)
      const arrowWrap = document.createElement('div')
      arrowWrap.style.cssText =
        'display:none;height:56px;margin:10px auto 0;text-align:center;'
      const arrow = document.createElement('div')
      arrow.textContent = '↑'
      arrow.style.cssText =
        'display:inline-block;font-size:44px;line-height:56px;color:#b8f0c8;text-shadow:0 0 14px rgba(120,255,180,0.55);transform-origin:50% 65%;'
      arrowWrap.appendChild(arrow)
      const hint = document.createElement('div')
      hint.style.cssText = 'color:#8888a0;font:12px system-ui;margin-top:8px;'
      hint.textContent = 'Пробел / тап — зафиксировать'
      root.append(label, bar, arrowWrap, hint)
      this.root.appendChild(root)
      this.indicatorEl = root
      this.indicatorBar = fill
      this.indicatorArrowWrap = arrowWrap
      this.indicatorArrowEl = arrow
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
    const barEl = this.indicatorEl.querySelector('#match-ind-bar') as HTMLElement | null
    if (phase === 'power') {
      if (barEl) barEl.style.display = 'block'
      if (this.indicatorArrowWrap) this.indicatorArrowWrap.style.display = 'none'
    } else {
      if (barEl) barEl.style.display = 'none'
      if (this.indicatorArrowWrap) this.indicatorArrowWrap.style.display = 'block'
    }
    this.indicatorEl.style.display = 'block'
  }

  private hideIndicator(): void {
    this.indicatorMode = null
    if (this.indicatorEl) this.indicatorEl.style.display = 'none'
  }

  private commitIndicator(): void {
    if (!this.indicatorMode || !this.indicatorEl) return
    const t = (performance.now() - this.indicatorStart) / 1000
    const v = 0.5 + 0.5 * Math.sin(t * (this.indicatorMode === 'power' ? 2.8 : 2.2))
    matchAudio.racketHit()
    this.opts.socket.emit('game:input:indicator', {
      phase: this.indicatorMode,
      value: Math.max(0, Math.min(1, v)),
    })
    this.hideIndicator()
  }

  private showPauseOverlay(mainMsg: string, countdownFrom?: number, deadlineTs?: number): void {
    this.hidePauseOverlay()
    const el = document.createElement('div')
    el.className = 'match-pause-overlay'
    el.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(10,10,22,0.9);z-index:40;color:#e8e8f0;font:15px system-ui,sans-serif;text-align:center;padding:20px;white-space:pre-line'
    const t = document.createElement('div')
    el.appendChild(t)
    this.root.appendChild(el)
    this.pauseOverlayEl = el
    if (deadlineTs !== undefined) {
      const tick = (): void => {
        const left = Math.max(0, Math.ceil((deadlineTs - Date.now()) / 1000))
        t.textContent = `${mainMsg}\nОсталось: ${left} с`
        if (left <= 0 && this.pauseCountdownTimer) {
          clearInterval(this.pauseCountdownTimer)
          this.pauseCountdownTimer = null
        }
      }
      tick()
      this.pauseCountdownTimer = setInterval(tick, 250)
    } else if (countdownFrom !== undefined && countdownFrom > 0) {
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

  destroy(): void {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resizeListener)
    window.removeEventListener('keydown', this.boundKeyDown)
    window.removeEventListener('keyup', this.boundKeyUp)
    this.canvas.removeEventListener('pointerdown', this.boundPointerDown)
    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener)
      this.visibilityListener = undefined
    }
    const sock = this.opts.socket
    sock.off('game:state', this.onState)
    sock.off('game:indicator:show', this.onIndicator)
    sock.off('game:point', this.onPoint)
    sock.off('game:event', this.onEvent)
    sock.off('game:sides:change', this.onSides)
    sock.off('game:over', this.onOver)
    sock.off('game:pause', this.onGamePause)
    sock.off('game:resume', this.onGameResume)
    sock.off('game:resync', this.onGameResync)
    sock.off('chat:reaction', this.onChatReaction)
    sock.off('bot:pause:state', this.onBotPauseState)
    this.hidePauseOverlay()
    this.hideIndicator()
    this.indicatorEl?.remove()
    this.indicatorEl = null
    this.indicatorBar = null
    this.indicatorArrowWrap = null
    this.indicatorArrowEl = null
    this.renderer.dispose()
    this.root.remove()
  }
}

export function createMatchGame(parentId: string, opts: MatchSceneOpts): MatchGameHandle {
  const g = new MatchGame3D(parentId, opts)
  return g.mount()
}

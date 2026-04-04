import {
  BALL_PHYSICS_SUBSTEPS,
  BALL_REST_Z,
  COURT_L,
  COURT_W,
  GRAVITY,
  HIT_INDICATOR_TIMEOUT_MS,
  HIT_REACH,
  NET_CLEAR_Z,
  NET_Y,
  PLAYER_SPEED,
  AIM_DIRECTION_SPAN_RAD,
  POINT_PAUSE_MS,
  RALLY_HORIZ_SPEED_MAX,
  RALLY_HORIZ_SPEED_MIN,
  SERVE_AIM_TIMEOUT_MS,
  SERVE_HORIZ_SPEED_MAX,
  SERVE_HORIZ_SPEED_MIN,
  SERVE_POWER_TIMEOUT_MS,
  SERVE_READY_TIMEOUT_MS,
  SIDES_CHANGE_MS,
  TICK_DT,
} from './constants'
import {
  baselinePosition,
  clampPlayerToHalf,
  halfForY,
  inDiagonalServiceTarget,
  inSinglesCourt,
} from './geometry'
import {
  addPoint,
  createInitialScore,
  currentServer,
  type ScoreInternal,
  toWireScore,
} from './scoring'
import type { GameEventType, GamePhase, GameStateWire, PlayerState, Side } from './types'

function other(s: Side): Side {
  return s === 'left' ? 'right' : 'left'
}

function len(x: number, y: number): number {
  return Math.hypot(x, y)
}

function norm(x: number, y: number): { x: number; y: number } {
  const l = len(x, y)
  if (l < 1e-6) return { x: 0, y: 1 }
  return { x: x / l, y: y / l }
}

type Phase =
  | { k: 'point_pause'; until: number }
  | { k: 'sides_change'; until: number }
  | { k: 'serve_ready'; server: Side; until: number }
  | { k: 'serve_power'; server: Side; until: number }
  | { k: 'serve_aim'; server: Side; power: number; until: number }
  | { k: 'rally' }
  | { k: 'hit_dir'; for: Side; until: number }
  | { k: 'hit_pwr'; for: Side; dir: number; until: number }
  | { k: 'done'; winner: Side }

export type PendingEmit = {
  point?: { scorer: Side; reason: string }
  event?: GameEventType
  servePrompt?: Side
  indicator?: { phase: 'direction' | 'power'; forSide: Side }
  sidesChange?: boolean
  pause?: {
    reason: 'disconnect' | 'resume_countdown'
    seconds: number
    source?: 'peer' | 'tab'
    /** Эпоха ms — для синхронизации длинной паузы на клиенте */
    deadlineTs?: number
  }
  over?: { winner: Side; reason: string }
}

export class MatchEngine {
  readonly score: ScoreInternal
  phase: Phase = { k: 'serve_ready', server: 'left', until: 0 }
  ball = { x: COURT_W / 2, y: NET_Y, z: 1.2, vx: 0, vy: 0, vz: 0 }
  pl = { x: COURT_W / 2, y: COURT_L - 1.1, dx: 0, dy: 0 }
  pr = { x: COURT_W / 2, y: 1.1, dx: 0, dy: 0 }
  plState: PlayerState = 'idle'
  prState: PlayerState = 'idle'
  lastHit: Side | null = null
  bouncesL = 0
  bouncesR = 0
  serveFaults = 0
  rallySpeedCap = RALLY_HORIZ_SPEED_MAX
  lastStrongHitBy: Side | null = null
  timeMs = 0
  private serveInPlay = false
  private pendingSidesChange = false

  constructor(firstServer: Side) {
    this.score = createInitialScore(firstServer)
    const lbp = baselinePosition('left')
    const rbp = baselinePosition('right')
    this.pl.x = lbp.x
    this.pl.y = lbp.y
    this.pr.x = rbp.x
    this.pr.y = rbp.y
    this.pl.dx = 0
    this.pl.dy = 0
    this.pr.dx = 0
    this.pr.dy = 0
    const bp = baselinePosition(firstServer)
    this.ball.x = bp.x
    this.ball.y = firstServer === 'left' ? bp.y - 0.4 : bp.y + 0.4
    this.ball.z = 1.1
    this.phase = {
      k: 'serve_ready',
      server: firstServer,
      until: this.timeMs + SERVE_READY_TIMEOUT_MS,
    }
  }

  private playerBody(side: Side): { x: number; y: number; dx: number; dy: number } {
    return side === 'left' ? this.pl : this.pr
  }

  private setPlayerState(side: Side, st: PlayerState): void {
    if (side === 'left') this.plState = st
    else this.prState = st
  }

  private resetBallAtServer(server: Side): void {
    const b = baselinePosition(server)
    this.ball.x = b.x
    this.ball.y = server === 'left' ? b.y - 0.35 : b.y + 0.35
    this.ball.z = 1.05
    this.ball.vx = 0
    this.ball.vy = 0
    this.ball.vz = 0
    this.lastHit = null
    this.bouncesL = 0
    this.bouncesR = 0
    this.serveInPlay = false
  }

  beginAfterPause(): PendingEmit {
    const srv = currentServer(this.score)
    this.resetBallAtServer(srv)
    const lbp = baselinePosition('left')
    const rbp = baselinePosition('right')
    this.pl.x = lbp.x
    this.pl.y = lbp.y
    this.pr.x = rbp.x
    this.pr.y = rbp.y
    this.pl.dx = 0
    this.pl.dy = 0
    this.pr.dx = 0
    this.pr.dy = 0
    this.phase = { k: 'serve_ready', server: srv, until: this.timeMs + SERVE_READY_TIMEOUT_MS }
    this.plState = 'idle'
    this.prState = 'idle'
    return {
      servePrompt: srv,
    }
  }

  private toWireBall(): { x: number; y: number; z: number; vx: number; vy: number } {
    return {
      x: this.ball.x / COURT_W,
      y: this.ball.y / COURT_L,
      z: this.ball.z,
      vx: this.ball.vx / COURT_W,
      vy: this.ball.vy / COURT_L,
    }
  }

  getWirePhase(): GamePhase {
    if (this.phase.k === 'done') return 'over'
    if (this.phase.k === 'point_pause' || this.phase.k === 'sides_change') return 'pause'
    if (this.phase.k === 'serve_ready') return 'serve_prep'
    if (this.phase.k === 'serve_power' || this.phase.k === 'serve_aim') return 'serving'
    return 'playing'
  }

  /** Сторона и фаза индикатора, если движок ждёт ввод подачи/удара. */
  getIndicatorNeed(): { side: Side; phase: 'direction' | 'power' } | null {
    const ph = this.phase
    if (ph.k === 'serve_ready') return null
    if (ph.k === 'serve_power') return { side: ph.server, phase: 'power' }
    if (ph.k === 'serve_aim') return { side: ph.server, phase: 'direction' }
    if (ph.k === 'hit_dir') return { side: ph.for, phase: 'direction' }
    if (ph.k === 'hit_pwr') return { side: ph.for, phase: 'power' }
    return null
  }

  /** Аннулировать текущую фазу подачи/удара без изменения счёта (эпик 08). */
  abortStrikeIfPending(): PendingEmit[] {
    const ph = this.phase
    const strikePending =
      ph.k === 'serve_ready' ||
      ph.k === 'serve_power' ||
      ph.k === 'serve_aim' ||
      ph.k === 'hit_dir' ||
      ph.k === 'hit_pwr'
    if (!strikePending) return []
    const srv = currentServer(this.score)
    this.resetBallAtServer(srv)
    this.phase = { k: 'serve_ready', server: srv, until: this.timeMs + SERVE_READY_TIMEOUT_MS }
    this.plState = 'idle'
    this.prState = 'idle'
    this.serveInPlay = false
    return [{ servePrompt: srv }]
  }

  /** Подтверждение готовности к подаче (тап / ввод клиента). */
  confirmServeReady(side: Side): PendingEmit | null {
    if (this.phase.k !== 'serve_ready' || side !== this.phase.server) return null
    this.phase = { k: 'serve_power', server: side, until: this.timeMs + SERVE_POWER_TIMEOUT_MS }
    return { indicator: { phase: 'power', forSide: side } }
  }

  getWireState(): GameStateWire {
    return {
      ball: this.toWireBall(),
      players: {
        left: {
          x: this.pl.x / COURT_W,
          y: this.pl.y / COURT_L,
          state: this.plState,
        },
        right: {
          x: this.pr.x / COURT_W,
          y: this.pr.y / COURT_L,
          state: this.prState,
        },
      },
      score: toWireScore(this.score),
      serving: currentServer(this.score),
      phase: this.getWirePhase(),
    }
  }

  setMove(side: Side, dx: number, dy: number): void {
    const ph = this.phase
    if (ph.k === 'point_pause' || ph.k === 'sides_change' || ph.k === 'done') return
    if (ph.k === 'hit_dir' || ph.k === 'hit_pwr') return

    /** До удара по мячу никто не двигается (ни подающий с клавишами, ни приёмник/бот к мячу). */
    if (ph.k === 'serve_ready' || ph.k === 'serve_power' || ph.k === 'serve_aim') {
      return
    }

    if (ph.k === 'rally') {
      const p = this.playerBody(side)
      p.dx = dx
      p.dy = dy
      if (Math.abs(dx) + Math.abs(dy) > 0.01) this.setPlayerState(side, 'running')
      else this.setPlayerState(side, 'idle')
    }
  }

  private startHitSequence(forSide: Side): PendingEmit {
    this.setPlayerState(forSide, 'hitting')
    const p = this.playerBody(forSide)
    p.dx = 0
    p.dy = 0
    this.phase = { k: 'hit_dir', for: forSide, until: this.timeMs + HIT_INDICATOR_TIMEOUT_MS }
    return { indicator: { phase: 'direction', forSide: forSide } }
  }

  private canReachBall(side: Side): boolean {
    const p = this.playerBody(side)
    const d = len(this.ball.x - p.x, this.ball.y - p.y)
    return d <= HIT_REACH && this.ball.z < 2.4
  }

  applyIndicator(side: Side, phase: 'direction' | 'power', value: number): PendingEmit | null {
    const v = clamp01(value)
    if (this.phase.k === 'serve_power' && phase === 'power' && side === this.phase.server) {
      this.phase = {
        k: 'serve_aim',
        server: side,
        power: v,
        until: this.timeMs + SERVE_AIM_TIMEOUT_MS,
      }
      this.setPlayerState(side, 'serving')
      return { indicator: { phase: 'direction', forSide: side } }
    }
    if (this.phase.k === 'serve_aim' && phase === 'direction' && side === this.phase.server) {
      this.fireServe(this.phase.server, this.phase.power, v)
      return null
    }
    if (this.phase.k === 'hit_dir' && phase === 'direction' && side === this.phase.for) {
      this.phase = { k: 'hit_pwr', for: side, dir: v, until: this.timeMs + HIT_INDICATOR_TIMEOUT_MS }
      return { indicator: { phase: 'power', forSide: side } }
    }
    if (this.phase.k === 'hit_pwr' && phase === 'power' && side === this.phase.for) {
      this.fireGroundstroke(side, this.phase.dir, v)
      return null
    }
    return null
  }

  private fireServe(server: Side, power: number, accuracyRaw: number): void {
    const horiz =
      SERVE_HORIZ_SPEED_MIN +
      (SERVE_HORIZ_SPEED_MAX - SERVE_HORIZ_SPEED_MIN) * (0.35 + 0.65 * clamp01(power))
    const ang = (accuracyRaw - 0.5) * AIM_DIRECTION_SPAN_RAD
    const toward = server === 'left' ? -1 : 1
    const sdx = Math.sin(ang)
    const sdy = Math.cos(ang) * toward
    const d = norm(sdx, sdy)
    this.ball.vx = d.x * horiz
    this.ball.vy = d.y * horiz
    this.ball.vz = 4.0 + 4.2 * clamp01(power)
    this.lastHit = server
    this.serveInPlay = true
    this.setPlayerState(server, 'idle')
    this.phase = { k: 'rally' }
  }

  private fireGroundstroke(side: Side, dirT: number, power: number): void {
    const speedBase =
      RALLY_HORIZ_SPEED_MIN +
      (RALLY_HORIZ_SPEED_MAX - RALLY_HORIZ_SPEED_MIN) * (0.25 + 0.75 * clamp01(power))
    let cap = this.rallySpeedCap
    if (this.lastStrongHitBy && this.lastStrongHitBy !== side) {
      const prevStrong = this.lastStrongHitBy === 'left' ? this.pl : this.pr
      void prevStrong
    }
    const ang = (dirT - 0.5) * AIM_DIRECTION_SPAN_RAD
    const toward = side === 'left' ? -1 : 1
    const dx = Math.sin(ang)
    const dy = Math.cos(ang) * toward
    const d = norm(dx, dy)
    let speed = speedBase
    if (this.lastStrongHitBy === other(side) && power > 0.82) {
      speed = Math.min(cap + 2.5, speed + 4)
      this.rallySpeedCap = Math.min(RALLY_HORIZ_SPEED_MAX, this.rallySpeedCap + 0.8)
    } else {
      this.rallySpeedCap = RALLY_HORIZ_SPEED_MAX
    }
    if (power > 0.88) this.lastStrongHitBy = side
    else this.lastStrongHitBy = null
    this.ball.vx = d.x * speed
    this.ball.vy = d.y * speed
    this.ball.vz = 3.2 + 5.5 * clamp01(power)
    this.lastHit = side
    this.bouncesL = 0
    this.bouncesR = 0
    this.setPlayerState(side, 'idle')
    this.phase = { k: 'rally' }
  }

  step(dt: number): PendingEmit[] {
    const out: PendingEmit[] = []
    this.timeMs += dt * 1000

    if (this.phase.k === 'point_pause') {
      if (this.timeMs >= this.phase.until) {
        if (this.pendingSidesChange) {
          this.pendingSidesChange = false
          this.phase = { k: 'sides_change', until: this.timeMs + SIDES_CHANGE_MS }
          out.push({ sidesChange: true })
        } else {
          const next = this.beginAfterPause()
          out.push(next)
        }
      }
      this.freezePlayersNoIntegrate()
      return out
    }
    if (this.phase.k === 'sides_change') {
      if (this.timeMs >= this.phase.until) {
        const n = this.beginAfterPause()
        out.push(n)
      }
      this.freezePlayersNoIntegrate()
      return out
    }
    if (this.phase.k === 'done') {
      this.freezePlayersNoIntegrate()
      return out
    }

    if (this.phase.k === 'serve_ready' && this.timeMs >= this.phase.until) {
      const srv = this.phase.server
      this.phase = { k: 'serve_power', server: srv, until: this.timeMs + SERVE_POWER_TIMEOUT_MS }
      out.push({ indicator: { phase: 'power', forSide: srv } })
    }

    if (this.phase.k === 'serve_power' && this.timeMs >= this.phase.until) {
      out.push(...this.handleServeTimeout(this.phase.server))
      return out
    }
    if (this.phase.k === 'serve_aim' && this.timeMs >= this.phase.until) {
      out.push(...this.handleServeTimeout(this.phase.server))
      return out
    }
    if (this.phase.k === 'hit_dir' && this.timeMs >= this.phase.until) {
      out.push(...this.awardPoint(other(this.phase.for), 'Индикатор удара'))
      return out
    }
    if (this.phase.k === 'hit_pwr' && this.timeMs >= this.phase.until) {
      out.push(...this.awardPoint(other(this.phase.for), 'Индикатор удара'))
      return out
    }

    this.integratePlayers(dt)
    if (this.phase.k === 'rally') {
      const ev = this.integrateBall(dt)
      if (ev) out.push(ev)
      const hitCheck = this.tryAutoHitWindow()
      if (hitCheck) out.push(hitCheck)
    } else if (this.phase.k === 'serve_power' || this.phase.k === 'serve_aim') {
      const srv = this.phase.server
      if (this.canReachBall(srv) && this.phase.k === 'serve_aim') {
        /* ждём ввод */
      }
      if (this.canReachBall(srv) && this.phase.k === 'serve_power') {
        /* мяч у сервера — только индикаторы */
      }
    }

    return out
  }

  private tryAutoHitWindow(): PendingEmit | null {
    if (this.phase.k !== 'rally') return null
    /** Пока подача «в полёте» до валидного отскока — приёмник не бьёт (как в теннисе). */
    if (this.serveInPlay) return null
    for (const side of ['left', 'right'] as const) {
      if (this.lastHit === side) continue
      if (!this.canReachBall(side)) continue
      const p = this.playerBody(side)
      const toward =
        side === 'left'
          ? this.ball.y <= p.y + 0.2 && this.ball.vy >= -1.5
          : this.ball.y >= p.y - 0.2 && this.ball.vy <= 1.5
      if (!toward && len(this.ball.vx, this.ball.vy) > 3) continue
      if (len(p.dx, p.dy) > 0.05) continue
      p.dx = 0
      p.dy = 0
      return this.startHitSequence(side)
    }
    return null
  }

  /** Между очками и после матча — не интегрировать движение (иначе «ездим» на старом вводе к сетке). */
  private freezePlayersNoIntegrate(): void {
    this.pl.dx = 0
    this.pl.dy = 0
    this.pr.dx = 0
    this.pr.dy = 0
  }

  private integratePlayers(dt: number): void {
    const ph = this.phase
    const serveSnap =
      ph.k === 'serve_ready' || ph.k === 'serve_power' || ph.k === 'serve_aim'

    if (serveSnap) {
      for (const s of ['left', 'right'] as const) {
        const p = this.playerBody(s)
        const b = baselinePosition(s)
        p.x = b.x
        p.y = b.y
        p.dx = 0
        p.dy = 0
      }
      return
    }

    for (const s of ['left', 'right'] as const) {
      const st = s === 'left' ? this.plState : this.prState
      if (st === 'hitting' || st === 'serving') continue
      const p = this.playerBody(s)
      const n = norm(p.dx, p.dy)
      const sp = PLAYER_SPEED * dt
      const nx = p.x + n.x * sp
      const ny = p.y + n.y * sp
      const c = clampPlayerToHalf(nx, ny, s)
      p.x = c.x
      p.y = c.y
    }
  }

  private crossedNet(prevY: number, y: number): boolean {
    return (prevY < NET_Y && y >= NET_Y) || (prevY > NET_Y && y <= NET_Y)
  }

  private integrateBall(dt: number): PendingEmit | null {
    const h = dt / BALL_PHYSICS_SUBSTEPS
    for (let i = 0; i < BALL_PHYSICS_SUBSTEPS; i++) {
      const ev = this.integrateBallSubstep(h)
      if (ev) return ev
    }
    return null
  }

  private integrateBallSubstep(h: number): PendingEmit | null {
    const py = this.ball.y
    const pz = this.ball.z
    const pvy = this.ball.vy
    const pvz = this.ball.vz

    this.ball.vz -= GRAVITY * h
    this.ball.x += this.ball.vx * h
    this.ball.y += this.ball.vy * h
    this.ball.z += this.ball.vz * h

    if (this.crossedNet(py, this.ball.y)) {
      const dy = this.ball.y - py
      let zCross = pz
      if (Math.abs(dy) > 1e-8 && Math.abs(pvy) > 1e-8) {
        const t0 = (NET_Y - py) / pvy
        if (t0 > 0 && t0 <= h) {
          zCross = pz + pvz * t0
        }
      }
      if (zCross < NET_CLEAR_Z) {
        if (this.serveInPlay) {
          const srv = currentServer(this.score)
          this.emitLetReset()
          return { event: 'let', servePrompt: srv }
        }
        return this.awardPointFromNetOrOut('net')
      }
    }

    if (this.ball.z <= BALL_REST_Z) {
      this.ball.z = BALL_REST_Z
      if (Math.abs(this.ball.vz) > 0.35) this.ball.vz = -this.ball.vz * 0.58
      else this.ball.vz = 0
      return this.onGroundContact()
    }

    if (!inSinglesCourt(this.ball.x, this.ball.y)) {
      if (this.ball.z > 0.12) return null
      return this.onOut()
    }

    return null
  }

  private emitLetReset(): void {
    const srv = currentServer(this.score)
    this.resetBallAtServer(srv)
    this.phase = { k: 'serve_ready', server: srv, until: this.timeMs + SERVE_READY_TIMEOUT_MS }
  }

  private onGroundContact(): PendingEmit | null {
    const h = halfForY(this.ball.y)
    if (h === 'left') {
      this.bouncesL++
      if (this.bouncesL >= 2) return this.awardPoint('right', 'Два отскока')[0]!
    } else {
      this.bouncesR++
      if (this.bouncesR >= 2) return this.awardPoint('left', 'Два отскока')[0]!
    }

    if (this.serveInPlay) {
      const srv = currentServer(this.score)
      const ok = inDiagonalServiceTarget(srv, srv === 'left' ? this.pl.x : this.pr.x, this.ball.x, this.ball.y)
      if (!ok) return this.handleServeFault('out')
      this.serveInPlay = false
      const ret = other(srv)
      if (this.bouncesR + this.bouncesL === 1 && h === other(srv)) {
        /* приём */
      }
    }

    if (!inSinglesCourt(this.ball.x, this.ball.y)) return this.onOut()
    return null
  }

  private onOut(): PendingEmit {
    if (this.serveInPlay) return this.handleServeFault('out')
    return this.awardPoint(other(this.lastHit ?? 'left'), 'Аут')[0]!
  }

  private awardPointFromNetOrOut(kind: 'net'): PendingEmit {
    if (this.serveInPlay) return this.handleServeFault(kind)
    const winner = other(this.lastHit ?? 'left')
    const em = this.awardPoint(winner, kind === 'net' ? 'Сетка' : 'Аут')
    return em[0]!
  }

  private handleServeFault(reason: 'out' | 'net'): PendingEmit {
    this.serveFaults++
    if (this.serveFaults >= 2) {
      const ret = other(currentServer(this.score))
      return this.awardPoint(ret, 'Двойная ошибка')[0]!
    }
    const srv = currentServer(this.score)
    this.resetBallAtServer(srv)
    this.phase = { k: 'serve_ready', server: srv, until: this.timeMs + SERVE_READY_TIMEOUT_MS }
    return { event: reason === 'net' ? 'net' : 'fault', servePrompt: srv }
  }

  private handleServeTimeout(server: Side): PendingEmit[] {
    this.serveFaults++
    if (this.serveFaults >= 2) {
      return this.awardPoint(other(server), 'Таймаут подачи')
    }
    this.resetBallAtServer(server)
    this.phase = { k: 'serve_ready', server, until: this.timeMs + SERVE_READY_TIMEOUT_MS }
    return [{ event: 'fault', servePrompt: server }]
  }

  awardPoint(winner: Side, reason: string): PendingEmit[] {
    const res = addPoint(this.score, winner)
    const out: PendingEmit[] = [{ point: { scorer: winner, reason }, event: mapReasonToEvent(reason) }]
    this.serveFaults = 0
    this.serveInPlay = false
    this.freezePlayersNoIntegrate()
    this.lastStrongHitBy = null
    this.rallySpeedCap = RALLY_HORIZ_SPEED_MAX
    if (res.matchOver) {
      this.phase = { k: 'done', winner: winner }
      out.push({ over: { winner, reason: 'Матч' } })
      return out
    }
    this.phase = { k: 'point_pause', until: this.timeMs + POINT_PAUSE_MS }
    if (res.sidesChangeAfter) {
      this.pendingSidesChange = true
    }
    return out
  }

  forfeitWinner(winner: Side): PendingEmit[] {
    this.phase = { k: 'done', winner }
    return [{ over: { winner, reason: 'Соперник вышел' } }]
  }

  forfeitWithReason(winner: Side, reason: string): PendingEmit[] {
    this.phase = { k: 'done', winner }
    return [{ over: { winner, reason } }]
  }
}

function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.min(1, t))
}

function mapReasonToEvent(reason: string): GameEventType | undefined {
  if (reason.includes('Аут')) return 'out'
  if (reason.includes('Сетка') || reason.includes('сетк')) return 'net'
  if (reason.includes('Эйс')) return 'ace'
  if (reason.includes('лет')) return 'let'
  if (reason.includes('ошибк')) return 'fault'
  return undefined
}

export function fixedTickSteps(accum: number, dt = TICK_DT): { steps: number; rem: number } {
  accum += dt
  let steps = 0
  while (accum >= TICK_DT && steps < 5) {
    accum -= TICK_DT
    steps++
  }
  return { steps, rem: accum }
}

import type { Server } from 'socket.io'
import { TICK_DT } from './constants'
import { MatchEngine } from './matchEngine'
import type { PendingEmit } from './matchEngine'
import { currentServer } from './scoring'
import type { GameStateWire, Side } from './types'

export type MatchOverPayload = {
  winner: Side | null
  sets: [number, number][]
  reason: string
  technical: boolean
  doubleDefeat?: boolean
}

const DISCONNECT_GRACE_MS = 180_000
const RESUME_AFTER_REJOIN_MS = 10_000
const PAUSE_RESYNC_MS = 60_000

export class MatchController {
  private readonly engine: MatchEngine
  private readonly socketToSide = new Map<string, Side>()
  private timer: ReturnType<typeof setInterval> | null = null
  private accum = 0
  private stopped = false
  private disconnectFrozen = false
  private disconnectedSince: Partial<Record<Side, number>> = {}
  private sideConnected: Record<Side, boolean> = { left: true, right: true }
  private graceTicker: ReturnType<typeof setInterval> | null = null
  private resumeTimer: ReturnType<typeof setTimeout> | null = null
  private lastPauseResyncMs = 0
  private lastTickMs: number | null = null

  constructor(
    private readonly io: Server,
    private readonly roomId: string,
    hostSocketId: string,
    guestSocketId: string,
    private readonly lifecycle: {
      onStopped: () => void
      onOver?: (p: MatchOverPayload) => void
    },
  ) {
    this.socketToSide.set(hostSocketId, 'left')
    this.socketToSide.set(guestSocketId, 'right')
    const firstServer: Side = Math.random() < 0.5 ? 'left' : 'right'
    this.engine = new MatchEngine(firstServer)

    const roomName = `room:${this.roomId}`
    const initial: GameStateWire = this.engine.getWireState()
    this.io.to(roomName).emit('game:start', { initialState: initial })
    const srv = currentServer(this.engine.score)
    this.io.to(roomName).emit('game:serve:prompt', { side: srv })
    this.io.to(roomName).emit('game:indicator:show', { phase: 'power' })

    this.lastTickMs = performance.now()
    this.timer = setInterval(() => this.tickReal(), 1000 / 60)
  }

  private roomName(): string {
    return `room:${this.roomId}`
  }

  private clearGraceTicker(): void {
    if (this.graceTicker) {
      clearInterval(this.graceTicker)
      this.graceTicker = null
    }
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer)
      this.resumeTimer = null
    }
  }

  private startGraceTickerIfNeeded(): void {
    if (this.graceTicker) return
    this.graceTicker = setInterval(() => this.onGraceTick(), 1000)
  }

  private minGraceDeadline(): number | null {
    let min: number | null = null
    for (const side of (['left', 'right'] as Side[])) {
      if (this.sideConnected[side]) continue
      const t0 = this.disconnectedSince[side]
      if (t0 === undefined) continue
      const d = t0 + DISCONNECT_GRACE_MS
      if (min === null || d < min) min = d
    }
    return min
  }

  private onGraceTick(): void {
    if (this.stopped) return
    const now = Date.now()
    if (this.disconnectFrozen && now - this.lastPauseResyncMs >= PAUSE_RESYNC_MS) {
      const deadline = this.minGraceDeadline()
      if (deadline !== null) {
        const sec = Math.max(0, Math.ceil((deadline - now) / 1000))
        this.io.to(this.roomName()).emit('game:pause', {
          reason: 'disconnect',
          seconds: sec,
          source: 'peer',
          deadlineTs: deadline,
        })
        this.lastPauseResyncMs = now
      }
    }
    this.checkGraceExpiry()
  }

  private checkGraceExpiry(): void {
    if (this.stopped) return
    const now = Date.now()
    for (const side of (['left', 'right'] as Side[])) {
      const t0 = this.disconnectedSince[side]
      if (t0 === undefined || this.sideConnected[side]) continue
      if (now < t0 + DISCONNECT_GRACE_MS) continue
      const other: Side = side === 'left' ? 'right' : 'left'
      if (!this.sideConnected[other]) {
        this.applyDoubleDefeat()
      } else {
        this.applyTimeoutForfeit(other)
      }
      return
    }
  }

  private applyTimeoutForfeit(winner: Side): void {
    if (this.stopped) return
    this.clearGraceTicker()
    this.clearResumeTimer()
    this.disconnectFrozen = false
    this.disconnectedSince = {}
    const outs = this.engine.forfeitWinner(winner)
    for (const e of outs) {
      if (e.over) e.over.reason = 'Соперник не вернулся'
      this.applyEmit(e)
    }
  }

  private applyDoubleDefeat(): void {
    if (this.stopped) return
    this.clearGraceTicker()
    this.clearResumeTimer()
    this.disconnectFrozen = false
    this.disconnectedSince = {}
    const sets: [number, number][] = this.engine.score.completedSets.map((g) => [g[0]!, g[1]!])
    this.lifecycle.onOver?.({
      winner: null,
      sets,
      reason: 'Оба игрока не вернулись',
      technical: true,
      doubleDefeat: true,
    })
    this.io.to(this.roomName()).emit('game:over', {
      winner: null,
      sets,
      reason: 'Оба игрока не вернулись',
      technical: true,
      doubleDefeat: true,
    })
    this.stop()
  }

  /** Обрыв TCP: пауза до 3 мин или переподключения. */
  onTransportDisconnect(disconnectedSocketId: string): void {
    const side = this.socketToSide.get(disconnectedSocketId)
    if (!side || this.stopped) return
    this.socketToSide.delete(disconnectedSocketId)
    this.sideConnected[side] = false
    if (this.disconnectedSince[side] === undefined) {
      this.disconnectedSince[side] = Date.now()
    }
    this.disconnectFrozen = true
    this.clearResumeTimer()
    const t0 = this.disconnectedSince[side]!
    const deadline = t0 + DISCONNECT_GRACE_MS
    this.lastPauseResyncMs = Date.now()
    this.io.to(this.roomName()).emit('game:pause', {
      reason: 'disconnect',
      seconds: Math.ceil(DISCONNECT_GRACE_MS / 1000),
      source: 'peer',
      deadlineTs: deadline,
    })
    this.startGraceTickerIfNeeded()
  }

  rebindSocket(socketId: string, side: Side): void {
    for (const [sid, sd] of [...this.socketToSide.entries()]) {
      if (sd === side) this.socketToSide.delete(sid)
    }
    this.socketToSide.set(socketId, side)
    this.sideConnected[side] = true
    delete this.disconnectedSince[side]
  }

  /** После `rebindSocket`: аннуляция удара и при необходимости отсчёт 10 с. */
  onSideReconnected(side: Side): void {
    if (this.stopped) return
    void side
    this.clearResumeTimer()
    const pending = this.engine.abortStrikeIfPending()
    for (const e of pending) this.applyEmit(e)
    const allIn = this.sideConnected.left && this.sideConnected.right
    if (allIn) {
      this.scheduleResumeCountdown()
    }
  }

  private scheduleResumeCountdown(): void {
    this.clearGraceTicker()
    this.disconnectFrozen = true
    const sec = Math.ceil(RESUME_AFTER_REJOIN_MS / 1000)
    const deadline = Date.now() + RESUME_AFTER_REJOIN_MS
    this.io.to(this.roomName()).emit('game:pause', {
      reason: 'resume_countdown',
      seconds: sec,
      source: 'peer',
      deadlineTs: deadline,
    })
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null
      this.disconnectFrozen = false
      this.clearGraceTicker()
      this.io.to(this.roomName()).emit('game:resume', {})
    }, RESUME_AFTER_REJOIN_MS)
  }

  /** Явный выход из комнаты во время матча — немедленное поражение. */
  intentionalForfeit(socketId: string): void {
    const side = this.socketToSide.get(socketId)
    if (!side || this.stopped) return
    this.clearGraceTicker()
    this.clearResumeTimer()
    this.disconnectFrozen = false
    this.disconnectedSince = {}
    const w: Side = side === 'left' ? 'right' : 'left'
    const outs = this.engine.forfeitWinner(w)
    for (const e of outs) this.applyEmit(e)
  }

  private tickReal(): void {
    const now = performance.now()
    if (this.lastTickMs === null) this.lastTickMs = now
    if (this.disconnectFrozen) {
      this.lastTickMs = now
      this.accum = 0
      this.io.to(this.roomName()).emit('game:state', this.engine.getWireState())
      return
    }
    let dt = (now - this.lastTickMs) / 1000
    this.lastTickMs = now
    dt = Math.min(dt, 0.1)
    this.accum += dt
    while (this.accum >= TICK_DT) {
      this.accum -= TICK_DT
      const outs = this.engine.step(TICK_DT)
      for (const e of outs) this.applyEmit(e)
      if (this.stopped) return
    }
    this.io.to(this.roomName()).emit('game:state', this.engine.getWireState())
  }

  private applyEmit(e: PendingEmit): void {
    const rn = this.roomName()
    if (e.point) {
      this.io.to(rn).emit('game:point', {
        scorer: e.point.scorer,
        score: this.engine.getWireState().score,
        reason: e.point.reason,
      })
    }
    if (e.event) {
      this.io.to(rn).emit('game:event', { type: e.event })
    }
    if (e.servePrompt !== undefined) {
      this.io.to(rn).emit('game:serve:prompt', { side: e.servePrompt })
    }
    if (e.indicator) {
      this.io.to(rn).emit('game:indicator:show', e.indicator)
    }
    if (e.sidesChange) {
      this.io.to(rn).emit('game:sides:change')
    }
    if (e.pause) {
      this.io.to(rn).emit('game:pause', e.pause)
    }
    if (e.over) {
      const sets: [number, number][] = this.engine.score.completedSets.map((g) => [g[0]!, g[1]!])
      const technical =
        e.over.reason === 'Соперник вышел' ||
        e.over.reason === 'Соперник не вернулся' ||
        e.over.reason === 'Оба игрока не вернулись'
      this.lifecycle.onOver?.({
        winner: e.over.winner,
        sets,
        reason: e.over.reason,
        technical,
      })
      this.io.to(rn).emit('game:over', {
        winner: e.over.winner,
        sets,
        reason: e.over.reason,
        technical,
      })
      this.stop()
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.clearGraceTicker()
    this.clearResumeTimer()
    this.disconnectFrozen = false
    this.disconnectedSince = {}
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.lifecycle.onStopped()
  }

  getWireState(): GameStateWire {
    return this.engine.getWireState()
  }

  setMove(socketId: string, dx: number, dy: number): void {
    const side = this.socketToSide.get(socketId)
    if (!side || this.stopped) return
    const nx = Math.max(-1, Math.min(1, dx))
    const ny = Math.max(-1, Math.min(1, dy))
    this.engine.setMove(side, nx, ny)
  }

  applyIndicator(socketId: string, phase: 'direction' | 'power', value: number): void {
    const side = this.socketToSide.get(socketId)
    if (!side || this.stopped) return
    const pending = this.engine.applyIndicator(side, phase, value)
    if (pending) this.applyEmit(pending)
  }
}

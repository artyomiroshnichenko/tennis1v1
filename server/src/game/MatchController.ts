import type { Server } from 'socket.io'
import { TICK_DT } from './constants'
import { MatchEngine } from './matchEngine'
import type { PendingEmit } from './matchEngine'
import { currentServer } from './scoring'
import type { GameStateWire, Side } from './types'

export class MatchController {
  private readonly engine: MatchEngine
  private readonly socketToSide = new Map<string, Side>()
  private timer: ReturnType<typeof setInterval> | null = null
  private accum = 0
  private stopped = false

  constructor(
    private readonly io: Server,
    private readonly roomId: string,
    hostSocketId: string,
    guestSocketId: string,
    private readonly onStopped: () => void,
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

  private tickReal(): void {
    const now = performance.now()
    if (this.lastTickMs === null) this.lastTickMs = now
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

  private lastTickMs: number | null = null

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
      const sets: [number, number][] = this.engine.score.completedSets.map(
        (g) => [g[0]!, g[1]!],
      )
      this.io.to(rn).emit('game:over', {
        winner: e.over.winner,
        sets,
        reason: e.over.reason,
      })
      this.stop()
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.onStopped()
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

  forfeitDisconnected(socketId: string): void {
    const side = this.socketToSide.get(socketId)
    if (!side || this.stopped) return
    const w: Side = side === 'left' ? 'right' : 'left'
    const outs = this.engine.forfeitWinner(w)
    for (const e of outs) this.applyEmit(e)
  }
}

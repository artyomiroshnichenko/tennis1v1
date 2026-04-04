import type { Server } from 'socket.io'
import { NET_Y, TICK_DT } from './constants'
import { botDifficultyCfg, type BotDifficulty } from './botNames'
import { MatchEngine } from './matchEngine'
import type { PendingEmit } from './matchEngine'
import type { MatchOverPayload } from './MatchController'
import { persistBotMatch } from '../match/persistBotMatch'
import { currentServer } from './scoring'
import type { GameStateWire, Side } from './types'

function len(x: number, y: number): number {
  return Math.hypot(x, y)
}

export class BotMatchController {
  private readonly engine: MatchEngine
  private readonly cfg: ReturnType<typeof botDifficultyCfg>
  private readonly humanSide: Side = 'left'
  private readonly botSide: Side = 'right'
  private timer: ReturnType<typeof setInterval> | null = null
  private accum = 0
  private stopped = false
  private lastTickMs: number | null = null
  private manualPaused = false
  private visibilityDeadlineMs: number | null = null

  constructor(
    private readonly io: Server,
    private readonly socketId: string,
    difficulty: BotDifficulty,
    readonly botName: string,
    private readonly auth: { typ: 'guest' | 'user'; sub: string },
    private readonly lifecycle: {
      onStopped: () => void
      onOver?: (p: MatchOverPayload) => void
    },
  ) {
    this.cfg = botDifficultyCfg(difficulty)
    const firstServer: Side = Math.random() < 0.5 ? 'left' : 'right'
    this.engine = new MatchEngine(firstServer)

    this.toPlayer('bot:started', { initialState: this.engine.getWireState(), botName: this.botName })
    this.toPlayer('game:start', { initialState: this.engine.getWireState(), botName: this.botName })
    const srv = currentServer(this.engine.score)
    this.toPlayer('game:serve:prompt', { side: srv })
    const need = this.engine.getIndicatorNeed()
    if (need) {
      if (need.side === this.botSide) this.flushBotIndicators()
      else this.toPlayer('game:indicator:show', { phase: need.phase, forSide: need.side })
    }

    this.lastTickMs = performance.now()
    this.timer = setInterval(() => this.tickReal(), 1000 / 60)
  }

  private toPlayer(ev: string, payload: object): void {
    this.io.to(this.socketId).emit(ev, payload)
  }

  private botRandomIndicatorValue(): number {
    const spread = this.cfg.spread
    const center = 0.42 + Math.random() * 0.16
    return Math.max(0, Math.min(1, center + (Math.random() - 0.5) * spread))
  }

  private flushBotIndicators(): void {
    for (let guard = 0; guard < 40; guard++) {
      if (this.stopped) break
      const need = this.engine.getIndicatorNeed()
      if (!need || need.side !== this.botSide) break
      const v = this.botRandomIndicatorValue()
      const pending = this.engine.applyIndicator(this.botSide, need.phase, v)
      if (pending) this.applyEmit(pending)
    }
  }

  private applyEmit(e: PendingEmit): void {
    if (e.point) {
      this.toPlayer('game:point', {
        scorer: e.point.scorer,
        score: this.engine.getWireState().score,
        reason: e.point.reason,
      })
    }
    if (e.event) {
      this.toPlayer('game:event', { type: e.event })
    }
    if (e.servePrompt !== undefined) {
      this.toPlayer('game:serve:prompt', { side: e.servePrompt })
    }
    if (e.indicator) {
      const need = this.engine.getIndicatorNeed()
      if (need?.side === this.botSide) {
        this.flushBotIndicators()
      } else {
        this.toPlayer('game:indicator:show', e.indicator)
      }
    }
    if (e.sidesChange) {
      this.toPlayer('game:sides:change', {})
    }
    if (e.pause) {
      this.toPlayer('game:pause', e.pause)
    }
    if (e.over) {
      const sets: [number, number][] = this.engine.score.completedSets.map((g) => [g[0]!, g[1]!])
      const technical =
        e.over.reason === 'Соперник вышел' ||
        e.over.reason.includes('вкладк') ||
        e.over.reason.includes('неактивн')
      this.lifecycle.onOver?.({
        winner: e.over.winner,
        sets,
        reason: e.over.reason,
        technical,
      })
      this.toPlayer('game:over', {
        winner: e.over.winner,
        sets,
        reason: e.over.reason,
        technical,
      })
      if (this.auth.typ === 'user') {
        void persistBotMatch({
          humanUserId: this.auth.sub,
          botName: this.botName,
          winnerSide: e.over.winner,
          sets,
          reason: e.over.reason,
        })
      }
      this.stop()
    }
  }

  private tickReal(): void {
    if (this.stopped) return

    if (this.visibilityDeadlineMs !== null && Date.now() >= this.visibilityDeadlineMs) {
      this.visibilityDeadlineMs = null
      this.toPlayer('game:resume', {})
      const outs = this.engine.forfeitWithReason(
        this.botSide,
        'Поражение: неактивная вкладка (15 с)',
      )
      for (const x of outs) this.applyEmit(x)
      return
    }

    if (this.manualPaused) {
      this.toPlayer('game:state', this.engine.getWireState())
      return
    }

    const now = performance.now()
    if (this.lastTickMs === null) this.lastTickMs = now
    let dt = (now - this.lastTickMs) / 1000
    this.lastTickMs = now
    dt = Math.min(dt, 0.1)
    this.accum += dt
    while (this.accum >= TICK_DT) {
      this.accum -= TICK_DT
      this.autoBotServeReady()
      this.updateBotMove(TICK_DT)
      const outs = this.engine.step(TICK_DT)
      for (const e of outs) this.applyEmit(e)
      if (this.stopped) return
    }
    this.toPlayer('game:state', this.engine.getWireState())
  }

  private autoBotServeReady(): void {
    const ph = this.engine.phase
    if (ph.k === 'serve_ready' && ph.server === this.botSide) {
      const pending = this.engine.confirmServeReady(this.botSide)
      if (pending) this.applyEmit(pending)
    }
  }

  private updateBotMove(_dt: number): void {
    if (this.engine.getWirePhase() === 'over') return
    const bx = this.engine.ball.x
    const by = this.engine.ball.y
    const p = this.botSide === 'left' ? this.engine.pl : this.engine.pr
    const dx = bx - p.x
    const dy = by - p.y
    const l = len(dx, dy) || 1
    let nx = dx / l
    let ny = dy / l
    if (this.botSide === 'right' && by < NET_Y - 0.35 && this.engine.getWirePhase() === 'playing') {
      nx *= 0.55
      ny *= 0.55
    }
    const n = this.cfg.moveNoise
    nx += (Math.random() - 0.5) * n * 2
    ny += (Math.random() - 0.5) * n * 2
    const ll = len(nx, ny) || 1
    this.engine.setMove(this.botSide, nx / ll, ny / ll)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.lifecycle.onStopped()
  }

  setManualPaused(paused: boolean): boolean {
    this.manualPaused = paused
    return this.manualPaused
  }

  getManualPaused(): boolean {
    return this.manualPaused
  }

  setVisibilityHidden(hidden: boolean): void {
    if (hidden) {
      this.visibilityDeadlineMs = Date.now() + 15_000
      this.toPlayer('game:pause', { reason: 'disconnect', seconds: 15, source: 'tab' })
    } else {
      this.visibilityDeadlineMs = null
      this.toPlayer('game:resume', {})
    }
  }

  getWireState(): GameStateWire {
    return this.engine.getWireState()
  }

  setMove(dx: number, dy: number): void {
    if (this.stopped) return
    const nx = Math.max(-1, Math.min(1, dx))
    const ny = Math.max(-1, Math.min(1, dy))
    this.engine.setMove(this.humanSide, nx, ny)
  }

  applyIndicator(phase: 'direction' | 'power', value: number): void {
    if (this.stopped) return
    const pending = this.engine.applyIndicator(this.humanSide, phase, value)
    if (pending) this.applyEmit(pending)
  }

  confirmServeReady(): void {
    if (this.stopped) return
    const pending = this.engine.confirmServeReady(this.humanSide)
    if (pending) this.applyEmit(pending)
  }

  /** Игрок закрыл соединение — победа бота, причина как при выходе соперника. */
  forfeitOnDisconnect(): void {
    if (this.stopped) return
    const outs = this.engine.forfeitWinner(this.botSide)
    for (const e of outs) this.applyEmit(e)
  }
}

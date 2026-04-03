/** Соответствует docs/dev/API.md (серверные payload). */

export type Side = 'left' | 'right'

export type PlayerState = 'idle' | 'running' | 'hitting' | 'serving'

export type GamePhase = 'serving' | 'playing' | 'pause' | 'over'

export type Score = {
  sets: [number, number][]
  games: [number, number]
  points: [number, number]
  isTiebreak: boolean
  isDeuce: boolean
  advantage: Side | null
}

export type GameStateWire = {
  ball: { x: number; y: number; vx: number; vy: number }
  players: {
    left: { x: number; y: number; state: PlayerState }
    right: { x: number; y: number; state: PlayerState }
  }
  score: Score
  serving: Side
  phase: GamePhase
}

/** Соответствует docs/dev/API.md (GameState, Score, PlayerState). */

export type Side = 'left' | 'right'

export type PlayerState = 'idle' | 'running' | 'hitting' | 'serving'

export type GamePhase = 'serve_prep' | 'serving' | 'playing' | 'pause' | 'over'

export type Score = {
  sets: [number, number][]
  games: [number, number]
  points: [number, number]
  isTiebreak: boolean
  isDeuce: boolean
  advantage: Side | null
}

export type GameStateWire = {
  /** x,y,vx,vy — нормализованы по COURT_W / COURT_L; z — высота центра мяча, метры. */
  ball: { x: number; y: number; z: number; vx: number; vy: number }
  players: {
    left: { x: number; y: number; state: PlayerState }
    right: { x: number; y: number; state: PlayerState }
  }
  score: Score
  serving: Side
  phase: GamePhase
}

export type GameEventType = 'ace' | 'net' | 'out' | 'let' | 'fault'

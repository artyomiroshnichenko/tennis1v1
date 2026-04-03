import type { Score, Side } from './types'

export type ScoreInternal = {
  completedSets: [number, number][]
  setsWon: [number, number]
  games: [number, number]
  gamePts: [number, number]
  isTiebreak: boolean
  serving: Side
  gamesPlayedInCurrentSet: number
  /** Сколько очков уже сыграно в текущем тайбрейке (следующий — индекс k = это значение). */
  tiebreakPointsPlayed: number
  /** Кто подаёт первое очко тайбрейка (тот же, кто подавал бы следующий гейм при 6:6). */
  tiebreakFirstServer: Side
}

function other(s: Side): Side {
  return s === 'left' ? 'right' : 'left'
}

function idx(s: Side): 0 | 1 {
  return s === 'left' ? 0 : 1
}

export function createInitialScore(firstServer: Side): ScoreInternal {
  return {
    completedSets: [],
    setsWon: [0, 0],
    games: [0, 0],
    gamePts: [0, 0],
    isTiebreak: false,
    serving: firstServer,
    gamesPlayedInCurrentSet: 0,
    tiebreakPointsPlayed: 0,
    tiebreakFirstServer: firstServer,
  }
}

function pointsToTennisDisplay(a: number, b: number, isTb: boolean): [number, number] {
  if (isTb) return [a, b]
  const da = Math.min(a, 3)
  const db = Math.min(b, 3)
  const map = [0, 15, 30, 40] as const
  return [map[da]!, map[db]!]
}

export function toWireScore(s: ScoreInternal): Score {
  const [pL, pR] = pointsToTennisDisplay(s.gamePts[0]!, s.gamePts[1]!, s.isTiebreak)
  let isDeuce = false
  let advantage: Side | null = null
  if (!s.isTiebreak && s.gamePts[0]! >= 3 && s.gamePts[1]! >= 3) {
    const d = s.gamePts[0]! - s.gamePts[1]!
    if (d === 0) {
      isDeuce = true
      advantage = null
    } else if (d === 1) {
      isDeuce = true
      advantage = 'left'
    } else if (d === -1) {
      isDeuce = true
      advantage = 'right'
    }
  }
  return {
    sets: [...s.completedSets],
    games: [...s.games] as [number, number],
    points: [pL, pR],
    isTiebreak: s.isTiebreak,
    isDeuce,
    advantage,
  }
}

/** Кто подаёт очко с индексом k в тайбрейке (k = 0 — первое). */
function tiebreakServerAt(k: number, first: Side): Side {
  if (k === 0) return first
  const seg = Math.floor((k - 1) / 2)
  return seg % 2 === 0 ? other(first) : first
}

/** Подающий для ближайшего розыгрыша (перед применением очка). */
export function currentServer(s: ScoreInternal): Side {
  if (!s.isTiebreak) return s.serving
  return tiebreakServerAt(s.tiebreakPointsPlayed, s.tiebreakFirstServer)
}

export type AddPointResult = {
  matchOver: boolean
  setOver: boolean
  gameOver: boolean
  winner: Side
  sidesChangeAfter: boolean
}

function winSet(s: ScoreInternal, winner: Side): void {
  const i = idx(winner)
  s.setsWon[i]++
  s.completedSets.push([...s.games] as [number, number])
  s.games = [0, 0]
  s.gamePts = [0, 0]
  s.isTiebreak = false
  s.gamesPlayedInCurrentSet = 0
  s.tiebreakPointsPlayed = 0
  s.serving = other(s.serving)
  s.tiebreakFirstServer = s.serving
}

export function addPoint(s: ScoreInternal, winner: Side): AddPointResult {
  const w = idx(winner)

  if (s.isTiebreak) {
    s.gamePts[w]++
    s.tiebreakPointsPlayed++
    const a = s.gamePts[0]!
    const b = s.gamePts[1]!
    const tbDone = (a >= 7 && a - b >= 2) || (b >= 7 && b - a >= 2)
    if (!tbDone) {
      return {
        matchOver: false,
        setOver: false,
        gameOver: false,
        winner,
        sidesChangeAfter: s.tiebreakPointsPlayed > 0 && s.tiebreakPointsPlayed % 6 === 0,
      }
    }
    const setWinner: Side = a > b ? 'left' : 'right'
    s.games[idx(setWinner)]++
    winSet(s, setWinner)
    const mOver = s.setsWon[0]! >= 2 || s.setsWon[1]! >= 2
    return {
      matchOver: mOver,
      setOver: true,
      gameOver: true,
      winner: setWinner,
      sidesChangeAfter: true,
    }
  }

  // Обычный гейм
  s.gamePts[w]++
  const a = s.gamePts[0]!
  const b = s.gamePts[1]!
  const gameDone = (a >= 4 && a - b >= 2) || (b >= 4 && b - a >= 2)
  if (!gameDone) {
    return {
      matchOver: false,
      setOver: false,
      gameOver: false,
      winner,
      sidesChangeAfter: false,
    }
  }

  s.games[w]++
  s.gamePts = [0, 0]
  s.gamesPlayedInCurrentSet++
  s.serving = other(s.serving)
  s.tiebreakFirstServer = s.serving

  const g0 = s.games[0]!
  const g1 = s.games[1]!
  const lead = Math.abs(g0 - g1)
  const maxG = Math.max(g0, g1)

  if (g0 === 6 && g1 === 6) {
    s.isTiebreak = true
    s.gamePts = [0, 0]
    s.tiebreakPointsPlayed = 0
    s.tiebreakFirstServer = s.serving
    return {
      matchOver: false,
      setOver: false,
      gameOver: true,
      winner,
      sidesChangeAfter: s.gamesPlayedInCurrentSet % 2 === 1,
    }
  }

  if (maxG >= 6 && lead >= 2) {
    const setWinner: Side = g0 > g1 ? 'left' : 'right'
    winSet(s, setWinner)
    const mOver = s.setsWon[0]! >= 2 || s.setsWon[1]! >= 2
    return {
      matchOver: mOver,
      setOver: true,
      gameOver: true,
      winner,
      sidesChangeAfter: true,
    }
  }

  return {
    matchOver: false,
    setOver: false,
    gameOver: true,
    winner,
    sidesChangeAfter: s.gamesPlayedInCurrentSet % 2 === 1,
  }
}

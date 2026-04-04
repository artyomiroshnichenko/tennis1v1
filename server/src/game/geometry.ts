import {
  BALL_RADIUS,
  COURT_L,
  COURT_W,
  NET_Y,
  PLAYER_RADIUS,
  SERVICE_DEPTH,
} from './constants'
import type { Side } from './types'

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export function clampPlayerToHalf(x: number, y: number, side: Side): { x: number; y: number } {
  const margin = PLAYER_RADIUS + BALL_RADIUS
  const x0 = margin
  const x1 = COURT_W - margin
  if (side === 'left') {
    const y0 = NET_Y + margin
    const y1 = COURT_L - margin
    return { x: clamp(x, x0, x1), y: clamp(y, y0, y1) }
  }
  const y0 = margin
  const y1 = NET_Y - margin
  return { x: clamp(x, x0, x1), y: clamp(y, y0, y1) }
}

/** Северная половина: y < NET_Y. Южная: y > NET_Y. */
export function halfForY(y: number): Side {
  return y >= NET_Y ? 'left' : 'right'
}

export function inSinglesCourt(x: number, y: number): boolean {
  return x >= 0 && x <= COURT_W && y >= 0 && y <= COURT_L
}

/** Северный сервис-бокс (между сеткой и сервис-линией). */
export function inNorthServiceBox(x: number, y: number): boolean {
  const y0 = NET_Y - SERVICE_DEPTH
  const y1 = NET_Y - BALL_RADIUS
  return y >= y0 && y <= y1 && x >= 0 && x <= COURT_W
}

/** Южный сервис-бокс. */
export function inSouthServiceBox(x: number, y: number): boolean {
  const y0 = NET_Y + BALL_RADIUS
  const y1 = NET_Y + SERVICE_DEPTH
  return y >= y0 && y <= y1 && x >= 0 && x <= COURT_W
}

/** Диагональная зона подачи: с какой половины по x подаём в какой бокс приёма. */
export function inDiagonalServiceTarget(
  server: Side,
  serverX: number,
  x: number,
  y: number,
): boolean {
  if (server === 'left') {
    if (!inNorthServiceBox(x, y)) return false
    const deuceServer = serverX >= COURT_W / 2
    const inDeuceBox = x <= COURT_W / 2
    return deuceServer ? inDeuceBox : !inDeuceBox
  }
  if (!inSouthServiceBox(x, y)) return false
  const deuceServer = serverX >= COURT_W / 2
  const inDeuceBox = x <= COURT_W / 2
  return deuceServer ? inDeuceBox : !inDeuceBox
}

export function baselinePosition(side: Side): { x: number; y: number } {
  if (side === 'left') return { x: COURT_W / 2, y: COURT_L - 1.1 }
  return { x: COURT_W / 2, y: 1.1 }
}

/**
 * Приёмник на подаче: только между своей базовой линией и сервис-линией
 * (не в чужом сервис-боксе и не у сетки).
 */
export function clampReceiverDuringServe(
  x: number,
  y: number,
  server: Side,
): { x: number; y: number } {
  const margin = PLAYER_RADIUS + BALL_RADIUS
  const x0 = margin
  const x1 = COURT_W - margin
  const cx = clamp(x, x0, x1)
  if (server === 'left') {
    const yMax = NET_Y - SERVICE_DEPTH - margin
    return { x: cx, y: clamp(y, margin, yMax) }
  }
  const yMin = NET_Y + SERVICE_DEPTH + margin
  return { x: cx, y: clamp(y, yMin, COURT_L - margin) }
}

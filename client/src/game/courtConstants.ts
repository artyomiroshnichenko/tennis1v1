/** Совпадает с server/src/game/constants.ts — визуал и маппинг координат. */

export const COURT_W_SINGLE = 8.23
export const COURT_L = 23.77
/** Полная ширина с аллеями (двойной корт), мяч и игроки — только в singles по X. */
export const COURT_W_DOUBLE = 10.97
export const ALLEY_W = (COURT_W_DOUBLE - COURT_W_SINGLE) / 2

export const NET_Y = COURT_L / 2
export const SERVICE_DEPTH = 6.4

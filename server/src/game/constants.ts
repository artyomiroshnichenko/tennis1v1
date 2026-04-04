/** Размеры корта и тюнинг физики (метры, вид сверху). Одиночный корт 23.77 × 8.23 м. */

export const COURT_W = 8.23
export const COURT_L = 23.77
export const NET_Y = COURT_L / 2
export const SERVICE_DEPTH = 6.4
/** Линия подачи от сетки к базовой линии на половине */
export const SERVICE_LINE_OFFSET = SERVICE_DEPTH

/** Игрок left — южная базовая линия (y = COURT_L), right — северная (y = 0). */
export const LEFT_BASELINE_Y = COURT_L
export const RIGHT_BASELINE_Y = 0

export const PLAYER_SPEED = 5.2
export const PLAYER_RADIUS = 0.35
export const BALL_RADIUS = 0.065
export const HIT_REACH = 0.95
export const GRAVITY = 12
export const NET_CLEAR_Z = 0.42
/** Высота центра мяча при касании корта (≈ радиус). */
export const BALL_REST_Z = BALL_RADIUS

/** Ожидание тапа «готов к подаче» (после чего открывается индикатор силы). */
export const SERVE_READY_TIMEOUT_MS = 90_000

export const SERVE_POWER_TIMEOUT_MS = 7000
export const SERVE_AIM_TIMEOUT_MS = 7000

/** Совпадает с клиентом: стрелка направления качается примерно от −88° до +88° (всего 176°). */
export const AIM_DIRECTION_SPAN_RAD = (176 * Math.PI) / 180
export const HIT_INDICATOR_TIMEOUT_MS = 3000

export const POINT_PAUSE_MS = 2200
export const SIDES_CHANGE_MS = 2600

export const TICK_DT = 1 / 60

/** Субшаги интеграции мяча за один тик: сетка и касание земли внутри корта не «пропускаются». */
export const BALL_PHYSICS_SUBSTEPS = 8

/**
 * Горизонтальная норма √(vx²+vy²) в м/с.
 * Раньше до 38 м/с мяч за доли секунды пересекал границу корта в воздухе — отскок внутри поля не наступал.
 */
export const SERVE_HORIZ_SPEED_MIN = 7.5
export const SERVE_HORIZ_SPEED_MAX = 18.5

export const RALLY_HORIZ_SPEED_MIN = 8
export const RALLY_HORIZ_SPEED_MAX = 28

/** Совместимость / потолок для rallySpeedCap */
export const BALL_SPEED_MAX = RALLY_HORIZ_SPEED_MAX
export const BALL_SPEED_MIN = RALLY_HORIZ_SPEED_MIN

/**
 * In-memory refresh и офлайн-гость без PostgreSQL.
 * В production отключено, если явно не задано ALLOW_OFFLINE_GUEST=1 (для отладки на VPS).
 */
export function allowRelaxedAuthStorage(): boolean {
  if (process.env.DISABLE_DEV_MEMORY_REFRESH === '1') return false
  if (process.env.ALLOW_OFFLINE_GUEST === '1') return true
  return process.env.NODE_ENV !== 'production'
}

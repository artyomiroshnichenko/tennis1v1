import type { AuthSubjectType, Prisma } from '@prisma/client'

type Row = {
  subjectId: string
  type: AuthSubjectType
  payload: Prisma.JsonValue | null
  expiresAt: Date
}

/** In-memory refresh rows (только dev-fallback при недоступной PostgreSQL). */
const store = new Map<string, Row>()

export function memoryPutRefreshToken(tokenHash: string, row: Row): void {
  store.set(tokenHash, row)
}

/** Одноразовое потребление: удаляет запись при успехе. */
export function memoryConsumeRefreshToken(tokenHash: string): Row | null {
  const r = store.get(tokenHash)
  if (!r) return null
  if (r.expiresAt < new Date()) {
    store.delete(tokenHash)
    return null
  }
  store.delete(tokenHash)
  return r
}

export function memoryRevokeRefreshForSubject(subjectId: string, type: AuthSubjectType): void {
  for (const [h, r] of [...store.entries()]) {
    if (r.subjectId === subjectId && r.type === type) store.delete(h)
  }
}

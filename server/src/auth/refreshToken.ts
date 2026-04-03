import { createHash, randomBytes } from 'crypto'
import type { AuthSubjectType, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

function parseRefreshMs(): number {
  const v = process.env.JWT_REFRESH_EXPIRES_IN ?? '30d'
  const m = v.match(/^(\d+)([dhms])$/)
  if (!m) return 30 * 24 * 60 * 60 * 1000
  const n = parseInt(m[1], 10)
  switch (m[2]) {
    case 'd':
      return n * 24 * 60 * 60 * 1000
    case 'h':
      return n * 60 * 60 * 1000
    case 'm':
      return n * 60 * 1000
    case 's':
      return n * 1000
    default:
      return 30 * 24 * 60 * 60 * 1000
  }
}

export async function issueRefreshToken(
  subjectId: string,
  type: AuthSubjectType,
  payload: Prisma.InputJsonValue | null,
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const expiresAt = new Date(Date.now() + parseRefreshMs())
  await prisma.refreshToken.create({
    data: {
      tokenHash,
      subjectId,
      type,
      expiresAt,
      ...(payload != null ? { payload } : {}),
    },
  })
  return { raw, expiresAt }
}

export type ConsumedRefresh = {
  subjectId: string
  type: AuthSubjectType
  payload: Prisma.JsonValue | null
}

export async function consumeRefreshToken(raw: string): Promise<ConsumedRefresh | null> {
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!row || row.expiresAt < new Date()) {
    return null
  }
  await prisma.refreshToken.delete({ where: { id: row.id } })
  return { subjectId: row.subjectId, type: row.type, payload: row.payload }
}

export async function revokeRefreshTokensForSubject(
  subjectId: string,
  type: AuthSubjectType,
): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { subjectId, type } })
}

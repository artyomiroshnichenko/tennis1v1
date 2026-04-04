import { createHash, randomBytes } from 'crypto'
import type { AuthSubjectType, Prisma } from '@prisma/client'
import { isDatabaseUnavailableError } from '../lib/prismaErrors'
import { prisma } from '../lib/prisma'
import { allowRelaxedAuthStorage } from './devAuthRelax'
import {
  memoryConsumeRefreshToken,
  memoryPutRefreshToken,
  memoryRevokeRefreshForSubject,
} from './refreshTokenMemory'

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

function shouldUseMemoryRefreshFallback(e: unknown): boolean {
  return allowRelaxedAuthStorage() && isDatabaseUnavailableError(e)
}

export function getRefreshExpiresAtDate(): Date {
  return new Date(Date.now() + parseRefreshMs())
}

export async function issueRefreshToken(
  subjectId: string,
  type: AuthSubjectType,
  payload: Prisma.InputJsonValue | null,
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const expiresAt = new Date(Date.now() + parseRefreshMs())
  try {
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
  } catch (e) {
    if (shouldUseMemoryRefreshFallback(e)) {
      console.warn(
        '[auth] PostgreSQL недоступна — refresh-токены гостя/сессии хранятся в памяти процесса (только не-production). Поднимите БД для постоянных сессий.',
      )
      memoryPutRefreshToken(tokenHash, {
        subjectId,
        type,
        payload: (payload ?? null) as Prisma.JsonValue | null,
        expiresAt,
      })
      return { raw, expiresAt }
    }
    throw e
  }
}

export type ConsumedRefresh = {
  subjectId: string
  type: AuthSubjectType
  payload: Prisma.JsonValue | null
}

export async function consumeRefreshToken(raw: string): Promise<ConsumedRefresh | null> {
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  try {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } })
    if (row && row.expiresAt >= new Date()) {
      await prisma.refreshToken.delete({ where: { id: row.id } })
      return { subjectId: row.subjectId, type: row.type, payload: row.payload }
    }
  } catch (e) {
    if (shouldUseMemoryRefreshFallback(e)) {
      const m = memoryConsumeRefreshToken(tokenHash)
      if (!m) return null
      return { subjectId: m.subjectId, type: m.type, payload: m.payload }
    }
    throw e
  }

  const m = memoryConsumeRefreshToken(tokenHash)
  if (m) return { subjectId: m.subjectId, type: m.type, payload: m.payload }
  return null
}

export async function revokeRefreshTokensForSubject(
  subjectId: string,
  type: AuthSubjectType,
): Promise<void> {
  memoryRevokeRefreshForSubject(subjectId, type)
  try {
    await prisma.refreshToken.deleteMany({ where: { subjectId, type } })
  } catch (e) {
    if (!shouldUseMemoryRefreshFallback(e)) throw e
  }
}

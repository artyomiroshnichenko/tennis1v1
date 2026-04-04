import { createHash, randomBytes, randomUUID } from 'crypto'
import { AuthSubjectType } from '@prisma/client'
import { allowRelaxedAuthStorage } from './devAuthRelax'
import { signAccessToken } from './jwt'
import { getRefreshExpiresAtDate, issueRefreshToken } from './refreshToken'
import { memoryPutRefreshToken } from './refreshTokenMemory'

/** Гость целиком в памяти (без INSERT в БД). */
function createGuestSessionInMemoryOnly(nickname: string): {
  accessToken: string
  refreshToken: string
} {
  const subjectId = randomUUID()
  const raw = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(raw).digest('hex')
  const expiresAt = getRefreshExpiresAtDate()
  memoryPutRefreshToken(tokenHash, {
    subjectId,
    type: AuthSubjectType.GUEST,
    payload: { nickname },
    expiresAt,
  })
  const accessToken = signAccessToken({ sub: subjectId, typ: 'guest', nickname })
  return { accessToken, refreshToken: raw }
}

export async function createGuestSession(nickname: string) {
  try {
    const subjectId = randomUUID()
    const { raw: refreshToken } = await issueRefreshToken(subjectId, AuthSubjectType.GUEST, {
      nickname,
    })
    const accessToken = signAccessToken({ sub: subjectId, typ: 'guest', nickname })
    return { accessToken, refreshToken }
  } catch (e) {
    if (!allowRelaxedAuthStorage()) throw e
    console.warn(
      '[auth] createGuestSession: сбой (часто БД); создаём гостя только в памяти процесса.',
      e,
    )
    return createGuestSessionInMemoryOnly(nickname)
  }
}

export async function createUserSession(userId: string, nickname: string) {
  const { raw: refreshToken } = await issueRefreshToken(userId, AuthSubjectType.USER, null)
  const accessToken = signAccessToken({ sub: userId, typ: 'user', nickname })
  return { accessToken, refreshToken }
}

import { randomUUID } from 'crypto'
import { AuthSubjectType } from '@prisma/client'
import { signAccessToken } from './jwt'
import { issueRefreshToken } from './refreshToken'

export async function createGuestSession(nickname: string) {
  const subjectId = randomUUID()
  const { raw: refreshToken } = await issueRefreshToken(subjectId, AuthSubjectType.GUEST, {
    nickname,
  })
  const accessToken = signAccessToken({ sub: subjectId, typ: 'guest', nickname })
  return { accessToken, refreshToken }
}

export async function createUserSession(userId: string, nickname: string) {
  const { raw: refreshToken } = await issueRefreshToken(userId, AuthSubjectType.USER, null)
  const accessToken = signAccessToken({ sub: userId, typ: 'user', nickname })
  return { accessToken, refreshToken }
}

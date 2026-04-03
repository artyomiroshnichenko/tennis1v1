import { Router } from 'express'
import { AuthSubjectType } from '@prisma/client'
import { NicknameValidationError, validateNickname } from '../../auth/nickname'
import { verifyFirebaseIdToken, isFirebaseConfigured } from '../../auth/firebaseAdmin'
import { signAccessToken } from '../../auth/jwt'
import { consumeRefreshToken, issueRefreshToken, revokeRefreshTokensForSubject } from '../../auth/refreshToken'
import { createGuestSession, createUserSession } from '../../auth/session'
import { sendApiError } from '../../lib/httpError'
import { prisma } from '../../lib/prisma'
import type { AuthedRequest } from '../../middleware/auth'
import { requireAccessToken } from '../../middleware/auth'

export const authRouter = Router()

function mapTyp(t: 'guest' | 'user'): AuthSubjectType {
  return t === 'guest' ? AuthSubjectType.GUEST : AuthSubjectType.USER
}

authRouter.post('/guest', async (req, res) => {
  try {
    const nickname = validateNickname(req.body?.nickname)
    const { accessToken, refreshToken } = await createGuestSession(nickname)
    res.json({ accessToken, refreshToken })
  } catch (e) {
    if (e instanceof NicknameValidationError) {
      sendApiError(res, 400, 'VALIDATION_ERROR', e.message)
      return
    }
    sendApiError(res, 500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера')
  }
})

authRouter.post('/firebase', async (req, res) => {
  if (!isFirebaseConfigured()) {
    sendApiError(res, 503, 'INTERNAL_ERROR', 'Вход по Firebase временно недоступен')
    return
  }
  const idToken = req.body?.idToken
  if (typeof idToken !== 'string' || !idToken) {
    sendApiError(res, 400, 'VALIDATION_ERROR', 'Поле idToken обязательно')
    return
  }
  let decoded
  try {
    decoded = await verifyFirebaseIdToken(idToken)
  } catch {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Недействительный Firebase токен')
    return
  }
  const firebaseId = decoded.uid

  const existing = await prisma.user.findUnique({ where: { firebaseId } })
  if (existing) {
    const { accessToken, refreshToken } = await createUserSession(existing.id, existing.nickname)
    res.json({
      accessToken,
      refreshToken,
      user: { id: existing.id, nickname: existing.nickname },
    })
    return
  }

  let nickname: string
  try {
    nickname = validateNickname(req.body?.nickname)
  } catch (e) {
    if (e instanceof NicknameValidationError) {
      sendApiError(res, 400, 'VALIDATION_ERROR', e.message)
      return
    }
    throw e
  }

  const clash = await prisma.user.findUnique({ where: { nickname } })
  if (clash) {
    sendApiError(res, 409, 'NICKNAME_TAKEN', 'Этот никнейм уже занят')
    return
  }

  try {
    const user = await prisma.user.create({
      data: { firebaseId, nickname },
    })
    const { accessToken, refreshToken } = await createUserSession(user.id, user.nickname)
    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, nickname: user.nickname },
    })
  } catch {
    sendApiError(res, 500, 'INTERNAL_ERROR', 'Не удалось создать пользователя')
  }
})

authRouter.post('/refresh', async (req, res) => {
  const raw = req.body?.refreshToken
  if (typeof raw !== 'string' || !raw) {
    sendApiError(res, 400, 'VALIDATION_ERROR', 'Поле refreshToken обязательно')
    return
  }
  const consumed = await consumeRefreshToken(raw)
  if (!consumed) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Refresh-токен недействителен')
    return
  }

  if (consumed.type === AuthSubjectType.GUEST) {
    const p = consumed.payload as { nickname?: string } | null
    const nickname = typeof p?.nickname === 'string' ? p.nickname : null
    if (!nickname) {
      sendApiError(res, 401, 'UNAUTHORIZED', 'Сессия гостя повреждена')
      return
    }
    const { raw: refreshToken } = await issueRefreshToken(
      consumed.subjectId,
      AuthSubjectType.GUEST,
      { nickname },
    )
    const accessToken = signAccessToken({
      sub: consumed.subjectId,
      typ: 'guest',
      nickname,
    })
    res.json({ accessToken, refreshToken })
    return
  }

  const user = await prisma.user.findUnique({ where: { id: consumed.subjectId } })
  if (!user) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Пользователь не найден')
    return
  }
  const { raw: refreshToken } = await issueRefreshToken(user.id, AuthSubjectType.USER, null)
  const accessToken = signAccessToken({
    sub: user.id,
    typ: 'user',
    nickname: user.nickname,
  })
  res.json({ accessToken, refreshToken })
})

authRouter.post('/logout', requireAccessToken, async (req: AuthedRequest, res) => {
  const a = req.auth!
  await revokeRefreshTokensForSubject(a.sub, mapTyp(a.typ))
  res.status(204).end()
})

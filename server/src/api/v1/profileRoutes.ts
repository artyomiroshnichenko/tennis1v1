import { Router } from 'express'
import { NicknameValidationError, validateNickname } from '../../auth/nickname'
import { signAccessToken } from '../../auth/jwt'
import { sendApiError } from '../../lib/httpError'
import { prisma } from '../../lib/prisma'
import type { AuthedRequest } from '../../middleware/auth'
import { requireAccessToken, requireRegisteredUser } from '../../middleware/auth'
import { verifyAccessToken } from '../../auth/jwt'

export const profileRouter = Router()

function tryBearerToken(req: AuthedRequest): string | null {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1]! : null
}

profileRouter.get('/me', requireAccessToken, async (req: AuthedRequest, res) => {
  const a = req.auth!
  if (a.typ === 'guest') {
    res.json({ type: 'guest', nickname: a.nickname })
    return
  }
  const user = await prisma.user.findUnique({ where: { id: a.sub } })
  if (!user) {
    sendApiError(res, 404, 'NOT_FOUND', 'Пользователь не найден')
    return
  }
  res.json({
    type: 'user',
    id: user.id,
    nickname: user.nickname,
    role: user.role,
  })
})

profileRouter.get('/nickname/check', async (req, res) => {
  const raw = req.query.value
  if (typeof raw !== 'string') {
    sendApiError(res, 400, 'VALIDATION_ERROR', 'Укажите параметр value')
    return
  }
  let value: string
  try {
    value = validateNickname(raw)
  } catch (e) {
    if (e instanceof NicknameValidationError) {
      sendApiError(res, 400, 'VALIDATION_ERROR', e.message)
      return
    }
    throw e
  }

  const token = tryBearerToken(req as AuthedRequest)
  if (token) {
    try {
      const claims = verifyAccessToken(token)
      if (claims.typ === 'user') {
        const user = await prisma.user.findUnique({ where: { id: claims.sub } })
        if (user?.nickname === value) {
          res.json({ available: true })
          return
        }
      }
    } catch {
      /* без авторизации проверяем только занятость */
    }
  }

  const taken = await prisma.user.findUnique({ where: { nickname: value } })
  res.json({ available: !taken })
})

profileRouter.patch(
  '/nickname',
  requireAccessToken,
  requireRegisteredUser,
  async (req: AuthedRequest, res) => {
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
    const current = req.dbUser!
    if (nickname === current.nickname) {
      const accessToken = signAccessToken({
        sub: current.id,
        typ: 'user',
        nickname: current.nickname,
      })
      res.json({ nickname: current.nickname, accessToken })
      return
    }
    const clash = await prisma.user.findUnique({ where: { nickname } })
    if (clash) {
      sendApiError(res, 409, 'NICKNAME_TAKEN', 'Этот никнейм уже занят')
      return
    }
    const user = await prisma.user.update({
      where: { id: current.id },
      data: { nickname },
    })
    const accessToken = signAccessToken({
      sub: user.id,
      typ: 'user',
      nickname: user.nickname,
    })
    res.json({ nickname: user.nickname, accessToken })
  },
)

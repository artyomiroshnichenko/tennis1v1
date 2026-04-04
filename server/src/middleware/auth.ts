import type { NextFunction, Request, Response } from 'express'
import { Role, type User } from '@prisma/client'
import { verifyAccessToken, type AccessClaims } from '../auth/jwt'
import { sendApiError } from '../lib/httpError'
import { prisma } from '../lib/prisma'

export type AuthedRequest = Request & {
  auth?: AccessClaims
  dbUser?: User
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1]! : null
}

export function requireAccessToken(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractBearer(req)
  if (!token) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация')
    return
  }
  try {
    req.auth = verifyAccessToken(token)
    next()
  } catch {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Сессия истекла или токен недействителен')
  }
}

export async function requireRegisteredUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.auth) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация')
    return
  }
  if (req.auth.typ !== 'user') {
    sendApiError(res, 403, 'FORBIDDEN', 'Доступно только зарегистрированным пользователям')
    return
  }
  const user = await prisma.user.findUnique({ where: { id: req.auth.sub } })
  if (!user) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Пользователь не найден')
    return
  }
  req.dbUser = user
  next()
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.auth) {
    sendApiError(res, 401, 'UNAUTHORIZED', 'Требуется авторизация')
    return
  }
  if (req.auth.typ !== 'user') {
    sendApiError(res, 403, 'FORBIDDEN', 'Доступно только администратору')
    return
  }
  const user = await prisma.user.findUnique({ where: { id: req.auth.sub } })
  if (!user || user.role !== Role.ADMIN) {
    sendApiError(res, 403, 'FORBIDDEN', 'Нет прав администратора')
    return
  }
  req.dbUser = user
  next()
}

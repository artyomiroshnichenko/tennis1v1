import jwt, { type SignOptions } from 'jsonwebtoken'

export type AccessClaims = {
  sub: string
  typ: 'guest' | 'user'
  nickname: string
}

function getSecret(): string {
  const s = process.env.JWT_SECRET
  if (!s) {
    throw new Error('JWT_SECRET is required')
  }
  return s
}

export function signAccessToken(claims: AccessClaims): string {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? '15m'
  return jwt.sign(claims, getSecret(), { expiresIn: expiresIn as SignOptions['expiresIn'] })
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, getSecret()) as AccessClaims
}

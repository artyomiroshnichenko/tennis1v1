import jwt, { type SignOptions } from 'jsonwebtoken'

export type AccessClaims = {
  sub: string
  typ: 'guest' | 'user'
  nickname: string
}

const DEV_FALLBACK_SECRET = '__tennis1v1_dev_only_jwt_secret__'

function getSecret(): string {
  const s = process.env.JWT_SECRET?.trim()
  if (s) return s
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
    console.warn(
      '[auth] JWT_SECRET не задан в server/.env — используется временный ключ только для development.',
    )
    return DEV_FALLBACK_SECRET
  }
  throw new Error('JWT_SECRET is required in production')
}

export function signAccessToken(claims: AccessClaims): string {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? '15m'
  return jwt.sign(claims, getSecret(), { expiresIn: expiresIn as SignOptions['expiresIn'] })
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, getSecret()) as AccessClaims
}

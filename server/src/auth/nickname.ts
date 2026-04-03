/** Латиница, кириллица, цифры, дефис, подчёркивание; длина 3–20 */
const NICKNAME_RE = /^[\p{L}0-9_-]{3,20}$/u

export class NicknameValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NicknameValidationError'
  }
}

export function validateNickname(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new NicknameValidationError('Никнейм должен быть строкой')
  }
  const t = raw.trim()
  if (!NICKNAME_RE.test(t)) {
    throw new NicknameValidationError(
      'Никнейм: 3–20 символов, только буквы, цифры, дефис и подчёркивание',
    )
  }
  return t
}

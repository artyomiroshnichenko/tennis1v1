const NICKNAME_RE = /^[\p{L}0-9_-]{3,20}$/u

export function validateNicknameInput(raw: string): string {
  const t = raw.trim()
  if (!NICKNAME_RE.test(t)) {
    throw new Error(
      'Никнейм: 3–20 символов, только буквы, цифры, дефис и подчёркивание',
    )
  }
  return t
}

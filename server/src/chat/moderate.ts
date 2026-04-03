/**
 * Замена отдельных слов в тексте на маску (эпик 07).
 * Регистронезависимо, только целые слова (буквы/цифры/подчёркивание).
 */
const MASK = '***'

/** Минимальный набор для демонстрации политики; при необходимости расширять списком. */
const BANNED = new Set(
  [
    'хуй',
    'хуя',
    'хуе',
    'хуи',
    'пизд',
    'ебан',
    'ебат',
    'ебёт',
    'ебет',
    'сука',
    'бляд',
    'блять',
    'fuck',
    'shit',
    'damn',
  ].map((w) => w.toLowerCase()),
)

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}_]/u.test(c)
}

export function maskBannedWords(text: string): string {
  if (!text) return text
  const lower = text.toLowerCase()
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (!isWordChar(c)) {
      out += c
      i += 1
      continue
    }
    let j = i + 1
    while (j < text.length && isWordChar(text[j]!)) j += 1
    const word = lower.slice(i, j)
    let masked = false
    for (const banned of BANNED) {
      if (word === banned || word.startsWith(banned)) {
        masked = true
        break
      }
    }
    out += masked ? MASK : text.slice(i, j)
    i = j
  }
  return out
}

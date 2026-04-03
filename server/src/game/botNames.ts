export const BOT_EASY_NAME = 'Пикми тиннисистка'

export const BOT_MEDIUM_NAMES = ['Медведев', 'Бублик', 'Рублев', 'Соболенко'] as const

export const BOT_HARD_NAMES = [
  'Новак Джокович',
  'Рафаэль Надаль',
  'Роджер Федерер',
  'Карлос Алькарас',
  'Янник Синнер',
] as const

export type BotDifficulty = 'easy' | 'medium' | 'hard'

export function pickBotName(difficulty: BotDifficulty): string {
  if (difficulty === 'easy') return BOT_EASY_NAME
  const list = difficulty === 'medium' ? BOT_MEDIUM_NAMES : BOT_HARD_NAMES
  return list[Math.floor(Math.random() * list.length)]!
}

type BotCfg = { spread: number; moveNoise: number }

export function botDifficultyCfg(d: BotDifficulty): BotCfg {
  switch (d) {
    case 'easy':
      return { spread: 0.52, moveNoise: 0.22 }
    case 'medium':
      return { spread: 0.36, moveNoise: 0.14 }
    case 'hard':
      return { spread: 0.22, moveNoise: 0.08 }
  }
}

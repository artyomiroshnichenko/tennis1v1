import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { Side } from '../game/types'

/** Сохраняет матч с ботом для зарегистрированного игрока (игрок всегда слева в сессии). */
export async function persistBotMatch(params: {
  humanUserId: string
  botName: string
  winnerSide: Side
  sets: [number, number][]
  reason: string
}): Promise<void> {
  const humanWon = params.winnerSide === 'left'
  const technical =
    params.reason.includes('вкладк') ||
    params.reason.includes('неактивн') ||
    params.reason === 'Соперник вышел'

  try {
    await prisma.match.create({
      data: {
        type: 'BOT',
        status: technical ? 'TECHNICAL_DEFEAT' : 'FINISHED',
        winnerId: humanWon ? params.humanUserId : null,
        sets: params.sets as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        players: {
          create: [
            {
              side: 'left',
              isWinner: humanWon,
              userId: params.humanUserId,
              guestNickname: null,
            },
            {
              side: 'right',
              isWinner: !humanWon,
              userId: null,
              guestNickname: params.botName,
            },
          ],
        },
      },
    })
  } catch (e) {
    console.error('persistBotMatch failed', e)
  }
}

import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import type { Side } from '../game/types'
import type { ManagedRoom } from '../rooms/types'

/** Сохраняет онлайн-матч, если есть хотя бы один зарегистрированный участник. */
export async function persistOnlineMatch(
  room: ManagedRoom,
  winnerSide: Side,
  sets: [number, number][],
  reason: string,
): Promise<void> {
  const host = room.players.find((p) => p.isHost)
  const guest = room.players.find((p) => !p.isHost)
  if (!host || !guest) return

  const technical = reason === 'Соперник вышел' || reason === 'Соперник не вернулся'
  if (host.authType !== 'user' && guest.authType !== 'user') return

  const winnerPlayer = winnerSide === 'left' ? host : guest
  const winnerId = winnerPlayer.authType === 'user' ? winnerPlayer.subjectId : null

  try {
    await prisma.match.create({
      data: {
        type: 'ONLINE',
        status: technical ? 'TECHNICAL_DEFEAT' : 'FINISHED',
        winnerId,
        sets: sets as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        players: {
          create: [
            {
              side: 'left',
              isWinner: winnerSide === 'left',
              userId: host.authType === 'user' ? host.subjectId : null,
              guestNickname: host.authType === 'guest' ? host.nickname : null,
            },
            {
              side: 'right',
              isWinner: winnerSide === 'right',
              userId: guest.authType === 'user' ? guest.subjectId : null,
              guestNickname: guest.authType === 'guest' ? guest.nickname : null,
            },
          ],
        },
      },
    })
  } catch (e) {
    console.error('persistOnlineMatch failed', e)
  }
}

/** Оба участника не вернулись после обрыва (эпик 08). */
export async function persistOnlineDoubleDefeat(
  room: ManagedRoom,
  sets: [number, number][],
  reason: string,
): Promise<void> {
  const host = room.players.find((p) => p.isHost)
  const guest = room.players.find((p) => !p.isHost)
  if (!host || !guest) return
  if (host.authType !== 'user' && guest.authType !== 'user') return

  try {
    await prisma.match.create({
      data: {
        type: 'ONLINE',
        status: 'DOUBLE_DEFEAT',
        winnerId: null,
        sets: sets as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        players: {
          create: [
            {
              side: 'left',
              isWinner: false,
              userId: host.authType === 'user' ? host.subjectId : null,
              guestNickname: host.authType === 'guest' ? host.nickname : null,
            },
            {
              side: 'right',
              isWinner: false,
              userId: guest.authType === 'user' ? guest.subjectId : null,
              guestNickname: guest.authType === 'guest' ? guest.nickname : null,
            },
          ],
        },
      },
    })
  } catch (e) {
    console.error('persistOnlineDoubleDefeat failed', e)
  }
}

import { Router } from 'express'
import { prisma } from '../../lib/prisma'
import type { AuthedRequest } from '../../middleware/auth'
import { requireAccessToken, requireRegisteredUser } from '../../middleware/auth'

export const matchesRouter = Router()

matchesRouter.get(
  '/matches/history',
  requireAccessToken,
  requireRegisteredUser,
  async (req: AuthedRequest, res) => {
    const rows = await prisma.matchPlayer.findMany({
      where: { userId: req.dbUser!.id },
      include: {
        match: {
          include: {
            players: { include: { user: { select: { nickname: true } } } },
          },
        },
      },
      orderBy: { match: { createdAt: 'desc' } },
      take: 100,
    })
    const items = rows.map((r) => {
      const opp = r.match.players.find((p) => p.userId !== req.dbUser!.id)
      const opponent =
        opp?.user?.nickname ?? opp?.guestNickname ?? (opp ? 'Соперник' : '—')
      const technical = r.match.status === 'TECHNICAL_DEFEAT'
      let outcome: 'win' | 'loss' | 'technical_win' | 'technical_loss'
      if (technical) {
        outcome = r.isWinner ? 'technical_win' : 'technical_loss'
      } else {
        outcome = r.isWinner ? 'win' : 'loss'
      }
      return {
        matchId: r.matchId,
        type: r.match.type,
        status: r.match.status,
        sets: r.match.sets,
        finishedAt: r.match.finishedAt,
        isWinner: r.isWinner,
        createdAt: r.match.createdAt,
        opponent,
        outcome,
      }
    })
    res.json({ items })
  },
)

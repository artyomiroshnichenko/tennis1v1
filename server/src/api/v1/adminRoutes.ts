import { Router } from 'express'
import type { MatchStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { sendApiError } from '../../lib/httpError'
import type { AuthedRequest } from '../../middleware/auth'
import { requireAccessToken, requireAdmin } from '../../middleware/auth'
import { getBotSessionsCount, getRoomManagerInstance } from '../../realtime/roomManagerHolder'

export const adminRouter = Router()

const TERMINAL: MatchStatus[] = ['FINISHED', 'TECHNICAL_DEFEAT', 'DOUBLE_DEFEAT']

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

async function playedBucket(since: Date): Promise<{ total: number; online: number; bot: number }> {
  const rows = await prisma.match.groupBy({
    by: ['type'],
    where: {
      status: { in: TERMINAL },
      finishedAt: { not: null, gte: since },
    },
    _count: { _all: true },
  })
  const online = rows.find((r) => r.type === 'ONLINE')?._count._all ?? 0
  const bot = rows.find((r) => r.type === 'BOT')?._count._all ?? 0
  return { total: online + bot, online, bot }
}

async function playedAllTime(): Promise<{ total: number; online: number; bot: number }> {
  const rows = await prisma.match.groupBy({
    by: ['type'],
    where: { status: { in: TERMINAL }, finishedAt: { not: null } },
    _count: { _all: true },
  })
  const online = rows.find((r) => r.type === 'ONLINE')?._count._all ?? 0
  const bot = rows.find((r) => r.type === 'BOT')?._count._all ?? 0
  return { total: online + bot, online, bot }
}

adminRouter.get('/stats', requireAccessToken, requireAdmin, async (_req: AuthedRequest, res) => {
  const now = new Date()
  const dayStart = startOfUtcDay(now)
  const weekStart = new Date(dayStart)
  weekStart.setUTCDate(weekStart.getUTCDate() - 7)

  const [day, week, all] = await Promise.all([
    playedBucket(dayStart),
    playedBucket(weekStart),
    playedAllTime(),
  ])

  res.json({ day, week, all })
})

adminRouter.get('/active', requireAccessToken, requireAdmin, (_req: AuthedRequest, res) => {
  const rm = getRoomManagerInstance()
  if (!rm) {
    sendApiError(res, 503, 'SERVICE_UNAVAILABLE', 'Менеджер комнат недоступен')
    return
  }
  const items = rm.getActivePlayingMatches()
  res.json({
    activeMatches: items.length,
    onlineConnections: rm.getSocketConnectionsCount(),
    botSessions: getBotSessionsCount(),
    items,
  })
})

adminRouter.get('/matches', requireAccessToken, requireAdmin, async (req: AuthedRequest, res) => {
  const fromRaw = req.query.from
  const toRaw = req.query.to
  let from: Date | undefined
  let to: Date | undefined
  if (typeof fromRaw === 'string' && fromRaw.trim()) {
    const d = new Date(fromRaw)
    if (!Number.isNaN(d.getTime())) from = d
  }
  if (typeof toRaw === 'string' && toRaw.trim()) {
    const d = new Date(toRaw)
    if (!Number.isNaN(d.getTime())) to = d
  }

  const finishedAt: { not: null; gte?: Date; lte?: Date } = { not: null }
  if (from) finishedAt.gte = from
  if (to) finishedAt.lte = to

  const rows = await prisma.match.findMany({
    where: {
      status: { in: TERMINAL },
      finishedAt,
    },
    include: {
      players: { include: { user: { select: { nickname: true } } } },
    },
    orderBy: { finishedAt: 'desc' },
    take: 500,
  })

  const items = rows.map((m) => ({
    id: m.id,
    type: m.type,
    status: m.status,
    sets: m.sets,
    createdAt: m.createdAt.toISOString(),
    finishedAt: m.finishedAt!.toISOString(),
    duration: m.duration,
    players: m.players.map((p) => ({
      nickname: p.user?.nickname ?? p.guestNickname ?? '—',
      side: p.side,
      isWinner: p.isWinner,
    })),
  }))

  res.json({ items })
})

adminRouter.get('/players', requireAccessToken, requireAdmin, async (_req: AuthedRequest, res) => {
  const [totals, wins, users] = await Promise.all([
    prisma.matchPlayer.groupBy({
      by: ['userId'],
      where: { userId: { not: null } },
      _count: { _all: true },
    }),
    prisma.matchPlayer.groupBy({
      by: ['userId'],
      where: { userId: { not: null }, isWinner: true },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      orderBy: { nickname: 'asc' },
      select: { id: true, nickname: true, createdAt: true },
    }),
  ])

  const totalMap = new Map(totals.filter((t) => t.userId).map((t) => [t.userId!, t._count._all]))
  const winMap = new Map(wins.filter((w) => w.userId).map((w) => [w.userId!, w._count._all]))

  const items = users.map((u) => {
    const m = totalMap.get(u.id) ?? 0
    const w = winMap.get(u.id) ?? 0
    const losses = m - w
    return {
      id: u.id,
      nickname: u.nickname,
      registeredAt: u.createdAt.toISOString(),
      matches: m,
      wins: w,
      losses,
      winRatePercent: m > 0 ? Math.round((w / m) * 1000) / 10 : 0,
    }
  })

  res.json({ items })
})

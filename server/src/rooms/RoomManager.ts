import { randomUUID } from 'crypto'
import type { Server } from 'socket.io'
import { MatchController } from '../game/MatchController'
import type { Side } from '../game/types'
import { persistOnlineDoubleDefeat, persistOnlineMatch } from '../match/persistOnlineMatch'
import { maskBannedWords } from '../chat/moderate'
import type {
  ManagedRoom,
  LobbyChatMessage,
  RoomJoinedPlayer,
  RoomSpectator,
  AuthKind,
} from './types'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COUNTDOWN_SECONDS = 15
const IDLE_CLOSE_MS = 5 * 60 * 1000
const MAX_ACTIVE_ROOMS_PER_SUBJECT = 3
const MAX_ROOM_CREATES_PER_IP_10MIN = 10
const TEN_MIN_MS = 10 * 60 * 1000
const CHAT_MAX_LEN = 200
const CHAT_MAX_PER_WINDOW = 3
const CHAT_WINDOW_MS = 5000
const REACTION_COOLDOWN_MS = 5000
const MAX_SPECTATORS = 2

export type ReactionType = 'heart' | 'fire' | 'cry' | 'halo' | 'angry'

const REACTION_TYPES = new Set<ReactionType>(['heart', 'fire', 'cry', 'halo', 'angry'])

function randomCode(length = 6): string {
  let s = ''
  for (let i = 0; i < length; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return s
}

function clientIp(socket: { handshake: { headers: Record<string, string | string | undefined>; address?: string } }): string {
  const xff = socket.handshake.headers['x-forwarded-for']
  if (typeof xff === 'string') {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return socket.handshake.address ?? 'unknown'
}

export class RoomManager {
  private readonly io: Server
  private readonly roomsById = new Map<string, ManagedRoom>()
  private readonly roomsByCode = new Map<string, ManagedRoom>()
  private readonly socketToRoomId = new Map<string, string>()
  private readonly spectatorToRoomId = new Map<string, string>()
  /** Сколько комнат сейчас «ведёт» субъект (hostSubjectId) */
  private readonly activeRoomsByHostSubject = new Map<string, number>()
  private readonly roomCreateTimestampsByIp: Map<string, number[]> = new Map()
  private readonly chatTimestampsBySocket: Map<string, number[]> = new Map()
  private readonly reactionLastBySocket: Map<string, number> = new Map()

  constructor(io: Server) {
    this.io = io
  }

  private nonAdminSpectatorCount(room: ManagedRoom): number {
    return room.spectators.filter((s) => !s.isAdmin).length
  }

  private emitPublicSpectatorCount(room: ManagedRoom): void {
    this.io.to(`room:${room.id}`).emit('spectator:count', { count: this.nonAdminSpectatorCount(room) })
  }

  getSocketConnectionsCount(): number {
    return this.io.sockets.sockets.size
  }

  getActivePlayingMatches(): Array<{
    code: string
    roomId: string
    players: RoomJoinedPlayer[]
  }> {
    const out: Array<{ code: string; roomId: string; players: RoomJoinedPlayer[] }> = []
    for (const room of this.roomsById.values()) {
      if (room.phase !== 'playing' || !room.match) continue
      out.push({
        code: room.code,
        roomId: room.id,
        players: this.buildPlayersPayload(room),
      })
    }
    return out
  }

  getRoomBySocket(socketId: string): ManagedRoom | undefined {
    const playerRoom = this.socketToRoomId.get(socketId)
    if (playerRoom) return this.roomsById.get(playerRoom)
    const specRoom = this.spectatorToRoomId.get(socketId)
    return specRoom ? this.roomsById.get(specRoom) : undefined
  }

  private pruneIpCreates(ip: string): void {
    const now = Date.now()
    const arr = this.roomCreateTimestampsByIp.get(ip) ?? []
    const fresh = arr.filter((t) => now - t < TEN_MIN_MS)
    this.roomCreateTimestampsByIp.set(ip, fresh)
  }

  private canCreateRoom(ip: string, hostSubjectId: string): { ok: true } | { ok: false; code: string; message: string } {
    this.pruneIpCreates(ip)
    const creates = this.roomCreateTimestampsByIp.get(ip) ?? []
    if (creates.length >= MAX_ROOM_CREATES_PER_IP_10MIN) {
      return { ok: false, code: 'RATE_LIMITED', message: 'Слишком много комнат с вашего адреса, подождите' }
    }
    const active = this.activeRoomsByHostSubject.get(hostSubjectId) ?? 0
    if (active >= MAX_ACTIVE_ROOMS_PER_SUBJECT) {
      return { ok: false, code: 'RATE_LIMITED', message: 'У вас уже максимум активных комнат' }
    }
    return { ok: true }
  }

  private registerRoomCreate(ip: string, hostSubjectId: string): void {
    const now = Date.now()
    const arr = this.roomCreateTimestampsByIp.get(ip) ?? []
    arr.push(now)
    this.roomCreateTimestampsByIp.set(ip, arr)
    this.activeRoomsByHostSubject.set(hostSubjectId, (this.activeRoomsByHostSubject.get(hostSubjectId) ?? 0) + 1)
  }

  private releaseHostSlot(hostSubjectId: string): void {
    const n = (this.activeRoomsByHostSubject.get(hostSubjectId) ?? 1) - 1
    if (n <= 0) this.activeRoomsByHostSubject.delete(hostSubjectId)
    else this.activeRoomsByHostSubject.set(hostSubjectId, n)
  }

  private clearRoomTimers(room: ManagedRoom): void {
    if (room.countdownTimer) {
      clearInterval(room.countdownTimer)
      room.countdownTimer = undefined
    }
    if (room.idleTimer) {
      clearTimeout(room.idleTimer)
      room.idleTimer = undefined
    }
  }

  private destroyRoom(room: ManagedRoom, notify: boolean): void {
    this.clearRoomTimers(room)
    room.match?.stop()
    room.match = undefined
    if (notify) {
      this.io.to(`room:${room.id}`).emit('room:closed')
    }
    for (const p of room.players) {
      if (p.socketId) {
        this.socketToRoomId.delete(p.socketId)
        const sock = this.io.sockets.sockets.get(p.socketId)
        sock?.leave(`room:${room.id}`)
      }
    }
    for (const s of room.spectators) {
      this.spectatorToRoomId.delete(s.socketId)
      const sock = this.io.sockets.sockets.get(s.socketId)
      sock?.leave(`room:${room.id}`)
    }
    room.spectators = []
    this.roomsById.delete(room.id)
    this.roomsByCode.delete(room.code)
    this.releaseHostSlot(room.creatorSubjectId)
  }

  private makeCode(): string {
    for (let i = 0; i < 50; i++) {
      const c = randomCode(6)
      if (!this.roomsByCode.has(c)) return c
    }
    return randomCode(8)
  }

  private startIdleTimer(room: ManagedRoom): void {
    if (room.idleTimer) clearTimeout(room.idleTimer)
    room.idleTimer = setTimeout(() => {
      const r = this.roomsById.get(room.id)
      if (!r || r.phase !== 'waiting' || r.players.length !== 1) return
      this.destroyRoom(r, true)
    }, IDLE_CLOSE_MS)
  }

  private cancelIdleTimer(room: ManagedRoom): void {
    if (room.idleTimer) {
      clearTimeout(room.idleTimer)
      room.idleTimer = undefined
    }
  }

  private buildPlayersPayload(room: ManagedRoom): RoomJoinedPlayer[] {
    const host = room.players.find((p) => p.isHost)
    const guest = room.players.find((p) => !p.isHost)
    const out: RoomJoinedPlayer[] = []
    if (host) out.push({ nickname: host.nickname, side: 'left' })
    if (guest) out.push({ nickname: guest.nickname, side: 'right' })
    return out
  }

  private emitRoomJoined(room: ManagedRoom): void {
    const players = this.buildPlayersPayload(room)
    const lobbyChat = [...room.lobbyChat]
    for (const p of room.players) {
      if (!p.socketId) continue
      const side: 'left' | 'right' = p.isHost ? 'left' : 'right'
      this.io.to(p.socketId).emit('room:joined', {
        side,
        players,
        lobbyChat,
      })
    }
  }

  private emitRematchState(room: ManagedRoom): void {
    for (const p of room.players) {
      if (!p.socketId) continue
      const youReady = room.rematchReady.has(p.socketId)
      const peer = room.players.find((o) => o !== p)
      const peerReady = peer?.socketId ? room.rematchReady.has(peer.socketId) : false
      this.io.to(p.socketId).emit('room:rematch:state', { youReady, peerReady })
    }
  }

  private startCountdown(room: ManagedRoom): void {
    this.cancelIdleTimer(room)
    if (room.countdownTimer) clearInterval(room.countdownTimer)
    room.phase = 'countdown'
    let seconds = COUNTDOWN_SECONDS
    const tick = (): void => {
      this.io.to(`room:${room.id}`).emit('room:countdown', { seconds })
      if (seconds <= 0) {
        if (room.countdownTimer) clearInterval(room.countdownTimer)
        room.countdownTimer = undefined
        this.finishCountdown(room)
        return
      }
      seconds -= 1
    }
    tick()
    room.countdownTimer = setInterval(tick, 1000)
  }

  private finishCountdown(room: ManagedRoom): void {
    const r = this.roomsById.get(room.id)
    if (!r || r.phase !== 'countdown') return
    r.phase = 'playing'
    r.matchChat = []
    const host = r.players.find((p) => p.isHost)
    const guest = r.players.find((p) => !p.isHost)
    if (!host || !guest) return
    r.rematchReady.clear()
    r.match = new MatchController(this.io, r.id, host.socketId!, guest.socketId!, {
      onStopped: () => {
        r.match = undefined
      },
      onOver: (p) => {
        if (p.doubleDefeat) {
          void persistOnlineDoubleDefeat(r, p.sets, p.reason)
          r.phase = 'result'
          r.rematchReady.clear()
          this.destroyRoom(r, true)
          return
        }
        if (p.winner !== null) {
          void persistOnlineMatch(r, p.winner, p.sets, p.reason)
        }
        r.phase = 'result'
        r.rematchReady.clear()
        r.players = r.players.filter((pl) => pl.socketId !== null)
        if (r.players.length === 0) {
          this.destroyRoom(r, true)
          return
        }
        this.emitRematchState(r)
      },
    })
    this.emitPublicSpectatorCount(r)
  }

  createRoom(
    socketId: string,
    nickname: string,
    subjectId: string,
    authType: AuthKind,
    ip: string,
  ): ManagedRoom | { error: string; message: string } {
    const gate = this.canCreateRoom(ip, subjectId)
    if (!gate.ok) return { error: gate.code, message: gate.message }

    const id = randomUUID()
    const code = this.makeCode()
    const room: ManagedRoom = {
      id,
      code,
      creatorSubjectId: subjectId,
      hostSubjectId: subjectId,
      players: [
        {
          socketId,
          nickname,
          subjectId,
          authType,
          isHost: true,
        },
      ],
      spectators: [],
      rematchReady: new Set(),
      phase: 'waiting',
      lobbyChat: [],
      matchChat: [],
      createdAt: Date.now(),
    }
    this.roomsById.set(id, room)
    this.roomsByCode.set(code, room)
    this.socketToRoomId.set(socketId, id)
    this.registerRoomCreate(ip, subjectId)
    this.startIdleTimer(room)
    return room
  }

  joinRoom(
    socketId: string,
    codeRaw: string,
    nickname: string,
    subjectId: string,
    authType: AuthKind,
  ): ManagedRoom | { error: string; message: string } {
    const code = codeRaw.trim().toUpperCase()
    const room = this.roomsByCode.get(code)
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: 'Комната не найдена' }
    }
    if (room.phase === 'playing') {
      return { error: 'INVALID_PHASE', message: 'Матч уже идёт' }
    }
    if (room.players.length >= 2) {
      return { error: 'ROOM_FULL', message: 'Комната заполнена' }
    }
    if (room.players.some((p) => p.socketId === socketId)) {
      return { error: 'INVALID_PHASE', message: 'Вы уже в комнате' }
    }

    room.players.push({
      socketId,
      nickname,
      subjectId,
      authType,
      isHost: false,
    })
    this.socketToRoomId.set(socketId, room.id)
    this.cancelIdleTimer(room)

    if (room.players.length === 2) {
      if (room.phase === 'waiting') {
        this.startCountdown(room)
      } else if (room.phase === 'result') {
        this.emitRoomJoined(room)
      } else {
        this.emitRoomJoined(room)
      }
    }

    return room
  }

  joinAsSpectator(
    socketId: string,
    codeRaw: string,
    nickname: string,
    subjectId: string,
  ): ManagedRoom | { error: string; message: string } {
    const code = codeRaw.trim().toUpperCase()
    const room = this.roomsByCode.get(code)
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: 'Комната не найдена' }
    }
    if (room.phase !== 'playing' && room.phase !== 'result') {
      return {
        error: 'INVALID_PHASE',
        message: 'Матч ещё не начался. Ожидайте начала.',
      }
    }
    if (this.nonAdminSpectatorCount(room) >= MAX_SPECTATORS) {
      return { error: 'SPECTATORS_FULL', message: 'Наблюдателей не больше двух' }
    }
    if (room.players.some((p) => p.socketId === socketId)) {
      return { error: 'INVALID_PHASE', message: 'Вы уже в комнате как игрок' }
    }
    if (room.spectators.some((s) => s.socketId === socketId)) {
      return { error: 'INVALID_PHASE', message: 'Вы уже наблюдаете' }
    }

    const spec: RoomSpectator = { socketId, nickname, subjectId }
    room.spectators.push(spec)
    this.spectatorToRoomId.set(socketId, room.id)
    this.attachSocketToRoom(socketId, room.id)

    this.io.to(socketId).emit('spectator:joined', {
      players: this.buildPlayersPayload(room),
      phase: room.phase,
      matchChat: [...room.matchChat],
    })
    this.emitPublicSpectatorCount(room)

    const m = room.match
    if (room.phase === 'playing' && m) {
      const initialState = m.getWireState()
      this.io.to(socketId).emit('game:start', { initialState })
    }

    return room
  }

  joinAsAdminSpectator(
    socketId: string,
    codeRaw: string,
    nickname: string,
    subjectId: string,
  ): ManagedRoom | { error: string; message: string } {
    const code = codeRaw.trim().toUpperCase()
    const room = this.roomsByCode.get(code)
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: 'Комната не найдена' }
    }
    if (room.phase !== 'playing' && room.phase !== 'result') {
      return {
        error: 'INVALID_PHASE',
        message: 'Матч ещё не начался. Ожидайте начала.',
      }
    }
    if (room.players.some((p) => p.socketId === socketId)) {
      return { error: 'INVALID_PHASE', message: 'Вы уже в комнате как игрок' }
    }
    if (room.spectators.some((s) => s.socketId === socketId)) {
      return { error: 'INVALID_PHASE', message: 'Вы уже наблюдаете' }
    }

    const spec: RoomSpectator = { socketId, nickname, subjectId, isAdmin: true }
    room.spectators.push(spec)
    this.spectatorToRoomId.set(socketId, room.id)
    this.attachSocketToRoom(socketId, room.id)

    this.io.to(socketId).emit('spectator:joined', {
      players: this.buildPlayersPayload(room),
      phase: room.phase,
      matchChat: [...room.matchChat],
    })

    const m = room.match
    if (room.phase === 'playing' && m) {
      const initialState = m.getWireState()
      this.io.to(socketId).emit('game:start', { initialState })
    }

    return room
  }

  leaveSpectator(socketId: string): void {
    const roomId = this.spectatorToRoomId.get(socketId)
    if (!roomId) return
    const room = this.roomsById.get(roomId)
    this.spectatorToRoomId.delete(socketId)
    if (!room) return
    room.spectators = room.spectators.filter((s) => s.socketId !== socketId)
    const sock = this.io.sockets.sockets.get(socketId)
    sock?.leave(`room:${room.id}`)
    this.emitPublicSpectatorCount(room)
  }

  handleRematch(socketId: string): void {
    const room = this.getRoomBySocket(socketId)
    if (!room || room.phase !== 'result') return
    if (!room.players.some((p) => p.socketId !== null && p.socketId === socketId)) return
    room.rematchReady.add(socketId)
    this.emitRematchState(room)
    if (room.rematchReady.size >= 2 && room.players.length === 2) {
      room.rematchReady.clear()
      this.startCountdown(room)
    }
  }

  handleGameInputMove(socketId: string, payload: { dx?: unknown; dy?: unknown }): void {
    const room = this.getRoomBySocket(socketId)
    if (!room?.match) return
    const dx = typeof payload.dx === 'number' ? payload.dx : 0
    const dy = typeof payload.dy === 'number' ? payload.dy : 0
    room.match.setMove(socketId, dx, dy)
  }

  handleGameInputIndicator(socketId: string, payload: { phase?: unknown; value?: unknown }): void {
    const room = this.getRoomBySocket(socketId)
    if (!room?.match) return
    const ph = payload.phase
    const v = payload.value
    if (ph !== 'direction' && ph !== 'power') return
    if (typeof v !== 'number') return
    room.match.applyIndicator(socketId, ph, v)
  }

  handleGameInputServeReady(socketId: string): void {
    const room = this.getRoomBySocket(socketId)
    if (!room?.match) return
    room.match.confirmServeReady(socketId)
  }

  /** Явный выход (кнопка «Выйти» / room:leave). */
  leaveRoomPlayerIntentional(socketId: string): void {
    const room = this.getRoomBySocket(socketId)
    if (!room) return
    if (room.phase === 'playing' && room.match) {
      room.match.intentionalForfeit(socketId)
    }
    this.finalizePlayerRemovedFromRoom(socketId, room)
  }

  /** Обрыв TCP: в матче — пауза и слот с null socketId; в лобби — как раньше убираем игрока. */
  handleTransportDisconnect(socketId: string): void {
    const room = this.getRoomBySocket(socketId)
    if (!room) return
    if (room.phase === 'playing' && room.match) {
      const player = room.players.find((p) => p.socketId === socketId)
      if (!player) return
      room.match.onTransportDisconnect(socketId)
      player.socketId = null
      this.socketToRoomId.delete(socketId)
      this.io.sockets.sockets.get(socketId)?.leave(`room:${room.id}`)
      return
    }
    this.finalizePlayerRemovedFromRoom(socketId, room)
  }

  rejoinMatch(
    socketId: string,
    codeRaw: string,
    nickname: string,
    subjectId: string,
  ): ManagedRoom | { error: string; message: string } {
    const code = codeRaw.trim().toUpperCase()
    const room = this.roomsByCode.get(code)
    if (!room || room.phase !== 'playing' || !room.match) {
      return { error: 'INVALID_PHASE', message: 'Нет активного матча для переподключения' }
    }
    const player = room.players.find((p) => p.subjectId === subjectId && p.socketId === null)
    if (!player) {
      return { error: 'NOT_IN_ROOM', message: 'Слот переподключения не найден' }
    }
    if (player.nickname !== nickname) {
      return { error: 'VALIDATION_ERROR', message: 'Никнейм не совпадает с комнатой' }
    }
    player.socketId = socketId
    this.socketToRoomId.set(socketId, room.id)
    this.attachSocketToRoom(socketId, room.id)
    const side: Side = player.isHost ? 'left' : 'right'
    room.match.rebindSocket(socketId, side)
    room.match.onSideReconnected(side)
    const initialState = room.match.getWireState()
    this.io.to(socketId).emit('room:rejoined', {})
    this.io.to(socketId).emit('game:resync', { initialState })
    return room
  }

  private finalizePlayerRemovedFromRoom(socketId: string, room: ManagedRoom): void {
    const player = room.players.find((p) => p.socketId === socketId)
    if (!player) return

    room.rematchReady.delete(socketId)

    const wasHost = player.isHost
    const hadTwo = room.players.length === 2
    room.players = room.players.filter((p) => p.socketId !== socketId)
    this.socketToRoomId.delete(socketId)
    const sock = this.io.sockets.sockets.get(socketId)
    sock?.leave(`room:${room.id}`)

    if (room.players.length === 0) {
      this.destroyRoom(room, true)
      return
    }

    if (wasHost && !hadTwo) {
      this.destroyRoom(room, true)
      return
    }

    if (wasHost && hadTwo) {
      const other = room.players[0]
      if (other) {
        other.isHost = true
        room.hostSubjectId = other.subjectId
      }
    }

    if (room.phase === 'countdown') {
      this.emitRoomJoined(room)
    } else if (room.phase === 'waiting') {
      this.emitRoomJoined(room)
      this.startIdleTimer(room)
    } else if (room.phase === 'result') {
      this.emitRematchState(room)
    }
  }

  appendChat(socketId: string, textRaw: string): LobbyChatMessage | { error: string; message: string } {
    const room = this.getRoomBySocket(socketId)
    if (!room) {
      return { error: 'NOT_IN_ROOM', message: 'Вы не в комнате' }
    }
    const text = textRaw.trim()
    if (!text) {
      return { error: 'VALIDATION_ERROR', message: 'Пустое сообщение' }
    }
    if (text.length > CHAT_MAX_LEN) {
      return { error: 'VALIDATION_ERROR', message: `Не больше ${CHAT_MAX_LEN} символов` }
    }

    const now = Date.now()
    const arr = this.chatTimestampsBySocket.get(socketId) ?? []
    const fresh = arr.filter((t) => now - t < CHAT_WINDOW_MS)
    fresh.push(now)
    this.chatTimestampsBySocket.set(socketId, fresh)
    if (fresh.length > CHAT_MAX_PER_WINDOW) {
      return {
        error: 'RATE_LIMITED',
        message: 'Не больше трёх сообщений за 5 секунд. Подождите немного.',
      }
    }

    const player = room.players.find((p) => p.socketId === socketId)
    const spectator = room.spectators.find((s) => s.socketId === socketId)
    const from = player?.nickname ?? spectator?.nickname ?? '?'
    const masked = maskBannedWords(text)
    const msg: LobbyChatMessage = { from, text: masked, timestamp: now }
    if (room.phase === 'waiting' || room.phase === 'countdown') {
      room.lobbyChat.push(msg)
    } else if (room.phase === 'playing' || room.phase === 'result') {
      room.matchChat.push(msg)
    }
    this.io.to(`room:${room.id}`).emit('chat:message', msg)
    return msg
  }

  appendReaction(
    socketId: string,
    typeRaw: string | undefined,
  ):
    | { from: string; type: ReactionType; timestamp: number; anchor: 'left' | 'right' | 'spectator' }
    | { error: string; message: string } {
    const room = this.getRoomBySocket(socketId)
    if (!room) {
      return { error: 'NOT_IN_ROOM', message: 'Вы не в комнате' }
    }
    if (typeof typeRaw !== 'string' || !REACTION_TYPES.has(typeRaw as ReactionType)) {
      return { error: 'VALIDATION_ERROR', message: 'Неизвестная реакция' }
    }
    const type = typeRaw as ReactionType
    const now = Date.now()
    const last = this.reactionLastBySocket.get(socketId) ?? 0
    if (now - last < REACTION_COOLDOWN_MS) {
      return {
        error: 'RATE_LIMITED',
        message: 'Реакцию можно отправить раз в 5 секунд.',
      }
    }
    this.reactionLastBySocket.set(socketId, now)

    const player = room.players.find((p) => p.socketId === socketId)
    const spectator = room.spectators.find((s) => s.socketId === socketId)
    const from = player?.nickname ?? spectator?.nickname ?? '?'
    let anchor: 'left' | 'right' | 'spectator'
    if (player) {
      anchor = player.isHost ? 'left' : 'right'
    } else {
      anchor = 'spectator'
    }
    const payload = { from, type, timestamp: now, anchor }
    this.io.to(`room:${room.id}`).emit('chat:reaction', payload)
    return payload
  }

  attachSocketToRoom(socketId: string, roomId: string): void {
    const sock = this.io.sockets.sockets.get(socketId)
    sock?.join(`room:${roomId}`)
  }

  emitCreated(socketId: string, room: ManagedRoom): void {
    this.io.to(socketId).emit('room:created', { code: room.code, roomId: room.id })
    this.attachSocketToRoom(socketId, room.id)
    this.emitRoomJoined(room)
  }

  emitJoined(socketId: string, room: ManagedRoom): void {
    this.attachSocketToRoom(socketId, room.id)
    this.emitRoomJoined(room)
  }
}

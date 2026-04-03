import type { Server, Socket } from 'socket.io'
import { verifyAccessToken, type AccessClaims } from '../auth/jwt'
import { NicknameValidationError, validateNickname } from '../auth/nickname'
import { RoomManager } from '../rooms/RoomManager'

function socketError(socket: Socket, code: string, message: string): void {
  socket.emit('error', { code, message })
}

function readNickname(_socket: Socket, raw: unknown): string {
  const auth = _socket.data.auth as AccessClaims
  if (typeof raw === 'string' && raw.trim()) {
    const n = validateNickname(raw)
    if (n !== auth.nickname) {
      throw new NicknameValidationError('Никнейм должен совпадать с вашей сессией')
    }
    return n
  }
  return auth.nickname
}

export function registerLobbySocket(io: Server): void {
  const rooms = new RoomManager(io)

  io.use((socket, next) => {
    try {
      const authHeader = socket.handshake.auth as { token?: string } | undefined
      const q = socket.handshake.query.token
      const token =
        (typeof authHeader?.token === 'string' && authHeader.token) ||
        (typeof q === 'string' && q) ||
        (Array.isArray(q) && typeof q[0] === 'string' ? q[0] : undefined)
      if (!token) {
        next(new Error('UNAUTHORIZED'))
        return
      }
      const claims = verifyAccessToken(token)
      ;(socket.data as { auth: AccessClaims }).auth = claims
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket) => {
    const auth = socket.data.auth as AccessClaims

    socket.on('room:create', (payload: { nickname?: string }) => {
      try {
        const nickname = readNickname(socket, payload?.nickname)
        const ip =
          typeof socket.handshake.headers['x-forwarded-for'] === 'string'
            ? socket.handshake.headers['x-forwarded-for'].split(',')[0]!.trim()
            : socket.handshake.address ?? 'unknown'
        const created = rooms.createRoom(socket.id, nickname, auth.sub, auth.typ, ip)
        if ('error' in created) {
          socketError(socket, created.error, created.message)
          return
        }
        rooms.emitCreated(socket.id, created)
      } catch (e) {
        if (e instanceof NicknameValidationError) {
          socketError(socket, 'VALIDATION_ERROR', e.message)
          return
        }
        socketError(socket, 'INTERNAL_ERROR', 'Не удалось создать комнату')
      }
    })

    socket.on('room:join', (payload: { code?: string; nickname?: string }) => {
      try {
        const code = payload?.code
        if (typeof code !== 'string' || !code.trim()) {
          socketError(socket, 'VALIDATION_ERROR', 'Укажите код комнаты')
          return
        }
        const nickname = readNickname(socket, payload?.nickname)
        const joined = rooms.joinRoom(socket.id, code, nickname, auth.sub, auth.typ)
        if ('error' in joined) {
          socketError(socket, joined.error, joined.message)
          return
        }
        rooms.emitJoined(socket.id, joined)
      } catch (e) {
        if (e instanceof NicknameValidationError) {
          socketError(socket, 'VALIDATION_ERROR', e.message)
          return
        }
        socketError(socket, 'INTERNAL_ERROR', 'Не удалось войти в комнату')
      }
    })

    socket.on('room:leave', () => {
      rooms.leaveSpectator(socket.id)
      rooms.leaveSocket(socket.id)
    })

    socket.on('room:rematch', () => {
      rooms.handleRematch(socket.id)
    })

    socket.on('game:input:move', (payload: { dx?: number; dy?: number } | undefined) => {
      rooms.handleGameInputMove(socket.id, payload ?? {})
    })

    socket.on('game:input:indicator', (payload: { phase?: string; value?: number } | undefined) => {
      rooms.handleGameInputIndicator(socket.id, payload ?? {})
    })

    socket.on('chat:message', (payload: { text?: string }) => {
      const text = payload?.text
      if (typeof text !== 'string') {
        socketError(socket, 'VALIDATION_ERROR', 'Неверный формат сообщения')
        return
      }
      const msg = rooms.appendChat(socket.id, text)
      if ('error' in msg) {
        socketError(socket, msg.error, msg.message)
        return
      }
      const room = rooms.getRoomBySocket(socket.id)
      if (room) {
        io.to(`room:${room.id}`).emit('chat:message', msg)
      }
    })

    socket.on('spectator:join', (payload: { code?: string }) => {
      try {
        const code = payload?.code
        if (typeof code !== 'string' || !code.trim()) {
          socketError(socket, 'VALIDATION_ERROR', 'Укажите код комнаты')
          return
        }
        const nickname = readNickname(socket, undefined)
        const joined = rooms.joinAsSpectator(socket.id, code, nickname, auth.sub)
        if ('error' in joined) {
          socketError(socket, joined.error, joined.message)
        }
      } catch (e) {
        if (e instanceof NicknameValidationError) {
          socketError(socket, 'VALIDATION_ERROR', e.message)
          return
        }
        socketError(socket, 'INTERNAL_ERROR', 'Не удалось подключиться как наблюдатель')
      }
    })

    socket.on('disconnect', () => {
      rooms.leaveSpectator(socket.id)
      rooms.leaveSocket(socket.id)
    })
  })
}

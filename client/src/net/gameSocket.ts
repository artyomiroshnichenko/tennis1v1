import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function disconnectGameSocket(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
}

export function getGameSocket(accessToken: string): Socket {
  if (socket?.connected) {
    socket.auth = { token: accessToken }
    return socket
  }
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
  }
  socket = io({
    path: '/socket.io',
    auth: { token: accessToken },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  })
  return socket
}

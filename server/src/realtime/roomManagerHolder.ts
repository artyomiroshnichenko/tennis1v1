import type { RoomManager } from '../rooms/RoomManager'

let instance: RoomManager | null = null
let botSessionsCount: () => number = () => 0

export function setRoomManagerInstance(rm: RoomManager): void {
  instance = rm
}

export function getRoomManagerInstance(): RoomManager | null {
  return instance
}

export function setBotSessionsCounter(fn: () => number): void {
  botSessionsCount = fn
}

export function getBotSessionsCount(): number {
  return botSessionsCount()
}

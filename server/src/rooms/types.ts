import type { MatchController } from '../game/MatchController'

export type RoomPhase = 'waiting' | 'countdown' | 'playing'

export type LobbyChatMessage = {
  from: string
  text: string
  timestamp: number
}

export type LobbyPlayer = {
  socketId: string
  nickname: string
  subjectId: string
  isHost: boolean
}

export type ManagedRoom = {
  id: string
  code: string
  /** Кто создал комнату — для лимита активных комнат */
  creatorSubjectId: string
  /** Текущий хост в лобби (может смениться) */
  hostSubjectId: string
  players: LobbyPlayer[]
  phase: RoomPhase
  lobbyChat: LobbyChatMessage[]
  createdAt: number
  countdownTimer?: ReturnType<typeof setInterval>
  idleTimer?: ReturnType<typeof setTimeout>
  match?: MatchController
}

export type RoomJoinedPlayer = { nickname: string; side: 'left' | 'right' }

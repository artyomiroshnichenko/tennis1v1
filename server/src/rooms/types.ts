import type { MatchController } from '../game/MatchController'

export type RoomPhase = 'waiting' | 'countdown' | 'playing' | 'result'

export type AuthKind = 'guest' | 'user'

export type LobbyChatMessage = {
  from: string
  text: string
  timestamp: number
}

export type LobbyPlayer = {
  socketId: string
  nickname: string
  subjectId: string
  authType: AuthKind
  isHost: boolean
}

export type RoomSpectator = {
  socketId: string
  nickname: string
  subjectId: string
}

export type ManagedRoom = {
  id: string
  code: string
  /** Кто создал комнату — для лимита активных комнат */
  creatorSubjectId: string
  /** Текущий хост в лобби (может смениться) */
  hostSubjectId: string
  players: LobbyPlayer[]
  spectators: RoomSpectator[]
  /** Сокеты игроков, нажавших «Сыграть ещё раз» */
  rematchReady: Set<string>
  phase: RoomPhase
  lobbyChat: LobbyChatMessage[]
  /** Сообщения с начала текущего матча (playing + result) — для поздних наблюдателей */
  matchChat: LobbyChatMessage[]
  createdAt: number
  countdownTimer?: ReturnType<typeof setInterval>
  idleTimer?: ReturnType<typeof setTimeout>
  match?: MatchController
}

export type RoomJoinedPlayer = { nickname: string; side: 'left' | 'right' }

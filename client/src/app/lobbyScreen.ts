import { getGameSocket, disconnectGameSocket } from '../net/gameSocket'
import { LS_ACCESS } from '../sessionKeys'
import { startPhaserPlaceholder } from '../game/startPhaser'
import type { Socket } from 'socket.io-client'
import '../ui/lobby.css'

export type LobbyHooks = {
  onLeave: () => void
  nickname: string
}

type ChatLine = { from: string; text: string; timestamp: number }

let waitTimer: ReturnType<typeof setInterval> | null = null

function clearWaitTimer(): void {
  if (waitTimer) {
    clearInterval(waitTimer)
    waitTimer = null
  }
}

function formatWait(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function whenConnected(sock: Socket, fn: () => void): void {
  if (sock.connected) fn()
  else sock.once('connect', fn)
}

function clearRoomQueryParam(): void {
  const u = new URL(window.location.href)
  if (!u.searchParams.has('room')) return
  u.searchParams.delete('room')
  window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash)
}

function setRoomQueryParam(code: string): void {
  const u = new URL(window.location.href)
  u.searchParams.set('room', code)
  window.history.replaceState({}, '', u.toString())
}

function mountLobbyShell(
  root: HTMLElement,
  hooks: LobbyHooks,
  opts: { showInvite: boolean },
): {
  setErr: (t: string) => void
  setCode: (c: string) => void
  setPlayers: (players: Array<{ nickname: string; side: string }>) => void
  setCountdown: (n: number | null) => void
  pushMsg: (m: ChatLine) => void
  setMsgs: (m: ChatLine[]) => void
  getChatInput: () => string
  clearChatInput: () => void
  focusInput: () => void
} {
  const waitStarted = Date.now()

  root.style.display = 'block'
  root.innerHTML = `
    <div class="lobby-header">
      <h1>Лобби</h1>
      <button type="button" class="btn-secondary" id="lobby-leave">Выйти</button>
    </div>
    <div class="lobby-anim" aria-hidden="true">
      <div class="player"></div>
      <div class="racket"></div>
      <div class="ball"></div>
    </div>
    <p class="lobby-wait">Ожидание соперника: <strong id="lobby-wait-dur">0:00</strong></p>
    <div class="lobby-countdown" id="lobby-countdown" style="display:none"></div>
    <div class="lobby-invite" id="lobby-invite-wrap" style="display:none">
      <label>Приглашение</label>
      <div class="row">
        <code id="lobby-invite-url"></code>
        <button type="button" class="btn-icon" id="lobby-copy">Копировать</button>
      </div>
    </div>
    <div class="lobby-players" id="lobby-players"></div>
    <p class="lobby-err" id="lobby-err"></p>
    <div class="lobby-chat">
      <div class="lobby-chat-msgs" id="lobby-msgs"></div>
      <div class="lobby-chat-input">
        <input type="text" id="lobby-input" maxlength="500" placeholder="Сообщение…" autocomplete="off" />
        <button type="button" class="btn-primary" id="lobby-send">Отправить</button>
      </div>
    </div>
  `

  const errEl = root.querySelector('#lobby-err') as HTMLElement
  const waitEl = root.querySelector('#lobby-wait-dur') as HTMLElement
  const inviteWrap = root.querySelector('#lobby-invite-wrap') as HTMLElement
  const inviteUrlEl = root.querySelector('#lobby-invite-url') as HTMLElement
  const playersEl = root.querySelector('#lobby-players') as HTMLElement
  const countdownEl = root.querySelector('#lobby-countdown') as HTMLElement
  const msgsEl = root.querySelector('#lobby-msgs') as HTMLElement
  const inputEl = root.querySelector('#lobby-input') as HTMLInputElement

  if (!opts.showInvite) {
    inviteWrap.style.display = 'none'
  }

  clearWaitTimer()
  waitTimer = setInterval(() => {
    waitEl.textContent = formatWait(Date.now() - waitStarted)
  }, 500)

  root.querySelector('#lobby-leave')?.addEventListener('click', () => {
    hooks.onLeave()
  })

  root.querySelector('#lobby-copy')?.addEventListener('click', async () => {
    const t = inviteUrlEl.textContent ?? ''
    try {
      await navigator.clipboard.writeText(t)
    } catch {
      /* ignore */
    }
  })

  function appendMsgLine(m: ChatLine): void {
    const div = document.createElement('div')
    div.className = 'msg'
    const who = document.createElement('span')
    who.className = 'who'
    who.textContent = m.from
    const body = document.createElement('span')
    body.textContent = `: ${m.text} `
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = new Date(m.timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })
    div.append(who, body, time)
    msgsEl.appendChild(div)
    msgsEl.scrollTop = msgsEl.scrollHeight
  }

  function renderMsgs(list: ChatLine[]): void {
    msgsEl.innerHTML = ''
    for (const m of list) appendMsgLine(m)
  }

  function setPlayersSafe(players: Array<{ nickname: string; side: string }>): void {
    playersEl.textContent = ''
    if (!players.length) return
    playersEl.append('Игроки: ')
    players.forEach((p, i) => {
      if (i > 0) playersEl.append(' · ')
      const sp = document.createElement('span')
      sp.textContent = p.nickname
      playersEl.appendChild(sp)
      playersEl.append(` (${p.side === 'left' ? 'хозяин' : 'гость'})`)
    })
  }

  return {
    setErr: (t) => {
      errEl.textContent = t
    },
    setCode: (c) => {
      if (!opts.showInvite) return
      inviteWrap.style.display = 'block'
      const u = new URL(window.location.href)
      u.searchParams.set('room', c)
      inviteUrlEl.textContent = u.toString()
      setRoomQueryParam(c)
    },
    setPlayers: setPlayersSafe,
    setCountdown: (n) => {
      if (n === null) {
        countdownEl.style.display = 'none'
        countdownEl.textContent = ''
        return
      }
      countdownEl.style.display = 'block'
      countdownEl.textContent = n > 0 ? String(n) : 'Старт!'
    },
    pushMsg: appendMsgLine,
    setMsgs: renderMsgs,
    getChatInput: () => inputEl.value,
    clearChatInput: () => {
      inputEl.value = ''
    },
    focusInput: () => inputEl.focus(),
  }
}

function wireLobbySocket(
  sock: Socket,
  ui: ReturnType<typeof mountLobbyShell>,
  lobbyRoot: HTMLElement,
  gameRootId: string,
  nickname: string,
  afterLeaveUi: () => void,
  userLeave: () => void,
  onGameEndNav: () => void,
): void {
  let chatLines: ChatLine[] = []

  sock.on('error', (payload: { code?: string; message?: string }) => {
    const msg = payload?.message ?? 'Ошибка'
    ui.setErr(msg)
    if (payload?.code === 'ROOM_FULL' || payload?.code === 'ROOM_NOT_FOUND') {
      setTimeout(() => userLeave(), 2200)
    }
  })

  sock.on('connect_error', () => {
    ui.setErr('Не удалось подключиться к серверу')
  })

  sock.on('room:created', (payload: { code: string }) => {
    ui.setCode(payload.code)
  })

  sock.on(
    'room:joined',
    (payload: {
      players: Array<{ nickname: string; side: string }>
      lobbyChat?: ChatLine[]
    }) => {
      ui.setPlayers(payload.players)
      if (payload.lobbyChat?.length) {
        chatLines = [...payload.lobbyChat]
        ui.setMsgs(chatLines)
      }
    },
  )

  sock.on('room:countdown', (payload: { seconds: number }) => {
    ui.setCountdown(payload.seconds)
  })

  sock.on('room:closed', () => {
    afterLeaveUi()
  })

  sock.on('chat:message', (msg: ChatLine) => {
    chatLines.push(msg)
    ui.pushMsg(msg)
  })

  sock.on('game:start', () => {
    clearWaitTimer()
    lobbyRoot.style.display = 'none'
    lobbyRoot.innerHTML = ''
    const gameEl = document.getElementById(gameRootId)
    if (gameEl) {
      gameEl.style.display = 'block'
      startPhaserPlaceholder(gameRootId, nickname, 'online')
    }
    let backBtn = document.getElementById('game-back') as HTMLButtonElement | null
    if (!backBtn) {
      backBtn = document.createElement('button')
      backBtn.id = 'game-back'
      backBtn.type = 'button'
      backBtn.className = 'btn-secondary'
      backBtn.textContent = 'На главную'
      document.body.appendChild(backBtn)
    }
    backBtn.style.display = 'block'
    backBtn.onclick = () => {
      sock.emit('room:leave')
      disconnectGameSocket()
      gameEl!.style.display = 'none'
      backBtn!.style.display = 'none'
      clearRoomQueryParam()
      onGameEndNav()
    }
  })

  const sendChat = (): void => {
    const text = ui.getChatInput().trim()
    if (!text) return
    sock.emit('chat:message', { text })
    ui.clearChatInput()
    ui.focusInput()
  }

  lobbyRoot.querySelector('#lobby-send')?.addEventListener('click', sendChat)
  lobbyRoot.querySelector('#lobby-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') sendChat()
  })
}

export async function openLobbyCreate(hooks: LobbyHooks): Promise<void> {
  const token = localStorage.getItem(LS_ACCESS)
  if (!token) throw new Error('Нет сессии')

  const app = document.getElementById('app')
  const lobbyRoot = document.getElementById('lobby')
  if (!lobbyRoot) throw new Error('Нет контейнера лобби')

  app!.style.display = 'none'
  disconnectGameSocket()
  const sock = getGameSocket(token)

  const afterLeaveUi = (): void => {
    clearWaitTimer()
    lobbyRoot.innerHTML = ''
    lobbyRoot.style.display = 'none'
    disconnectGameSocket()
    clearRoomQueryParam()
    app!.style.display = 'flex'
    hooks.onLeave()
  }

  const userLeave = (): void => {
    sock.emit('room:leave')
    afterLeaveUi()
  }

  const uiHooks: LobbyHooks = { nickname: hooks.nickname, onLeave: userLeave }
  const ui = mountLobbyShell(lobbyRoot, uiHooks, { showInvite: true })

  wireLobbySocket(
    sock,
    ui,
    lobbyRoot,
    'game',
    hooks.nickname,
    afterLeaveUi,
    userLeave,
    hooks.onLeave,
  )

  whenConnected(sock, () => {
    ui.setErr('')
    sock.emit('room:create', { nickname: hooks.nickname })
  })
}

export async function openLobbyJoin(hooks: LobbyHooks & { code: string }): Promise<void> {
  const token = localStorage.getItem(LS_ACCESS)
  if (!token) throw new Error('Нет сессии')

  const app = document.getElementById('app')
  const lobbyRoot = document.getElementById('lobby')
  if (!lobbyRoot) throw new Error('Нет контейнера лобби')

  const code = hooks.code.trim().toUpperCase()
  app!.style.display = 'none'
  disconnectGameSocket()
  const sock = getGameSocket(token)

  const afterLeaveUi = (): void => {
    clearWaitTimer()
    lobbyRoot.innerHTML = ''
    lobbyRoot.style.display = 'none'
    disconnectGameSocket()
    clearRoomQueryParam()
    app!.style.display = 'flex'
    hooks.onLeave()
  }

  const userLeave = (): void => {
    sock.emit('room:leave')
    afterLeaveUi()
  }

  const uiHooks: LobbyHooks = { nickname: hooks.nickname, onLeave: userLeave }
  const ui = mountLobbyShell(lobbyRoot, uiHooks, { showInvite: false })

  wireLobbySocket(
    sock,
    ui,
    lobbyRoot,
    'game',
    hooks.nickname,
    afterLeaveUi,
    userLeave,
    hooks.onLeave,
  )

  whenConnected(sock, () => {
    ui.setErr('')
    sock.emit('room:join', { code, nickname: hooks.nickname })
  })
}

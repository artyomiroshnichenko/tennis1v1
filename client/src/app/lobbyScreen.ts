import { getGameSocket, disconnectGameSocket } from '../net/gameSocket'
import { LS_ACCESS } from '../sessionKeys'
import { destroyGame, startOnlineMatch } from '../game/startPhaser'
import type { Side } from '../game/gameTypes'
import type { Socket } from 'socket.io-client'
import { mountRoomChat, showRoomToast, type ChatLine } from '../ui/roomChat'
import '../ui/lobby.css'

function formatSetsDisplay(sets: [number, number][]): string {
  if (!sets.length) return ''
  return sets.map(([a, b]) => `${a}–${b}`).join(', ')
}

function showGameCountdownBanner(gameEl: HTMLElement, seconds: number): void {
  let el = gameEl.querySelector('#match-rematch-countdown') as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = 'match-rematch-countdown'
    el.style.cssText =
      'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:35;padding:8px 16px;border-radius:10px;background:rgba(20,20,40,0.92);color:#e8e8f0;font:15px system-ui,sans-serif;'
    gameEl.appendChild(el)
  }
  el.textContent = seconds > 0 ? `Новый матч через ${seconds}…` : 'Старт!'
  el.style.display = 'block'
  if (seconds <= 0) {
    setTimeout(() => el?.remove(), 700)
  }
}

function setGameBackVisible(visible: boolean): void {
  const b = document.getElementById('game-back') as HTMLButtonElement | null
  if (b) b.style.display = visible ? 'block' : 'none'
}

export type LobbyHooks = {
  onLeave: () => void
  nickname: string
}

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

function updateSpectatorCountBadge(gameEl: HTMLElement, count: number): void {
  let el = gameEl.querySelector('#spectator-count-badge') as HTMLElement | null
  if (count <= 0) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'spectator-count-badge'
    el.style.cssText =
      'position:absolute;top:48px;right:12px;z-index:50;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;background:rgba(20,20,40,0.9);color:#c8c8e0;font:14px system-ui,sans-serif;'
    el.setAttribute('aria-live', 'polite')
    el.title = 'Наблюдатели в комнате'
    gameEl.appendChild(el)
  }
  el.textContent = `👁 ${count}`
}

function removeSpectatorCountBadge(gameEl: HTMLElement): void {
  gameEl.querySelector('#spectator-count-badge')?.remove()
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

function setMatchSessionKeys(code: string): void {
  sessionStorage.setItem('tennis_room_code', code)
  sessionStorage.setItem('tennis_match_active', '1')
}

function clearMatchSessionKeys(): void {
  sessionStorage.removeItem('tennis_room_code')
  sessionStorage.removeItem('tennis_match_active')
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
      <label>Приглашение игроку</label>
      <div class="row">
        <code id="lobby-invite-url"></code>
        <button type="button" class="btn-icon" id="lobby-copy">Копировать</button>
      </div>
      <label style="margin-top:10px">Ссылка для зрителя</label>
      <div class="row">
        <code id="lobby-invite-watch-url"></code>
        <button type="button" class="btn-icon" id="lobby-copy-watch">Копировать</button>
      </div>
    </div>
    <div class="lobby-players" id="lobby-players"></div>
    <p class="lobby-err" id="lobby-err"></p>
    <div class="lobby-chat" id="lobby-chat-wrap">
      <div class="lobby-chat-head">
        <button type="button" class="btn-secondary" id="lobby-chat-toggle">Свернуть чат</button>
        <span class="lobby-chat-unread" id="lobby-chat-unread" aria-hidden="true"></span>
      </div>
      <div class="lobby-chat-body" id="lobby-chat-body">
        <div class="lobby-chat-msgs" id="lobby-msgs"></div>
        <div class="lobby-reactions" id="lobby-reactions">
          <button type="button" data-chat-reaction="heart" title="Сердечко">❤️</button>
          <button type="button" data-chat-reaction="fire" title="Огонь">🔥</button>
          <button type="button" data-chat-reaction="cry" title="Плач">😭</button>
          <button type="button" data-chat-reaction="halo" title="Нимб">😇</button>
          <button type="button" data-chat-reaction="angry" title="Злость">😡</button>
        </div>
        <div class="lobby-chat-input">
          <input type="text" id="lobby-input" maxlength="200" placeholder="Сообщение…" autocomplete="off" />
          <button type="button" class="btn-primary" id="lobby-send">Отправить</button>
        </div>
      </div>
    </div>
  `

  const errEl = root.querySelector('#lobby-err') as HTMLElement
  const waitEl = root.querySelector('#lobby-wait-dur') as HTMLElement
  const inviteWrap = root.querySelector('#lobby-invite-wrap') as HTMLElement
  const inviteUrlEl = root.querySelector('#lobby-invite-url') as HTMLElement
  const inviteWatchUrlEl = root.querySelector('#lobby-invite-watch-url') as HTMLElement
  const playersEl = root.querySelector('#lobby-players') as HTMLElement
  const countdownEl = root.querySelector('#lobby-countdown') as HTMLElement
  const msgsEl = root.querySelector('#lobby-msgs') as HTMLElement
  const inputEl = root.querySelector('#lobby-input') as HTMLInputElement
  const chatBody = root.querySelector('#lobby-chat-body') as HTMLElement
  const chatToggle = root.querySelector('#lobby-chat-toggle') as HTMLButtonElement
  const chatUnread = root.querySelector('#lobby-chat-unread') as HTMLElement

  let lobbyChatCollapsed = false

  const applyLobbyChatCollapsed = (): void => {
    chatBody.style.display = lobbyChatCollapsed ? 'none' : 'flex'
    chatToggle.textContent = lobbyChatCollapsed ? 'Чат' : 'Свернуть чат'
    if (!lobbyChatCollapsed) {
      chatUnread.style.display = 'none'
      msgsEl.scrollTop = msgsEl.scrollHeight
    }
  }

  chatToggle.addEventListener('click', () => {
    lobbyChatCollapsed = !lobbyChatCollapsed
    applyLobbyChatCollapsed()
  })

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

  root.querySelector('#lobby-copy-watch')?.addEventListener('click', async () => {
    const t = inviteWatchUrlEl.textContent ?? ''
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
    if (lobbyChatCollapsed) {
      chatUnread.style.display = 'inline-block'
    }
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
      const uw = new URL(window.location.href)
      uw.searchParams.set('room', c)
      uw.searchParams.set('watch', '1')
      inviteWatchUrlEl.textContent = uw.toString()
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
  let mySide: Side = 'left'
  let rematchHintEl: HTMLParagraphElement | null = null
  let removeGameChat: (() => void) | null = null

  const goToMenuFromGame = (gameEl: HTMLElement): void => {
    clearMatchSessionKeys()
    removeGameChat?.()
    removeGameChat = null
    removeSpectatorCountBadge(gameEl)
    sock.emit('room:leave')
    disconnectGameSocket()
    gameEl.style.display = 'none'
    setGameBackVisible(false)
    clearRoomQueryParam()
    onGameEndNav()
  }

  sock.on('error', (payload: { code?: string; message?: string }) => {
    const msg = payload?.message ?? 'Ошибка'
    const lobbyEl = document.getElementById('lobby')
    const gameEl = document.getElementById(gameRootId)
    const inLobby = lobbyEl && lobbyEl.style.display !== 'none'
    if (inLobby) {
      ui.setErr(msg)
    } else if (gameEl && gameEl.style.display !== 'none') {
      showRoomToast(gameEl, msg)
    } else {
      ui.setErr(msg)
    }
    if (payload?.code === 'ROOM_FULL' || payload?.code === 'ROOM_NOT_FOUND') {
      setTimeout(() => userLeave(), 2200)
    }
  })

  sock.on('connect_error', () => {
    ui.setErr('Не удалось подключиться к серверу')
  })

  const tryRejoinMatch = (): void => {
    if (sessionStorage.getItem('tennis_match_active') !== '1') return
    const code = sessionStorage.getItem('tennis_room_code')
    if (code && sock.connected) sock.emit('room:rejoin', { code })
  }
  sock.io.on('reconnect', tryRejoinMatch)

  sock.on('spectator:count', (p: { count?: number }) => {
    const n = typeof p.count === 'number' ? p.count : 0
    const gameEl = document.getElementById(gameRootId)
    if (!gameEl || gameEl.style.display === 'none') return
    updateSpectatorCountBadge(gameEl, n)
  })

  sock.on('room:created', (payload: { code: string }) => {
    ui.setCode(payload.code)
    setMatchSessionKeys(payload.code)
  })

  sock.on(
    'room:joined',
    (payload: {
      side?: string
      players: Array<{ nickname: string; side: string }>
      lobbyChat?: ChatLine[]
    }) => {
      if (payload.side === 'left' || payload.side === 'right') {
        mySide = payload.side
      }
      ui.setPlayers(payload.players)
      if (payload.lobbyChat?.length) {
        chatLines = [...payload.lobbyChat]
        ui.setMsgs(chatLines)
      }
      const rc = new URL(window.location.href).searchParams.get('room')
      if (rc) setMatchSessionKeys(rc)
    },
  )

  sock.on('room:countdown', (payload: { seconds: number }) => {
    const lobbyEl = document.getElementById('lobby')
    if (lobbyEl && lobbyEl.style.display !== 'none') {
      ui.setCountdown(payload.seconds)
      return
    }
    const gameEl = document.getElementById(gameRootId)
    if (gameEl && gameEl.style.display !== 'none') {
      showGameCountdownBanner(gameEl, payload.seconds)
    }
  })

  sock.on('room:rematch:state', (p: { youReady: boolean; peerReady: boolean }) => {
    if (!rematchHintEl) return
    if (p.youReady && p.peerReady) {
      rematchHintEl.textContent = 'Оба готовы — готовим старт…'
    } else if (p.youReady) {
      rematchHintEl.textContent = 'Вы готовы. Ждём соперника.'
    } else if (p.peerReady) {
      rematchHintEl.textContent = 'Соперник готов. Нажмите «Сыграть ещё раз».'
    } else {
      rematchHintEl.textContent = 'Нажмите «Сыграть ещё раз», когда будете готовы.'
    }
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
    const urlRoom = new URL(window.location.href).searchParams.get('room')
    if (urlRoom) setMatchSessionKeys(urlRoom)
    removeGameChat?.()
    removeGameChat = null
    lobbyRoot.style.display = 'none'
    lobbyRoot.innerHTML = ''
    const gameEl = document.getElementById(gameRootId)
    if (gameEl) {
      gameEl.style.display = 'block'
      gameEl.style.position = 'relative'
      gameEl.querySelector('.match-result-full')?.remove()
      document.getElementById('match-rematch-countdown')?.remove()
      setGameBackVisible(true)

      startOnlineMatch(gameRootId, mySide, sock, nickname, ({ winner, reason, sets, technical, doubleDefeat }) => {
        clearMatchSessionKeys()
        const youWin = winner !== null && winner === mySide
        const neutral = winner === null || doubleDefeat
        const overlay = document.createElement('div')
        overlay.className = 'match-result-full'
        const winBg = 'linear-gradient(180deg, rgba(22,48,32,0.97) 0%, rgba(14,28,20,0.98) 100%)'
        const loseBg = 'linear-gradient(180deg, rgba(48,22,26,0.97) 0%, rgba(28,14,18,0.98) 100%)'
        const drawBg = 'linear-gradient(180deg, rgba(36,36,52,0.97) 0%, rgba(22,22,36,0.98) 100%)'
        overlay.style.cssText = [
          'position:absolute',
          'inset:0',
          'display:flex',
          'flex-direction:column',
          'align-items:center',
          'justify-content:center',
          'gap:14px',
          neutral ? `background:${drawBg}` : youWin ? `background:${winBg}` : `background:${loseBg}`,
          'color:#e8e8f0',
          'font:18px system-ui,sans-serif',
          'text-align:center',
          'z-index:30',
          'padding:20px 16px',
        ].join(';')
        const title = document.createElement('div')
        title.style.fontSize = '28px'
        title.style.fontWeight = '600'
        title.style.color = neutral ? '#c8c8e0' : youWin ? '#7dffb3' : '#ff8a8a'
        title.textContent = neutral ? 'Матч не состоялся' : youWin ? 'Победа' : 'Поражение'
        const setsLine = document.createElement('div')
        setsLine.style.fontSize = '17px'
        setsLine.style.color = '#d0d0e0'
        setsLine.textContent = formatSetsDisplay(sets)
        const sub = document.createElement('div')
        sub.style.color = '#a8a8b8'
        sub.style.fontSize = '15px'
        sub.style.maxWidth = '22rem'
        let reasonText = reason
        if (doubleDefeat) {
          reasonText = 'Оба игрока не вернулись после обрыва связи'
        } else if (technical && !youWin) {
          reasonText = reason.includes('не вернулся')
            ? 'Техническое поражение: вы не вернулись вовремя'
            : 'Техническое поражение: соперник отключился'
        } else if (technical && youWin) {
          reasonText = reason.includes('не вернулся')
            ? 'Техническая победа: соперник не вернулся'
            : 'Победа по отказу соперника'
        }
        sub.textContent = reasonText

        rematchHintEl = document.createElement('p')
        rematchHintEl.style.cssText = 'margin:0;min-height:2.5em;font-size:14px;color:#9c9cb8;max-width:22rem'
        rematchHintEl.textContent = 'Нажмите «Сыграть ещё раз», когда будете готовы.'

        const row = document.createElement('div')
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px'

        const rematchBtn = document.createElement('button')
        rematchBtn.type = 'button'
        rematchBtn.className = 'btn-primary'
        rematchBtn.textContent = 'Сыграть ещё раз'
        rematchBtn.addEventListener('click', () => {
          sock.emit('room:rematch')
        })

        const menuBtn = document.createElement('button')
        menuBtn.type = 'button'
        menuBtn.className = 'btn-secondary'
        menuBtn.textContent = 'В главное меню'
        menuBtn.addEventListener('click', () => {
          rematchHintEl = null
          goToMenuFromGame(gameEl)
        })

        row.append(rematchBtn, menuBtn)
        overlay.append(title, setsLine, sub, rematchHintEl, row)
        gameEl.appendChild(overlay)
        setGameBackVisible(false)
      })
      removeGameChat = mountRoomChat(gameEl, sock, { initialLines: [] })
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
      if (gameEl) goToMenuFromGame(gameEl)
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

  lobbyRoot.querySelectorAll('[data-chat-reaction]').forEach((el) => {
    el.addEventListener('click', () => {
      const t = (el as HTMLElement).getAttribute('data-chat-reaction')
      if (t) sock.emit('chat:reaction', { type: t })
    })
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

/** Наблюдатель: `?room=CODE&watch=1` (админ: `asAdmin` + `?adm=1`) */
export async function openSpectatorJoin(hooks: LobbyHooks & { code: string; asAdmin?: boolean }): Promise<void> {
  const token = localStorage.getItem(LS_ACCESS)
  if (!token) throw new Error('Нет сессии')

  const app = document.getElementById('app')
  const gameRoot = document.getElementById('game')
  if (!app || !gameRoot) throw new Error('Нет контейнера')

  const code = hooks.code.trim().toUpperCase()
  app.style.display = 'none'
  disconnectGameSocket()
  const sock = getGameSocket(token)

  let joinRetryTimer: ReturnType<typeof setInterval> | null = null
  let removeRoomChat: (() => void) | null = null
  let pendingSpectatorMatchChat: ChatLine[] = []

  const clearJoinRetry = (): void => {
    if (joinRetryTimer) {
      clearInterval(joinRetryTimer)
      joinRetryTimer = null
    }
  }

  const clearWatchParam = (): void => {
    const u = new URL(window.location.href)
    u.searchParams.delete('watch')
    u.searchParams.delete('adm')
    window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash)
  }

  const tearDown = (): void => {
    clearJoinRetry()
    removeRoomChat?.()
    removeRoomChat = null
    destroyGame()
    disconnectGameSocket()
    removeSpectatorCountBadge(gameRoot)
    gameRoot.innerHTML = ''
    gameRoot.style.display = 'none'
    setGameBackVisible(false)
    clearWatchParam()
    clearRoomQueryParam()
    app.style.display = 'flex'
    hooks.onLeave()
  }

  const ensureBackBtn = (): HTMLButtonElement => {
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
    return backBtn
  }

  const waitPanelStyle =
    'min-height:160px;display:flex;align-items:center;justify-content:center;padding:24px;color:#c8c8e0;font:16px system-ui,sans-serif;text-align:center;max-width:28rem;margin:0 auto'

  gameRoot.innerHTML = ''
  gameRoot.style.display = 'block'
  gameRoot.style.position = 'relative'
  const bootWait = document.createElement('div')
  bootWait.className = 'spectator-wait-panel'
  bootWait.style.cssText = waitPanelStyle
  bootWait.textContent = 'Подключение к комнате…'
  gameRoot.appendChild(bootWait)
  const backBtnBoot = ensureBackBtn()
  backBtnBoot.onclick = () => {
    clearJoinRetry()
    sock.emit('room:leave')
    tearDown()
  }
  setGameBackVisible(true)

  const mountSpectatorResult = (end: {
    winner: Side | null
    reason: string
    sets: [number, number][]
    technical?: boolean
    doubleDefeat?: boolean
  }): void => {
    gameRoot.querySelector('.match-result-full')?.remove()
    const overlay = document.createElement('div')
    overlay.className = 'match-result-full'
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:14px',
      'background:rgba(32,32,48,0.96)',
      'color:#e8e8f0',
      'font:18px system-ui,sans-serif',
      'text-align:center',
      'z-index:30',
      'padding:20px 16px',
    ].join(';')
    const title = document.createElement('div')
    title.style.cssText = 'font-size:26px;font-weight:600;color:#d8d8f0'
    title.textContent = 'Матч завершён'
    const setsLine = document.createElement('div')
    setsLine.style.cssText = 'font-size:17px;color:#c8c8e0'
    setsLine.textContent = formatSetsDisplay(end.sets)
    const sub = document.createElement('div')
    sub.style.cssText = 'color:#a8a8b8;font-size:15px;max-width:22rem'
    sub.textContent = end.doubleDefeat
      ? 'Оба игрока не вернулись после обрыва'
      : end.technical
        ? 'Итог с учётом отключения игрока'
        : end.reason
    const menuBtn = document.createElement('button')
    menuBtn.type = 'button'
    menuBtn.className = 'btn-secondary'
    menuBtn.textContent = 'В главное меню'
    menuBtn.addEventListener('click', () => {
      sock.emit('room:leave')
      tearDown()
    })
    overlay.append(title, setsLine, sub, menuBtn)
    gameRoot.appendChild(overlay)
    setGameBackVisible(false)
  }

  sock.on('spectator:count', (p: { count?: number }) => {
    const n = typeof p.count === 'number' ? p.count : 0
    if (gameRoot.style.display === 'none') return
    updateSpectatorCountBadge(gameRoot, n)
  })

  sock.on('room:countdown', (payload: { seconds: number }) => {
    if (gameRoot.style.display !== 'none') {
      showGameCountdownBanner(gameRoot, payload.seconds)
    }
  })

  sock.on('game:start', () => {
    clearJoinRetry()
    gameRoot.querySelector('.spectator-wait-panel')?.remove()
    gameRoot.querySelector('.match-result-full')?.remove()
    document.getElementById('match-rematch-countdown')?.remove()
    gameRoot.style.display = 'block'
    gameRoot.style.position = 'relative'
    setGameBackVisible(true)
    const backBtn = ensureBackBtn()
    backBtn.onclick = () => {
      sock.emit('room:leave')
      tearDown()
    }

    removeRoomChat?.()
    removeRoomChat = null
    const initial = pendingSpectatorMatchChat
    pendingSpectatorMatchChat = []
    startOnlineMatch(
      'game',
      'left',
      sock,
      hooks.nickname,
      (end) => {
        mountSpectatorResult(end)
      },
      { spectator: true },
    )
    removeRoomChat = mountRoomChat(gameRoot, sock, { initialLines: initial })
  })

  sock.on(
    'spectator:joined',
    (p: {
      players: Array<{ nickname: string; side: string }>
      phase: string
      matchChat?: ChatLine[]
    }) => {
    clearJoinRetry()
    pendingSpectatorMatchChat = [...(p.matchChat ?? [])]
    if (p.phase === 'playing') {
      gameRoot.querySelector('.spectator-wait-panel')?.remove()
      return
    }
    if (p.phase === 'result') {
      gameRoot.style.display = 'block'
      gameRoot.style.position = 'relative'
      gameRoot.innerHTML = ''
      const panel = document.createElement('div')
      panel.className = 'spectator-wait-panel'
      panel.style.cssText = waitPanelStyle
      panel.textContent = 'Матч завершён. Ожидание реванша или нового старта…'
      gameRoot.appendChild(panel)
      removeRoomChat?.()
      removeRoomChat = mountRoomChat(gameRoot, sock, { initialLines: pendingSpectatorMatchChat })
      const backBtn = ensureBackBtn()
      backBtn.onclick = () => {
        sock.emit('room:leave')
        tearDown()
      }
      setGameBackVisible(true)
    }
  })

  sock.on('room:closed', () => {
    tearDown()
  })

  sock.on('error', (payload: { code?: string; message?: string }) => {
    const c = payload?.code
    if (c === 'INVALID_PHASE') {
      const msg = payload?.message ?? 'Матч ещё не начался. Ожидайте начала.'
      let wp = gameRoot.querySelector('.spectator-wait-panel') as HTMLElement | null
      if (!wp) {
        gameRoot.innerHTML = ''
        wp = document.createElement('div')
        wp.className = 'spectator-wait-panel'
        wp.style.cssText = waitPanelStyle
        gameRoot.appendChild(wp)
      }
      wp.textContent = msg
      gameRoot.style.display = 'block'
      if (!joinRetryTimer) {
        joinRetryTimer = setInterval(
          () => sock.emit('spectator:join', hooks.asAdmin ? { code, asAdmin: true } : { code }),
          4000,
        )
      }
      return
    }
    if (gameRoot.style.display !== 'none') {
      showRoomToast(gameRoot, payload?.message ?? 'Ошибка')
    } else {
      alert(payload?.message ?? 'Ошибка')
    }
    tearDown()
  })

  whenConnected(sock, () => {
    sock.emit('spectator:join', hooks.asAdmin ? { code, asAdmin: true } : { code })
  })
}


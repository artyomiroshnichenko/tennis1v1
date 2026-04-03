import { getGameSocket, disconnectGameSocket } from '../net/gameSocket'
import { LS_ACCESS } from '../sessionKeys'
import { destroyGame, startOnlineMatch } from '../game/startPhaser'
import type { Side } from '../game/gameTypes'
import type { Socket } from 'socket.io-client'
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
  let mySide: Side = 'left'
  let rematchHintEl: HTMLParagraphElement | null = null

  const goToMenuFromGame = (gameEl: HTMLElement): void => {
    sock.emit('room:leave')
    disconnectGameSocket()
    gameEl.style.display = 'none'
    setGameBackVisible(false)
    clearRoomQueryParam()
    onGameEndNav()
  }

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
    lobbyRoot.style.display = 'none'
    lobbyRoot.innerHTML = ''
    const gameEl = document.getElementById(gameRootId)
    if (gameEl) {
      gameEl.style.display = 'block'
      gameEl.style.position = 'relative'
      gameEl.querySelector('.match-result-full')?.remove()
      document.getElementById('match-rematch-countdown')?.remove()
      setGameBackVisible(true)

      startOnlineMatch(gameRootId, mySide, sock, nickname, ({ winner, reason, sets, technical }) => {
        const youWin = winner === mySide
        const overlay = document.createElement('div')
        overlay.className = 'match-result-full'
        const winBg = 'linear-gradient(180deg, rgba(22,48,32,0.97) 0%, rgba(14,28,20,0.98) 100%)'
        const loseBg = 'linear-gradient(180deg, rgba(48,22,26,0.97) 0%, rgba(28,14,18,0.98) 100%)'
        overlay.style.cssText = [
          'position:absolute',
          'inset:0',
          'display:flex',
          'flex-direction:column',
          'align-items:center',
          'justify-content:center',
          'gap:14px',
          youWin ? `background:${winBg}` : `background:${loseBg}`,
          'color:#e8e8f0',
          'font:18px system-ui,sans-serif',
          'text-align:center',
          'z-index:30',
          'padding:20px 16px',
        ].join(';')
        const title = document.createElement('div')
        title.style.fontSize = '28px'
        title.style.fontWeight = '600'
        title.style.color = youWin ? '#7dffb3' : '#ff8a8a'
        title.textContent = youWin ? 'Победа' : 'Поражение'
        const setsLine = document.createElement('div')
        setsLine.style.fontSize = '17px'
        setsLine.style.color = '#d0d0e0'
        setsLine.textContent = formatSetsDisplay(sets)
        const sub = document.createElement('div')
        sub.style.color = '#a8a8b8'
        sub.style.fontSize = '15px'
        sub.style.maxWidth = '22rem'
        const reasonText =
          technical && !youWin
            ? 'Техническое поражение: соперник отключился'
            : technical && youWin
              ? 'Победа по отказу соперника'
              : reason
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

/** Наблюдатель: `?room=CODE&watch=1` */
export async function openSpectatorJoin(hooks: LobbyHooks & { code: string }): Promise<void> {
  const token = localStorage.getItem(LS_ACCESS)
  if (!token) throw new Error('Нет сессии')

  const app = document.getElementById('app')
  const gameRoot = document.getElementById('game')
  if (!app || !gameRoot) throw new Error('Нет контейнера')

  const code = hooks.code.trim().toUpperCase()
  app.style.display = 'none'
  disconnectGameSocket()
  const sock = getGameSocket(token)

  const clearWatchParam = (): void => {
    const u = new URL(window.location.href)
    u.searchParams.delete('watch')
    window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash)
  }

  const tearDown = (): void => {
    destroyGame()
    disconnectGameSocket()
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

  const mountSpectatorResult = (end: {
    winner: Side
    reason: string
    sets: [number, number][]
    technical?: boolean
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
    sub.textContent = end.technical ? 'Итог с учётом отключения игрока' : end.reason
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

  sock.on('room:countdown', (payload: { seconds: number }) => {
    if (gameRoot.style.display !== 'none') {
      showGameCountdownBanner(gameRoot, payload.seconds)
    }
  })

  sock.on('game:start', () => {
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
  })

  sock.on('spectator:joined', (p: { players: Array<{ nickname: string; side: string }>; phase: string }) => {
    if (p.phase === 'result') {
      gameRoot.style.display = 'block'
      gameRoot.style.position = 'relative'
      gameRoot.innerHTML = ''
      const panel = document.createElement('div')
      panel.className = 'spectator-wait-panel'
      panel.style.cssText =
        'min-height:200px;display:flex;align-items:center;justify-content:center;padding:24px;color:#c8c8e0;font:16px system-ui,sans-serif;text-align:center'
      panel.textContent = 'Матч завершён. Ожидание реванша или нового старта…'
      gameRoot.appendChild(panel)
      const backBtn = ensureBackBtn()
      backBtn.onclick = () => {
        sock.emit('room:leave')
        tearDown()
      }
    }
  })

  sock.on('room:closed', () => {
    tearDown()
  })

  sock.on('error', (payload: { message?: string }) => {
    alert(payload?.message ?? 'Ошибка')
    tearDown()
  })

  whenConnected(sock, () => {
    sock.emit('spectator:join', { code })
  })
}


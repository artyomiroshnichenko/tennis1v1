import {
  ConfirmationResult,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  type Auth,
} from 'firebase/auth'
import { apiJson, apiJsonWithRefresh, refreshSession } from '../api/http'
import { getFirebaseAuth, firebaseConfigured } from '../firebaseApp'
import { validateNicknameInput } from '../nicknameRules'
import { LS_ACCESS, LS_NICKNAME, LS_REFRESH } from '../sessionKeys'
import type { Side } from '../game/gameTypes'
import { destroyGame, startBotMatch } from '../game/startPhaser'
import { getGameSocket, disconnectGameSocket } from '../net/gameSocket'
import { openLobbyCreate, openLobbyJoin, openSpectatorJoin } from './lobbyScreen'
import '../ui/home.css'

type ProfileState =
  | { kind: 'loading' }
  | { kind: 'guest'; nickname: string }
  | { kind: 'user'; id: string; nickname: string }

let profile: ProfileState = { kind: 'loading' }
let appRoot: HTMLElement
let gameRoot: HTMLElement | null = null
let backBtn: HTMLButtonElement | null = null
let phoneConfirmation: ConfirmationResult | null = null

function setProfile(next: ProfileState): void {
  profile = next
}

function getDisplayNickname(): string {
  const ls = localStorage.getItem(LS_NICKNAME)
  if (ls && ls.trim()) return ls.trim()
  if (profile.kind === 'guest') return profile.nickname
  if (profile.kind === 'user') return profile.nickname
  return ''
}

async function restoreProfileFromApi(): Promise<void> {
  const me = await apiJsonWithRefresh<{
    type: string
    nickname: string
    id?: string
  }>('/profile/me')
  if (me.type === 'user' && me.id) {
    setProfile({ kind: 'user', id: me.id, nickname: me.nickname })
  } else {
    setProfile({ kind: 'guest', nickname: me.nickname })
  }
  localStorage.setItem(LS_NICKNAME, me.nickname)
}

async function restoreSession(): Promise<void> {
  setProfile({ kind: 'loading' })
  if (localStorage.getItem(LS_REFRESH)) {
    const ok = await refreshSession()
    if (ok) {
      try {
        await restoreProfileFromApi()
        return
      } catch {
        localStorage.removeItem(LS_ACCESS)
        localStorage.removeItem(LS_REFRESH)
      }
    }
  }
  const n = localStorage.getItem(LS_NICKNAME)?.trim() ?? ''
  setProfile({ kind: 'guest', nickname: n })
}

async function saveFirebaseSession(idToken: string, nickname?: string): Promise<void> {
  const body: { idToken: string; nickname?: string } = { idToken }
  if (nickname) body.nickname = nickname
  const d = await apiJson<{ accessToken: string; refreshToken: string }>('/auth/firebase', {
    method: 'POST',
    body: JSON.stringify(body),
    skipAuth: true,
  })
  localStorage.setItem(LS_ACCESS, d.accessToken)
  localStorage.setItem(LS_REFRESH, d.refreshToken)
  await restoreProfileFromApi()
}

function subscribeFirebaseAuth(): void {
  const auth = getFirebaseAuth()
  if (!auth) return
  onAuthStateChanged(auth, async (user) => {
    if (!user) return
    if (localStorage.getItem(LS_REFRESH)) return
    try {
      const idToken = await user.getIdToken()
      const lsNick = localStorage.getItem(LS_NICKNAME)?.trim() ?? ''
      let nick: string | undefined
      try {
        nick = lsNick ? validateNicknameInput(lsNick) : undefined
      } catch {
        nick = undefined
      }
      await saveFirebaseSession(idToken, nick)
      render()
    } catch {
      /* новый пользователь Firebase — нужен никнейм в форме регистрации */
    }
  })
}

async function ensureGuestTokens(nickname: string): Promise<void> {
  const d = await apiJson<{ accessToken: string; refreshToken: string }>('/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
    skipAuth: true,
  })
  localStorage.setItem(LS_ACCESS, d.accessToken)
  localStorage.setItem(LS_REFRESH, d.refreshToken)
}

async function ensureReadyToPlay(): Promise<string> {
  const raw = localStorage.getItem(LS_NICKNAME) ?? ''
  const nickname = validateNicknameInput(raw)
  if (profile.kind === 'user') {
    if (!localStorage.getItem(LS_REFRESH)) {
      throw new Error('Войдите снова')
    }
    return nickname
  }
  await ensureGuestTokens(nickname)
  setProfile({ kind: 'guest', nickname })
  return nickname
}

function closeModals(): void {
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove())
}

function openNicknameModal(afterSubmit?: () => void): void {
  closeModals()
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `
    <div class="modal" role="dialog">
      <h2>Ваш никнейм</h2>
      <p class="err" id="nick-err" style="display:none"></p>
      <label for="nick-input">3–20 символов: буквы, цифры, - и _</label>
      <input id="nick-input" type="text" maxlength="20" autocomplete="username" />
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="nick-cancel">Отмена</button>
        <button type="button" class="btn-primary" id="nick-save">Сохранить</button>
      </div>
    </div>
  `
  document.body.appendChild(backdrop)
  const input = backdrop.querySelector('#nick-input') as HTMLInputElement
  const errEl = backdrop.querySelector('#nick-err') as HTMLElement
  input.value = getDisplayNickname()
  input.focus()
  input.select()

  backdrop.querySelector('#nick-cancel')?.addEventListener('click', () => {
    backdrop.remove()
  })
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove()
  })
  backdrop.querySelector('#nick-save')?.addEventListener('click', async () => {
    errEl.style.display = 'none'
    try {
      const nickname = validateNicknameInput(input.value)
      localStorage.setItem(LS_NICKNAME, nickname)
      if (profile.kind === 'user') {
        try {
          const res = await apiJsonWithRefresh<{ nickname: string; accessToken: string }>(
            '/profile/nickname',
            { method: 'PATCH', body: JSON.stringify({ nickname }) },
          )
          localStorage.setItem(LS_ACCESS, res.accessToken)
          await restoreProfileFromApi()
        } catch (e) {
          const code = (e as { code?: string }).code
          if (code === 'NICKNAME_TAKEN') {
            errEl.textContent = 'Этот никнейм уже занят'
            errEl.style.display = 'block'
            return
          }
          throw e
        }
      } else {
        await ensureGuestTokens(nickname)
        setProfile({ kind: 'guest', nickname })
      }
      backdrop.remove()
      render()
      afterSubmit?.()
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : 'Ошибка'
      errEl.style.display = 'block'
    }
  })
}

type HistoryItem = {
  matchId: string
  type: string
  status: string
  sets: unknown
  isWinner: boolean
  createdAt: string
  finishedAt: string | null
  opponent: string
  outcome: 'win' | 'loss' | 'technical_win' | 'technical_loss'
}

async function fetchHistory(): Promise<HistoryItem[]> {
  const res = await apiJsonWithRefresh<{ items: HistoryItem[] }>('/matches/history')
  return res.items
}

function outcomeLabel(o: HistoryItem['outcome']): string {
  switch (o) {
    case 'win':
      return 'Победа'
    case 'loss':
      return 'Поражение'
    case 'technical_win':
      return 'Победа (техн.)'
    case 'technical_loss':
      return 'Техн. поражение'
    default:
      return o
  }
}

function formatHistoryOpponent(it: Pick<HistoryItem, 'type' | 'opponent'>): string {
  return it.type === 'BOT' ? `Бот: ${it.opponent}` : it.opponent
}

function formatHistorySets(sets: unknown): string {
  if (!Array.isArray(sets)) return ''
  return sets
    .map((s) => {
      if (Array.isArray(s) && s.length >= 2) return `${s[0]}–${s[1]}`
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

async function showMatchHistoryPage(): Promise<void> {
  appRoot.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.style.cssText = 'max-width:36rem;width:100%;padding:1rem'
  const head = document.createElement('div')
  head.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:1rem;flex-wrap:wrap'
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'btn-secondary'
  back.textContent = '← На главную'
  back.addEventListener('click', () => {
    const u = new URL(window.location.href)
    u.searchParams.delete('history')
    window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash)
    render()
  })
  const h = document.createElement('h1')
  h.className = 'home-title'
  h.style.margin = '0'
  h.textContent = 'История матчей'
  head.append(back, h)
  const body = document.createElement('div')
  body.textContent = 'Загрузка…'
  wrap.append(head, body)
  appRoot.appendChild(wrap)

  try {
    const items = await fetchHistory()
    body.textContent = ''
    if (!items.length) {
      body.textContent = 'Пока нет завершённых матчей'
      return
    }
    const ul = document.createElement('ul')
    ul.style.cssText = 'list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px'
    for (const it of items) {
      const li = document.createElement('li')
      li.style.cssText =
        'padding:12px 14px;border-radius:10px;background:rgba(255,255,255,0.06);color:#e8e8f0;font:15px system-ui,sans-serif'
      const when = new Date(it.finishedAt ?? it.createdAt).toLocaleString('ru-RU')
      const setsStr = formatHistorySets(it.sets)
      const strong = document.createElement('strong')
      strong.textContent = formatHistoryOpponent(it)
      const meta = document.createElement('div')
      meta.style.color = '#a8a8b8'
      meta.style.marginTop = '4px'
      meta.textContent = `${setsStr} · ${outcomeLabel(it.outcome)} · ${when}`
      li.append(strong, meta)
      ul.appendChild(li)
    }
    body.appendChild(ul)
  } catch {
    body.textContent = 'Не удалось загрузить историю'
  }
}


function openProfileModal(): void {
  closeModals()
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `
    <div class="modal" role="dialog" style="max-width:26rem">
      <h2>Профиль</h2>
      <p class="err" id="prof-err" style="display:none"></p>
      <label for="prof-nick">Никнейм</label>
      <input id="prof-nick" type="text" maxlength="20" />
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="prof-close">Закрыть</button>
        <button type="button" class="btn-primary" id="prof-save">Сохранить</button>
      </div>
      <div id="prof-history" class="history-block" style="margin-top:1rem">
        <h3>История матчей</h3>
        <p class="empty">Загрузка…</p>
      </div>
    </div>
  `
  document.body.appendChild(backdrop)
  const nickInput = backdrop.querySelector('#prof-nick') as HTMLInputElement
  nickInput.value = profile.kind === 'user' ? profile.nickname : getDisplayNickname()
  const errEl = backdrop.querySelector('#prof-err') as HTMLElement
  const histEl = backdrop.querySelector('#prof-history') as HTMLElement

  void (async () => {
    try {
      const items = await fetchHistory()
      if (!items.length) {
        histEl.innerHTML = '<h3>История матчей</h3><p class="empty">Пока нет завершённых матчей</p>'
        return
      }
      const ul = document.createElement('ul')
      ul.className = 'history-list'
      for (const it of items) {
        const li = document.createElement('li')
        const date = new Date(it.finishedAt ?? it.createdAt).toLocaleString('ru-RU')
        const setsStr = formatHistorySets(it.sets)
        li.textContent = `${formatHistoryOpponent(it)} · ${setsStr || '—'} · ${outcomeLabel(it.outcome)} · ${date}`
        ul.appendChild(li)
      }
      histEl.innerHTML = '<h3>История матчей</h3>'
      histEl.appendChild(ul)
    } catch {
      histEl.innerHTML =
        '<h3>История матчей</h3><p class="empty">Не удалось загрузить историю</p>'
    }
  })()

  backdrop.querySelector('#prof-close')?.addEventListener('click', () => backdrop.remove())
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove()
  })
  backdrop.querySelector('#prof-save')?.addEventListener('click', async () => {
    errEl.style.display = 'none'
    try {
      const nickname = validateNicknameInput(nickInput.value)
      const res = await apiJsonWithRefresh<{ nickname: string; accessToken: string }>(
        '/profile/nickname',
        { method: 'PATCH', body: JSON.stringify({ nickname }) },
      )
      localStorage.setItem(LS_ACCESS, res.accessToken)
      localStorage.setItem(LS_NICKNAME, res.nickname)
      await restoreProfileFromApi()
      backdrop.remove()
      render()
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'NICKNAME_TAKEN') {
        errEl.textContent = 'Этот никнейм уже занят'
        errEl.style.display = 'block'
        return
      }
      errEl.textContent = e instanceof Error ? e.message : 'Ошибка'
      errEl.style.display = 'block'
    }
  })
}

function openAuthModal(): void {
  closeModals()
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `
    <div class="modal" role="dialog" style="max-width:24rem">
      <h2>Вход и регистрация</h2>
      <p class="err" id="auth-err" style="display:none"></p>
      <div class="auth-tabs">
        <button type="button" class="active" data-tab="email">Email</button>
        <button type="button" data-tab="phone">Телефон</button>
      </div>
      <div id="auth-email-panel">
        <label for="ae-mail">Email</label>
        <input id="ae-mail" type="email" autocomplete="email" />
        <label for="ae-pass">Пароль</label>
        <input id="ae-pass" type="password" autocomplete="current-password" />
        <label for="ae-nick">Никнейм (для регистрации)</label>
        <input id="ae-nick" type="text" maxlength="20" />
        <div class="modal-actions" style="flex-wrap:wrap;justify-content:stretch">
          <button type="button" class="btn-primary" id="ae-login" style="flex:1">Войти</button>
          <button type="button" class="btn-secondary" id="ae-reg" style="flex:1">Регистрация</button>
        </div>
      </div>
      <div id="auth-phone-panel" style="display:none">
        <label for="ap-phone">Номер (+7…)</label>
        <input id="ap-phone" type="tel" autocomplete="tel" placeholder="+79001234567" />
        <label for="ap-nick">Никнейм</label>
        <input id="ap-nick" type="text" maxlength="20" />
        <button type="button" class="btn-primary" id="ap-send" style="width:100%;margin-bottom:0.5rem">Отправить код</button>
        <label for="ap-code">Код из SMS</label>
        <input id="ap-code" type="text" inputmode="numeric" />
        <button type="button" class="btn-primary" id="ap-confirm" style="width:100%">Подтвердить</button>
      </div>
      <div class="modal-actions" style="margin-top:0.75rem">
        <button type="button" class="btn-secondary" id="auth-close">Закрыть</button>
      </div>
    </div>
  `
  document.body.appendChild(backdrop)
  const errEl = backdrop.querySelector('#auth-err') as HTMLElement
  const aeNick = backdrop.querySelector('#ae-nick') as HTMLInputElement
  aeNick.value = getDisplayNickname()

  const apNick = backdrop.querySelector('#ap-nick') as HTMLInputElement
  apNick.value = getDisplayNickname()

  const tabs = backdrop.querySelectorAll('.auth-tabs button')
  const emailPanel = backdrop.querySelector('#auth-email-panel') as HTMLElement
  const phonePanel = backdrop.querySelector('#auth-phone-panel') as HTMLElement
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const tab = (btn as HTMLElement).dataset.tab
      emailPanel.style.display = tab === 'email' ? 'block' : 'none'
      phonePanel.style.display = tab === 'phone' ? 'block' : 'none'
    })
  })

  backdrop.querySelector('#auth-close')?.addEventListener('click', () => backdrop.remove())
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove()
  })

  const showErr = (msg: string) => {
    errEl.textContent = msg
    errEl.style.display = 'block'
  }

  backdrop.querySelector('#ae-login')?.addEventListener('click', async () => {
    errEl.style.display = 'none'
    const auth = getFirebaseAuth()
    if (!auth) {
      showErr('Firebase не настроен в .env клиента')
      return
    }
    const email = (backdrop.querySelector('#ae-mail') as HTMLInputElement).value.trim()
    const password = (backdrop.querySelector('#ae-pass') as HTMLInputElement).value
    try {
      await signInWithEmailAndPassword(auth, email, password)
      const idToken = await auth.currentUser!.getIdToken()
      await saveFirebaseSession(idToken)
      backdrop.remove()
      render()
    } catch {
      showErr('Не удалось войти. Проверьте email и пароль.')
    }
  })

  backdrop.querySelector('#ae-reg')?.addEventListener('click', async () => {
    errEl.style.display = 'none'
    const auth = getFirebaseAuth()
    if (!auth) {
      showErr('Firebase не настроен в .env клиента')
      return
    }
    const email = (backdrop.querySelector('#ae-mail') as HTMLInputElement).value.trim()
    const password = (backdrop.querySelector('#ae-pass') as HTMLInputElement).value
    let nickname: string
    try {
      nickname = validateNicknameInput(aeNick.value)
    } catch (e) {
      showErr(e instanceof Error ? e.message : 'Никнейм')
      return
    }
    try {
      const taken = await apiJson<{ available: boolean }>(
        `/profile/nickname/check?value=${encodeURIComponent(nickname)}`,
        { skipAuth: true },
      )
      if (!taken.available) {
        showErr('Этот никнейм уже занят')
        return
      }
    } catch {
      showErr('Не удалось проверить никнейм')
      return
    }
    try {
      await createUserWithEmailAndPassword(auth, email, password)
      const idToken = await auth.currentUser!.getIdToken()
      await saveFirebaseSession(idToken, nickname)
      localStorage.setItem(LS_NICKNAME, nickname)
      backdrop.remove()
      render()
    } catch {
      showErr('Регистрация не удалась. Возможно, email уже используется.')
    }
  })

  let recaptcha: RecaptchaVerifier | null = null
  const getRecaptcha = (a: Auth): RecaptchaVerifier => {
    if (!recaptcha) {
      recaptcha = new RecaptchaVerifier(a, 'recaptcha-container', { size: 'invisible' })
    }
    return recaptcha
  }

  backdrop.querySelector('#ap-send')?.addEventListener('click', async () => {
    errEl.style.display = 'none'
    const auth = getFirebaseAuth()
    if (!auth) {
      showErr('Firebase не настроен в .env клиента')
      return
    }
    const phone = (backdrop.querySelector('#ap-phone') as HTMLInputElement).value.trim()
    try {
      validateNicknameInput(apNick.value)
    } catch (e) {
      showErr(e instanceof Error ? e.message : 'Никнейм')
      return
    }
    try {
      phoneConfirmation = await signInWithPhoneNumber(auth, phone, getRecaptcha(auth))
    } catch {
      showErr('Не удалось отправить SMS. Проверьте номер и настройки Firebase.')
    }
  })

  backdrop.querySelector('#ap-confirm')?.addEventListener('click', async () => {
    errEl.style.display = 'none'
    if (!phoneConfirmation) {
      showErr('Сначала отправьте код')
      return
    }
    const code = (backdrop.querySelector('#ap-code') as HTMLInputElement).value.trim()
    let nickname: string
    try {
      nickname = validateNicknameInput(apNick.value)
    } catch (e) {
      showErr(e instanceof Error ? e.message : 'Никнейм')
      return
    }
    try {
      await phoneConfirmation.confirm(code)
      const auth = getFirebaseAuth()
      const idToken = await auth!.currentUser!.getIdToken()
      try {
        await saveFirebaseSession(idToken, nickname)
      } catch (e) {
        const codeErr = (e as { code?: string }).code
        if (codeErr === 'NICKNAME_TAKEN') {
          showErr('Этот никнейм уже занят')
          return
        }
        showErr(e instanceof Error ? e.message : 'Ошибка входа')
        return
      }
      localStorage.setItem(LS_NICKNAME, nickname)
      phoneConfirmation = null
      backdrop.remove()
      render()
    } catch {
      showErr('Неверный код или ошибка входа')
    }
  })
}

async function logout(): Promise<void> {
  try {
    await apiJsonWithRefresh('/auth/logout', { method: 'POST' })
  } catch {
    /* сеть */
  }
  localStorage.removeItem(LS_ACCESS)
  localStorage.removeItem(LS_REFRESH)
  const auth = getFirebaseAuth()
  if (auth) await signOut(auth)
  await restoreSession()
  render()
}

function showHomeView(): void {
  destroyGame()
  appRoot.style.display = 'flex'
  if (gameRoot) gameRoot.style.display = 'none'
  if (backBtn) backBtn.style.display = 'none'
}

type BotDifficulty = 'easy' | 'medium' | 'hard'

function formatSetsLine(sets: [number, number][]): string {
  if (!sets.length) return ''
  return sets.map(([a, b]) => `${a}–${b}`).join(', ')
}

function whenSockReady(sock: { connected: boolean; once: (ev: string, fn: () => void) => void }, fn: () => void): void {
  if (sock.connected) fn()
  else sock.once('connect', fn)
}

function openBotDifficultyModal(nickname: string, pick: (d: BotDifficulty) => void): void {
  closeModals()
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  const inner = document.createElement('div')
  inner.className = 'modal'
  inner.setAttribute('role', 'dialog')
  inner.style.maxWidth = '32rem'
  inner.innerHTML = `<h2>Игра с ботом</h2><p style="color:#a8a8b8;margin-bottom:1rem">${nickname}</p><p style="margin-bottom:0.75rem">Выберите уровень</p>`
  const cardsWrap = document.createElement('div')
  cardsWrap.style.display = 'flex'
  cardsWrap.style.flexDirection = 'column'
  cardsWrap.style.gap = '12px'
  const levels: Array<{ d: BotDifficulty; title: string; sub: string; desc: string }> = [
    {
      d: 'easy',
      title: 'Лёгкий',
      sub: 'Пикми тиннисистка',
      desc: 'Ниже точность и сила ударов, медленнее реакция',
    },
    {
      d: 'medium',
      title: 'Средний',
      sub: 'Профессионал',
      desc: 'Случайное имя: Медведев, Бублик, Рублев, Соболенко',
    },
    {
      d: 'hard',
      title: 'Сложный',
      sub: 'Легенда',
      desc: 'Случайное имя из топа тура',
    },
  ]
  for (const L of levels) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn-secondary'
    b.style.textAlign = 'left'
    b.style.padding = '14px'
    b.innerHTML = `<strong>${L.title}</strong> — ${L.sub}<br><span style="color:#a8a8b8;font-size:14px">${L.desc}</span>`
    b.addEventListener('click', () => {
      backdrop.remove()
      pick(L.d)
    })
    cardsWrap.appendChild(b)
  }
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'btn-secondary'
  cancel.style.marginTop = '12px'
  cancel.textContent = 'Отмена'
  cancel.addEventListener('click', () => backdrop.remove())
  inner.append(cardsWrap, cancel)
  backdrop.appendChild(inner)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove()
  })
  document.body.appendChild(backdrop)
}

function leaveBotToMenu(sock: { emit: (ev: string, ...args: unknown[]) => void }): void {
  sock.emit('room:leave')
  disconnectGameSocket()
  if (backBtn) backBtn.style.display = 'none'
  showHomeView()
  render()
}

function ensureGameBackForBot(sock: { emit: (ev: string, ...args: unknown[]) => void }): void {
  if (!backBtn) {
    backBtn = document.createElement('button')
    backBtn.id = 'game-back'
    backBtn.type = 'button'
    backBtn.className = 'btn-secondary'
    backBtn.textContent = 'На главную'
    document.body.appendChild(backBtn)
  }
  backBtn.style.display = 'block'
  backBtn.onclick = () => leaveBotToMenu(sock)
}

async function runBotMatch(nickname: string, difficulty: BotDifficulty): Promise<void> {
  const token = localStorage.getItem(LS_ACCESS)
  if (!token) {
    alert('Нет сессии')
    return
  }
  disconnectGameSocket()
  const sock = getGameSocket(token)
  const ref = { botName: '', difficulty }
  const onBs = (p: { botName: string }): void => {
    ref.botName = p.botName
  }
  const onGs = (): void => {
    destroyGame()
    if (!gameRoot) gameRoot = document.getElementById('game')
    if (gameRoot) {
      gameRoot.style.display = 'block'
      gameRoot.style.position = 'relative'
      gameRoot.querySelector('.match-result-full')?.remove()
    }
    appRoot.style.display = 'none'
    ensureGameBackForBot(sock)

    const renderEnd = (end: {
      winner: Side | null
      reason: string
      sets: [number, number][]
      technical?: boolean
      doubleDefeat?: boolean
    }): void => {
      if (!gameRoot) return
      gameRoot.querySelector('.match-result-full')?.remove()
      const overlay = document.createElement('div')
      overlay.className = 'match-result-full'
      const w = end.winner ?? 'left'
      const youWin = w === 'left'
      const winBg = 'linear-gradient(180deg, rgba(22,48,32,0.97) 0%, rgba(14,28,20,0.98) 100%)'
      const loseBg = 'linear-gradient(180deg, rgba(48,22,26,0.97) 0%, rgba(28,14,18,0.98) 100%)'
      overlay.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:${youWin ? winBg : loseBg};color:#e8e8f0;font:18px system-ui,sans-serif;text-align:center;z-index:30;padding:20px`
      const title = document.createElement('div')
      title.style.cssText = `font-size:28px;font-weight:600;color:${youWin ? '#7dffb3' : '#ff8a8a'}`
      title.textContent = youWin ? 'Победа' : 'Поражение'
      const setsEl = document.createElement('div')
      setsEl.textContent = formatSetsLine(end.sets)
      const sub = document.createElement('div')
      sub.style.color = '#a8a8b8'
      sub.style.fontSize = '15px'
      sub.textContent =
        end.technical && !youWin
          ? 'Техническое поражение (неактивная вкладка или выход)'
          : end.reason
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center'
      const rematch = document.createElement('button')
      rematch.type = 'button'
      rematch.className = 'btn-primary'
      rematch.textContent = 'Сыграть ещё раз'
      rematch.addEventListener('click', () => {
        overlay.remove()
        sock.emit('bot:start', { difficulty: ref.difficulty, nickname })
      })
      const menu = document.createElement('button')
      menu.type = 'button'
      menu.className = 'btn-secondary'
      menu.textContent = 'В главное меню'
      menu.addEventListener('click', () => {
        overlay.remove()
        leaveBotToMenu(sock)
      })
      row.append(rematch, menu)
      overlay.append(title, setsEl, sub, row)
      gameRoot.appendChild(overlay)
    }

    startBotMatch('game', sock, nickname, {
      opponentName: ref.botName,
      onMatchEnd: renderEnd,
    })
  }

  sock.off('bot:started', onBs)
  sock.off('game:start', onGs)
  sock.on('bot:started', onBs)
  sock.on('game:start', onGs)

  const onErr = (payload: { message?: string }): void => {
    alert(payload?.message ?? 'Ошибка')
    leaveBotToMenu(sock)
  }
  sock.on('error', onErr)

  whenSockReady(sock, () => {
    sock.emit('bot:start', { difficulty: ref.difficulty, nickname })
  })
}

function render(): void {
  const nick = getDisplayNickname()
  const nickOk = nick.length >= 3
  const isUser = profile.kind === 'user'
  const loading = profile.kind === 'loading'

  appRoot.innerHTML = ''
  const title = document.createElement('h1')
  title.className = 'home-title'
  title.textContent = 'Tennis 1v1'
  appRoot.appendChild(title)

  const sub = document.createElement('p')
  sub.className = 'home-sub'
  sub.textContent = 'Большой теннис в браузере'
  appRoot.appendChild(sub)

  const nickRow = document.createElement('div')
  nickRow.className = 'nickname-row'
  const lab = document.createElement('span')
  lab.className = 'label'
  lab.textContent = 'Никнейм:'
  const val = document.createElement('span')
  val.className = 'value'
  val.textContent = nickOk ? nick : 'не задан'
  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'btn-icon'
  editBtn.textContent = 'Изменить'
  editBtn.disabled = loading
  editBtn.addEventListener('click', () => {
    if (isUser) openProfileModal()
    else openNicknameModal()
  })
  nickRow.append(lab, val, editBtn)
  appRoot.appendChild(nickRow)

  const actions = document.createElement('div')
  actions.className = 'home-actions'
  const mkBtn = (label: string, mode: 'create' | 'bot') => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn-primary'
    b.textContent = label
    b.disabled = loading
    b.addEventListener('click', async () => {
      if (!nickOk) {
        openNicknameModal(() => {
          void tryStart(mode)
        })
        return
      }
      await tryStart(mode)
    })
    return b
  }
  actions.append(
    mkBtn('Создать игру', 'create'),
    mkBtn('Играть с ботом', 'bot'),
  )
  appRoot.appendChild(actions)

  const account = document.createElement('div')
  account.className = 'home-account'
  if (loading) {
    account.textContent = 'Загрузка…'
  } else if (isUser) {
    account.append('Вы вошли как зарегистрированный игрок. ')
    const histBtn = document.createElement('button')
    histBtn.type = 'button'
    histBtn.className = 'link'
    histBtn.textContent = 'История матчей'
    histBtn.addEventListener('click', () => {
      const u = new URL(window.location.href)
      u.searchParams.set('history', '1')
      window.history.replaceState({}, '', u.toString())
      void showMatchHistoryPage()
    })
    account.appendChild(histBtn)
    account.append(' · ')
    const pBtn = document.createElement('button')
    pBtn.type = 'button'
    pBtn.className = 'link'
    pBtn.textContent = 'Профиль'
    pBtn.addEventListener('click', () => openProfileModal())
    account.appendChild(pBtn)
    account.append(' · ')
    const lBtn = document.createElement('button')
    lBtn.type = 'button'
    lBtn.className = 'link'
    lBtn.textContent = 'Выйти'
    lBtn.addEventListener('click', () => void logout())
    account.appendChild(lBtn)
  } else {
    if (firebaseConfigured) {
      account.append('Войдите, чтобы сохранить ник на сервере и видеть историю матчей. ')
      const inBtn = document.createElement('button')
      inBtn.type = 'button'
      inBtn.className = 'link'
      inBtn.textContent = 'Войти / Регистрация'
      inBtn.addEventListener('click', () => openAuthModal())
      account.appendChild(inBtn)
    } else {
      account.textContent =
        'Гостевой режим. Для входа настройте Firebase в client/.env (см. DEVGUIDE).'
    }
  }
  appRoot.appendChild(account)
}

async function tryStart(mode: 'create' | 'bot'): Promise<void> {
  try {
    const nickname = await ensureReadyToPlay()
    if (mode === 'bot') {
      openBotDifficultyModal(nickname, (d) => {
        void runBotMatch(nickname, d)
      })
      return
    }
    await openLobbyCreate({
      nickname,
      onLeave: () => {
        showHomeView()
        render()
      },
    })
  } catch (e) {
    alert(e instanceof Error ? e.message : 'Не удалось начать')
  }
}

async function joinRoomFromInvite(code: string): Promise<void> {
  const run = async (): Promise<void> => {
    try {
      const nickname = await ensureReadyToPlay()
      await openLobbyJoin({
        code,
        nickname,
        onLeave: () => {
          showHomeView()
          render()
        },
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось войти в комнату')
      showHomeView()
      render()
    }
  }
  const nick = getDisplayNickname()
  const nickOk = nick.length >= 3
  if (!nickOk) {
    openNicknameModal(() => {
      void run()
    })
    return
  }
  await run()
}

export async function mountHome(root: HTMLElement): Promise<void> {
  appRoot = root
  await restoreSession()
  subscribeFirebaseAuth()
  const params = new URLSearchParams(window.location.search)
  const roomParam = params.get('room')
  const watch = params.get('watch')

  if (roomParam?.trim() && watch === '1') {
    try {
      const nickname = await ensureReadyToPlay()
      await openSpectatorJoin({
        code: roomParam.trim(),
        nickname,
        onLeave: () => {
          showHomeView()
          render()
        },
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось подключиться')
      render()
    }
    return
  }

  if (params.get('history') === '1') {
    if (profile.kind !== 'user') {
      render()
      return
    }
    await showMatchHistoryPage()
    return
  }

  if (roomParam?.trim()) {
    await joinRoomFromInvite(roomParam.trim())
    return
  }
  render()
}

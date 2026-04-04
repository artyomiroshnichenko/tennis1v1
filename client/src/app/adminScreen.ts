import { apiJsonWithRefresh } from '../api/http'

type AdminStats = {
  day: { total: number; online: number; bot: number }
  week: { total: number; online: number; bot: number }
  all: { total: number; online: number; bot: number }
}

type ActiveRow = {
  code: string
  roomId: string
  players: Array<{ nickname: string; side: string }>
}

type AdminActive = {
  activeMatches: number
  onlineConnections: number
  botSessions: number
  items: ActiveRow[]
}

type MatchJournalItem = {
  id: string
  type: string
  status: string
  sets: unknown
  createdAt: string
  finishedAt: string
  duration: number | null
  players: Array<{ nickname: string; side: string; isWinner: boolean }>
}

type PlayerRow = {
  id: string
  nickname: string
  registeredAt: string
  matches: number
  wins: number
  losses: number
  winRatePercent: number
}

function textEl(tag: string, cls: string | undefined, content: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.textContent = content
  return e
}

function formatSetsDisplay(sets: unknown): string {
  if (!Array.isArray(sets)) return '—'
  return sets
    .map((x) => (Array.isArray(x) && x.length >= 2 ? `${x[0]}–${x[1]}` : ''))
    .filter(Boolean)
    .join(', ')
}

export function mountAdminSection(
  container: HTMLElement,
  opts: { onWatch: (code: string) => void },
): () => void {
  container.className = 'admin-section'
  container.style.cssText =
    'max-width:42rem;width:100%;margin:0 auto 1.25rem;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,0.06);color:#e8e8f0;font:15px system-ui,sans-serif'

  const h = textEl('h2', 'home-title', 'Панель администратора')
  h.style.fontSize = '1.35rem'
  h.style.marginTop = '0'
  h.style.marginBottom = '12px'
  container.appendChild(h)

  const liveBox = document.createElement('div')
  liveBox.style.marginBottom = '14px'
  const liveText = document.createElement('p')
  liveText.style.margin = '0 0 8px'
  liveText.style.color = '#c8c8e0'
  const activeWrap = document.createElement('div')
  activeWrap.style.display = 'flex'
  activeWrap.style.flexDirection = 'column'
  activeWrap.style.gap = '8px'
  liveBox.append(liveText, activeWrap)
  container.appendChild(liveBox)

  const statsBox = document.createElement('div')
  statsBox.style.marginBottom = '14px'
  statsBox.style.color = '#c8c8e0'
  statsBox.style.fontSize = '14px'
  container.appendChild(statsBox)

  const journalHead = document.createElement('div')
  journalHead.style.display = 'flex'
  journalHead.style.flexWrap = 'wrap'
  journalHead.style.gap = '8px'
  journalHead.style.alignItems = 'center'
  journalHead.style.marginBottom = '8px'
  const jl = document.createElement('strong')
  jl.textContent = 'Журнал матчей'
  const fromIn = document.createElement('input')
  fromIn.type = 'date'
  const toIn = document.createElement('input')
  toIn.type = 'date'
  const loadJ = textEl('button', 'btn-secondary', 'Загрузить')
  ;(loadJ as HTMLButtonElement).type = 'button'
  journalHead.append(jl, fromIn, toIn, loadJ)
  container.appendChild(journalHead)

  const journalBody = document.createElement('div')
  journalBody.style.maxHeight = '220px'
  journalBody.style.overflow = 'auto'
  journalBody.style.fontSize = '13px'
  container.appendChild(journalBody)

  const playersHead = document.createElement('strong')
  playersHead.textContent = 'Игроки'
  playersHead.style.display = 'block'
  playersHead.style.marginTop = '16px'
  playersHead.style.marginBottom = '8px'
  container.appendChild(playersHead)

  const playersBody = document.createElement('div')
  playersBody.style.maxHeight = '240px'
  playersBody.style.overflow = 'auto'
  playersBody.style.fontSize = '13px'
  container.appendChild(playersBody)

  let stop = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function loadStats(): Promise<void> {
    try {
      const s = await apiJsonWithRefresh<AdminStats>('/admin/stats')
      statsBox.textContent = `Сыграно — сегодня: ${s.day.total} (онлайн ${s.day.online}, бот ${s.day.bot}); за 7 дней: ${s.week.total} (онлайн ${s.week.online}, бот ${s.week.bot}); всего: ${s.all.total} (онлайн ${s.all.online}, бот ${s.all.bot}).`
    } catch {
      statsBox.textContent = 'Не удалось загрузить статистику'
    }
  }

  function renderActive(a: AdminActive): void {
    liveText.textContent = `Сейчас: матчей ${a.activeMatches}, подключений ${a.onlineConnections}, бот-сессий ${a.botSessions}.`
    activeWrap.innerHTML = ''
    if (!a.items.length) {
      activeWrap.appendChild(textEl('span', undefined, 'Нет активных онлайн-матчей'))
      return
    }
    for (const it of a.items) {
      const row = document.createElement('div')
      row.style.display = 'flex'
      row.style.flexWrap = 'wrap'
      row.style.alignItems = 'center'
      row.style.gap = '10px'
      row.style.padding = '6px 0'
      row.style.borderBottom = '1px solid rgba(255,255,255,0.08)'
      const nick = it.players.map((p) => p.nickname).join(' · ')
      const lab = textEl('span', undefined, `${it.code} — ${nick}`)
      lab.style.flex = '1'
      lab.style.minWidth = '12rem'
      const wBtn = textEl('button', 'btn-secondary', 'Наблюдать')
      ;(wBtn as HTMLButtonElement).type = 'button'
      wBtn.addEventListener('click', () => opts.onWatch(it.code))
      row.append(lab, wBtn)
      activeWrap.appendChild(row)
    }
  }

  async function pollLive(): Promise<void> {
    if (stop) return
    try {
      const a = await apiJsonWithRefresh<AdminActive>('/admin/active')
      renderActive(a)
    } catch {
      liveText.textContent = 'Не удалось загрузить данные в реальном времени'
    }
  }

  async function loadJournal(): Promise<void> {
    journalBody.textContent = 'Загрузка…'
    const q = new URLSearchParams()
    if (fromIn.value) q.set('from', new Date(`${fromIn.value}T00:00:00.000Z`).toISOString())
    if (toIn.value) q.set('to', new Date(`${toIn.value}T23:59:59.999Z`).toISOString())
    try {
      const path = `/admin/matches${q.toString() ? `?${q}` : ''}`
      const { items } = await apiJsonWithRefresh<{ items: MatchJournalItem[] }>(path)
      journalBody.innerHTML = ''
      if (!items.length) {
        journalBody.textContent = 'Нет записей'
        return
      }
      const ul = document.createElement('ul')
      ul.style.cssText = 'list-style:none;padding:0;margin:0'
      for (const m of items) {
        const li = document.createElement('li')
        li.style.cssText = 'padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)'
        const names = m.players.map((p) => `${p.nickname}${p.isWinner ? ' ✓' : ''}`).join(' vs ')
        const dur =
          typeof m.duration === 'number' && m.duration >= 0 ? ` · длительность ${m.duration} с` : ''
        li.textContent = `${new Date(m.finishedAt).toLocaleString('ru-RU')} · ${m.type} · ${formatSetsDisplay(m.sets)} · ${names}${dur}`
        ul.appendChild(li)
      }
      journalBody.appendChild(ul)
    } catch {
      journalBody.textContent = 'Ошибка загрузки журнала'
    }
  }

  async function loadPlayers(): Promise<void> {
    playersBody.textContent = 'Загрузка…'
    try {
      const { items } = await apiJsonWithRefresh<{ items: PlayerRow[] }>('/admin/players')
      playersBody.innerHTML = ''
      if (!items.length) {
        playersBody.textContent = 'Нет зарегистрированных игроков'
        return
      }
      const ul = document.createElement('ul')
      ul.style.cssText = 'list-style:none;padding:0;margin:0'
      for (const p of items) {
        const li = document.createElement('li')
        li.style.cssText = 'padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)'
        li.textContent = `${p.nickname}: матчей ${p.matches}, побед ${p.wins}, поражений ${p.losses}, ${p.winRatePercent}% побед`
        ul.appendChild(li)
      }
      playersBody.appendChild(ul)
    } catch {
      playersBody.textContent = 'Ошибка загрузки списка игроков'
    }
  }

  loadJ.addEventListener('click', () => void loadJournal())
  void loadStats()
  void pollLive()
  void loadJournal()
  void loadPlayers()
  pollTimer = setInterval(() => void pollLive(), 4000)

  return () => {
    stop = true
    if (pollTimer) clearInterval(pollTimer)
  }
}

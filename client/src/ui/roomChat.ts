import type { Socket } from 'socket.io-client'

export type ChatLine = { from: string; text: string; timestamp: number }

export type ReactionType = 'heart' | 'fire' | 'cry' | 'halo' | 'angry'

const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: 'heart', emoji: '❤️', label: 'Сердечко' },
  { type: 'fire', emoji: '🔥', label: 'Огонь' },
  { type: 'cry', emoji: '😭', label: 'Плач' },
  { type: 'halo', emoji: '😇', label: 'Нимб' },
  { type: 'angry', emoji: '😡', label: 'Злость' },
]

function appendLine(msgs: HTMLElement, m: ChatLine): void {
  const line = document.createElement('div')
  line.style.cssText = 'margin-bottom:4px;word-break:break-word'
  const who = document.createElement('span')
  who.style.color = '#a8c8ff'
  who.textContent = m.from
  const body = document.createElement('span')
  body.textContent = `: ${m.text}`
  line.append(who, body)
  msgs.appendChild(line)
  msgs.scrollTop = msgs.scrollHeight
}

/**
 * Чат комнаты: левый нижний угол, сворачивание, индикатор непрочитанного, реакции.
 */
export function mountRoomChat(
  gameEl: HTMLElement,
  sock: Socket,
  opts: {
    initialLines?: ChatLine[]
    /** false = развёрнут (по умолчанию для лобби и матча) */
    startCollapsed?: boolean
  },
): () => void {
  const initial = opts.initialLines ?? []
  const startCollapsed = opts.startCollapsed ?? false

  const root = document.createElement('div')
  root.className = 'room-chat-panel'
  root.style.cssText =
    'position:absolute;left:8px;bottom:8px;z-index:46;display:flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:min(340px,calc(100% - 16px));pointer-events:auto'

  const head = document.createElement('div')
  head.style.cssText = 'display:flex;align-items:center;gap:8px'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'btn-secondary'
  toggle.style.cssText = 'padding:6px 12px;font:13px system-ui;border-radius:8px'
  toggle.textContent = 'Чат'

  const unread = document.createElement('span')
  unread.style.cssText =
    'display:none;width:10px;height:10px;border-radius:50%;background:#ff6b8a;box-shadow:0 0 6px #ff6b8a'
  unread.title = 'Новые сообщения'
  unread.setAttribute('aria-hidden', 'true')

  const body = document.createElement('div')
  body.style.cssText =
    'display:flex;flex-direction:column;gap:6px;width:100%;min-width:min(280px,88vw)'

  const msgs = document.createElement('div')
  msgs.style.cssText =
    'max-height:min(140px,24vh);overflow-y:auto;font:12px system-ui;background:rgba(20,20,40,0.92);border-radius:8px;padding:8px;color:#e8e8f0;border:1px solid #3a3a55'

  for (const m of initial) appendLine(msgs, m)

  const reactRow = document.createElement('div')
  reactRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center'
  reactRow.setAttribute('role', 'group')
  reactRow.setAttribute('aria-label', 'Быстрые реакции')
  for (const r of REACTIONS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = r.emoji
    b.title = r.label
    b.style.cssText =
      'font-size:20px;line-height:1;padding:4px 6px;border-radius:8px;border:1px solid #4a4a68;background:rgba(30,30,50,0.95);cursor:pointer'
    b.addEventListener('click', () => {
      sock.emit('chat:reaction', { type: r.type })
    })
    reactRow.appendChild(b)
  }

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:6px;align-items:center;width:100%'
  const inp = document.createElement('input')
  inp.type = 'text'
  inp.maxLength = 200
  inp.placeholder = 'Сообщение…'
  inp.autocomplete = 'off'
  inp.style.cssText =
    'flex:1;min-width:0;padding:6px 8px;border-radius:6px;border:1px solid #4a4a68;background:#1a1a2e;color:#e8e8f0;font:13px system-ui'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn-primary'
  btn.textContent = 'Отпр.'
  btn.style.cssText = 'padding:6px 10px;font:13px system-ui;flex-shrink:0'

  let collapsed = startCollapsed

  const applyCollapsed = (): void => {
    body.style.display = collapsed ? 'none' : 'flex'
    toggle.textContent = collapsed ? 'Чат' : 'Свернуть чат'
    if (!collapsed) {
      unread.style.display = 'none'
      msgs.scrollTop = msgs.scrollHeight
    }
  }

  toggle.addEventListener('click', () => {
    collapsed = !collapsed
    applyCollapsed()
  })

  const send = (): void => {
    const t = inp.value.trim()
    if (!t) return
    sock.emit('chat:message', { text: t })
    inp.value = ''
  }
  btn.addEventListener('click', send)
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send()
  })

  const onChat = (msg: ChatLine): void => {
    appendLine(msgs, msg)
    if (collapsed) {
      unread.style.display = 'inline-block'
    }
  }
  sock.on('chat:message', onChat)

  row.append(inp, btn)
  body.append(msgs, reactRow, row)
  head.append(toggle, unread)
  root.append(head, body)
  gameEl.appendChild(root)

  applyCollapsed()

  return () => {
    sock.off('chat:message', onChat)
    root.remove()
  }
}

export function showRoomToast(host: HTMLElement, message: string, ms = 3200): void {
  const t = document.createElement('div')
  t.style.cssText =
    'position:absolute;left:50%;bottom:120px;transform:translateX(-50%);z-index:55;max-width:min(320px,90vw);padding:10px 14px;border-radius:10px;background:rgba(40,28,48,0.96);color:#f0e0f0;font:14px system-ui;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.35)'
  t.textContent = message
  host.appendChild(t)
  setTimeout(() => t.remove(), ms)
}

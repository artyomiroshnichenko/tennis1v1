import { LS_ACCESS, LS_REFRESH } from '../sessionKeys'

const PREFIX = '/api/v1'

export type ApiErr = Error & { code?: string; status?: number }

export async function apiJson<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!init?.skipAuth) {
    const t = localStorage.getItem(LS_ACCESS)
    if (t) headers.set('Authorization', `Bearer ${t}`)
  }
  const res = await fetch(`${PREFIX}${path}`, { ...init, headers })
  if (res.status === 204) {
    return undefined as T
  }
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const body = data as { error?: string; code?: string }
    const err = new Error(body?.error ?? res.statusText) as ApiErr
    err.code = body?.code
    err.status = res.status
    throw err
  }
  return data as T
}

export async function refreshSession(): Promise<boolean> {
  const r = localStorage.getItem(LS_REFRESH)
  if (!r) return false
  try {
    const d = await apiJson<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: r }),
      skipAuth: true,
    })
    localStorage.setItem(LS_ACCESS, d.accessToken)
    localStorage.setItem(LS_REFRESH, d.refreshToken)
    return true
  } catch {
    localStorage.removeItem(LS_ACCESS)
    localStorage.removeItem(LS_REFRESH)
    return false
  }
}

export async function apiJsonWithRefresh<T>(
  path: string,
  init?: RequestInit & { skipAuth?: boolean },
): Promise<T> {
  try {
    return await apiJson<T>(path, init)
  } catch (e) {
    const err = e as ApiErr
    if (err.status === 401 && !init?.skipAuth) {
      const ok = await refreshSession()
      if (ok) return await apiJson<T>(path, init)
    }
    throw e
  }
}

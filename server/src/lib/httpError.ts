import type { Response } from 'express'

export function sendApiError(res: Response, status: number, code: string, error: string): void {
  res.status(status).json({ error, code })
}

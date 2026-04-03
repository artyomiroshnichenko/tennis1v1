/** Короткие сигналы без внешних файлов — закрывает перечень звуков эпика на уровне «слышимое событие». */

function ctxOnce(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    return AC ? new AC() : null
  } catch {
    return null
  }
}

function beep(
  freq: number,
  ms: number,
  gain: number,
  type: OscillatorType = 'sine',
  freqEnd?: number,
): void {
  const ctx = ctxOnce()
  if (!ctx) return
  try {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, ctx.currentTime)
    if (freqEnd !== undefined && freqEnd !== freq) {
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), ctx.currentTime + ms / 1000)
    }
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000)
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + ms / 1000)
    void ctx.resume()
  } catch {
    /* ignore */
  }
}

export const matchAudio = {
  racketHit: (): void => beep(720, 45, 0.055, 'triangle', 420),
  ballBounce: (): void => beep(180, 55, 0.04, 'sine', 120),
  point: (): void => beep(520, 50, 0.045),
  gameWon: (): void => {
    beep(440, 80, 0.05)
    setTimeout(() => beep(660, 100, 0.05), 70)
  },
  setWon: (): void => {
    beep(392, 90, 0.055)
    setTimeout(() => beep(523, 90, 0.055), 85)
    setTimeout(() => beep(659, 120, 0.06), 175)
  },
  net: (): void => beep(220, 90, 0.05),
  out: (): void => beep(160, 110, 0.055),
  ace: (): void => {
    beep(880, 70, 0.05)
    setTimeout(() => beep(990, 90, 0.045), 60)
  },
  let: (): void => beep(660, 100, 0.045),
  fault: (): void => beep(300, 120, 0.05),
  sidesChange: (): void => beep(360, 140, 0.05),
  matchWin: (): void => {
    beep(523, 100, 0.055)
    setTimeout(() => beep(659, 100, 0.055), 90)
    setTimeout(() => beep(784, 180, 0.06), 190)
  },
  matchLose: (): void => {
    beep(392, 140, 0.055)
    setTimeout(() => beep(294, 200, 0.05), 100)
  },
}

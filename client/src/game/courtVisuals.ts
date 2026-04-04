import * as THREE from 'three'

/** Псевдослучай [0, 1) для лёгкой фактуры без внешних файлов. */
function hashNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 31.37) * 43758.5453
  return n - Math.floor(n)
}

/** Текстура синего харда с лёгким зерном (tiling на плоскости корта). */
export function createHardCourtSurfaceTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const br = 0x1a
  const bg = 0x6c
  const bb = 0xb5
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const n = hashNoise(x * 0.17, y * 0.17, 2)
      const v = (n - 0.5) * 22
      img.data[i] = Math.max(0, Math.min(255, br + v))
      img.data[i + 1] = Math.max(0, Math.min(255, bg + v * 0.35))
      img.data[i + 2] = Math.max(0, Math.min(255, bb + v * 0.25))
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(5, 9)
  tex.anisotropy = 4
  return tex
}

/** Текстура травы вокруг одиночки. */
export function createOuterGrassTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const br = 0x45
  const bg = 0xa8
  const bb = 0x52
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const n = hashNoise(x * 0.11, y * 0.11, 5)
      const v = (n - 0.5) * 28
      img.data[i] = Math.max(0, Math.min(255, br + v * 0.6))
      img.data[i + 1] = Math.max(0, Math.min(255, bg + v * 0.45))
      img.data[i + 2] = Math.max(0, Math.min(255, bb + v * 0.5))
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(7, 11)
  tex.anisotropy = 4
  return tex
}

/**
 * Альфа-сетка для вертикальной сетки: линии на прозрачном фоне + полоса ленты сверху на текстуре.
 */
export function createNetGridTexture(): THREE.CanvasTexture {
  const W = 512
  const H = 256
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)

  const cols = 56
  const rows = 14
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(235, 238, 248, 0.82)'
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * W
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, H)
    ctx.stroke()
  }
  for (let j = 0; j <= rows; j++) {
    const y = (j / rows) * H
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(W, y + 0.5)
    ctx.stroke()
  }

  const tapeH = Math.round(H * 0.07)
  ctx.fillStyle = 'rgba(248, 248, 255, 0.96)'
  ctx.fillRect(0, 0, W, tapeH)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  return tex
}

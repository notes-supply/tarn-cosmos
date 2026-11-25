/**
 * Fixed-view renders without a browser or GPU: a small orthographic z-buffer
 * rasterizer with flat shading and depth-edge outlines, written to PNG with
 * fflate. The output only depends on the meshes, so renders of the same design
 * are byte-identical between runs.
 */

import { zlibSync } from 'fflate'
import type { TriMesh } from './solids'

type Vec = [number, number, number]
export type RGB = [number, number, number]

export interface RenderItem {
  mesh: TriMesh
  color: RGB
}

export interface View {
  /** Direction the camera looks along (from the camera toward the model). */
  look: Vec
  /** Approximate screen-up direction. */
  up: Vec
}

export const VIEWS = {
  top: { look: [0, 0, -1], up: [0, 1, 0] },
  front: { look: [0, 1, 0], up: [0, 0, 1] },
  isoRight: { look: [-1, 1, -1], up: [0, 0, 1] },
  isoLeft: { look: [1, 1, -1], up: [0, 0, 1] },
} satisfies Record<string, View>

const norm = (v: Vec): Vec => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** `edgeMm`: depth step (mm) drawn as an outline; close-ups of one socket need a finer one than whole-case views. */
export function render(items: RenderItem[], view: View, width = 1024, height = 1024, supersample = 2, edgeMm = 1.5): Uint8Array {
  const look = norm(view.look)
  const right = norm(cross(look, view.up))
  const up = cross(right, look)
  const light = norm([-look[0] + 0.35 * up[0] + 0.25 * right[0], -look[1] + 0.35 * up[1] + 0.25 * right[1], -look[2] + 0.35 * up[2] + 0.25 * right[2]])

  // Fit the projected bounds into the image with a margin.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const { mesh } of items) {
    const p = mesh.positions
    for (let i = 0; i < p.length; i += 3) {
      const v: Vec = [p[i], p[i + 1], p[i + 2]]
      const x = dot(v, right), y = dot(v, up)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const W = width * supersample, H = height * supersample
  const margin = 0.05
  const scale = Math.min(W * (1 - 2 * margin) / (maxX - minX || 1), H * (1 - 2 * margin) / (maxY - minY || 1))
  const offX = W / 2 - scale * (minX + maxX) / 2
  const offY = H / 2 + scale * (minY + maxY) / 2

  const depth = new Float32Array(W * H).fill(Infinity)
  const color = new Uint8Array(W * H * 3).fill(255)

  for (const { mesh, color: base } of items) {
    const p = mesh.positions
    const n = p.length / 3
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const v: Vec = [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
      sx[i] = offX + scale * dot(v, right)
      sy[i] = offY - scale * dot(v, up)
      sz[i] = dot(v, look)
    }
    const idx = mesh.indices
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2]
      // Facet normal from the model-space triangle; light both sides.
      const u: Vec = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]]
      const w: Vec = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]]
      const nrm = cross(u, w)
      const nl = Math.hypot(...nrm)
      if (nl == 0) continue
      const shade = 0.3 + 0.7 * Math.abs(dot(nrm, light) / nl)
      const r = Math.min(255, base[0] * shade), g = Math.min(255, base[1] * shade), bl = Math.min(255, base[2] * shade)

      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
      if (area == 0) continue
      const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])))
      const x1 = Math.min(W - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])))
      const y0 = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])))
      const y1 = Math.min(H - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])))
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5
          const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area
          const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area
          const w2 = 1 - w0 - w1
          if (w0 < 0 || w1 < 0 || w2 < 0) continue
          const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c]
          const k = y * W + x
          if (z >= depth[k]) continue
          depth[k] = z
          color[3 * k] = r
          color[3 * k + 1] = g
          color[3 * k + 2] = bl
        }
      }
    }
  }

  // Darken pixels at depth discontinuities so silhouettes and steps read clearly.
  const edge = edgeMm
  const far = (a: number, b: number) => (a == Infinity) != (b == Infinity) || Math.abs(a - b) > edge
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x
      const d = depth[k]
      if (far(depth[k - 1], d) || far(depth[k + 1], d) || far(depth[k - W], d) || far(depth[k + W], d)) {
        color[3 * k] *= 0.35
        color[3 * k + 1] *= 0.35
        color[3 * k + 2] *= 0.35
      }
    }
  }

  // Box-filter down to the output size.
  const out = new Uint8Array(width * height * 3)
  const s2 = supersample * supersample
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0
        for (let dy = 0; dy < supersample; dy++) {
          for (let dx = 0; dx < supersample; dx++) sum += color[3 * ((y * supersample + dy) * W + x * supersample + dx) + ch]
        }
        out[3 * (y * width + x) + ch] = Math.round(sum / s2)
      }
    }
  }
  return png(out, width, height)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Encode 8-bit RGB pixels as a PNG. */
export function png(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0 // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1)
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit, truecolour, deflate, no filter, no interlace
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const file = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    file.set(p, o)
    o += p.length
  }
  return file
}

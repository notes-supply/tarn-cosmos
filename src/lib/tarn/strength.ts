/**
 * Hand calculation of the Tarn socket's backstop (socket.ts) under the switch
 * insertion force: where the force goes, and the stress in each part of the
 * path. It is a first-order check, not a finite-element model:
 *
 * - Load: LOADS.insertionN (30 N, Kailh's 3 kgf maximum mating force [K-S30]),
 *   split equally between the two switch contacts. It acts on the hotswap
 *   socket, which bears on the keeper.
 * - The keeper is rigid and rests on its tongues. The tongues bear on the
 *   window floors, which are elastic supports of equal stiffness, so the
 *   reactions follow a plane (a + b x + c y); a negative reaction would mean
 *   that tongue is held down by its window's ceiling.
 * - Each reaction then passes through: the tongue (shear and bending at its
 *   root), the window floor (a beam fixed at both ends of the window), and the
 *   post at the window, in tension with the bending from the reaction's offset
 *   in the post. The keeper plate itself is checked as a beam between the -Y
 *   tongues and the P3a tongue.
 * - Print directions: the keeper prints flat, so its stresses are in the layer
 *   plane. The case prints upright (open side down), so a post hanging from the
 *   plate is pulled across its layers; the window floor bends along the layers.
 *
 * Strengths are conservative round numbers for FDM PLA or PETG, **unverified**
 * (they depend on the printer, material and settings): in-layer tension and
 * bending 40 MPa, across layers 15 MPa, shear 10 MPa. The check asks for a
 * safety factor of at least MIN_SAFETY on each.
 */

import { CONTACTS, KEEPER_PARTS, KEEPER_THICKNESS, KEEPER_TONGUES, LOADS, POST_FOOT, POSTS, TONGUE, WINDOW } from './socket'

export const STRENGTH_MPA = { inLayer: 40, acrossLayers: 15, shear: 10 } as const
export const MIN_SAFETY = 2

interface Support {
  name: string
  post: keyof typeof POSTS
  /** The tongue (keeper) and its window (post), x range. */
  tongue: [number, number, number, number]
  window: [number, number]
  /** Where the reaction acts: middle of the tongue's bearing on the window floor. */
  at: [number, number]
}

function supports(): Support[] {
  const out: Support[] = []
  for (const name of ['W', 'P4', 'P3a'] as const) {
    const post = POSTS[name]
    for (const w of post.windows) {
      const t = KEEPER_TONGUES.find(r => r[0] >= w[0] && r[2] <= w[1])!
      const face = post.rect[3]
      // The tongue reaches TONGUE.depth past the keeper edge, which sits 0.2 mm short of the post face.
      out.push({ name: `${name} [${w[0]}, ${w[1]}]`, post: name, tongue: t, window: w, at: [(t[0] + t[2]) / 2, face - (TONGUE.depth - 0.2) / 2] })
    }
  }
  return out
}

function solve3(m: number[][], v: number[]) {
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const d = det(m)
  return [0, 1, 2].map(i => det(m.map((row, r) => row.map((x, c) => (c == i ? v[r] : x)))) / d)
}

export interface StressLine {
  part: string
  stressMpa: number
  strengthMpa: number
  direction: 'in layer' | 'across layers' | 'shear'
  safety: number
}

export interface StrengthReport {
  loadN: number
  reactions: { support: string; at: [number, number]; reactionN: number }[]
  lines: StressLine[]
  minSafety: number
}

const r2 = (x: number) => Math.round(x * 100) / 100

/**
 * The section of a post across its hanging direction at a window, between x0 and x1: the post's
 * rectangle minus the window pocket. Returns its area, centroid in Y, second moment about the X
 * axis through the centroid and the distance to its farthest fibre in Y.
 */
function postSection(post: [number, number, number, number], x0: number, x1: number, window: [number, number]) {
  const [, y0, , y1] = post
  const face = y1, back = y1 - WINDOW.depth
  const w0 = Math.max(window[0], x0), w1 = Math.min(window[1], x1)
  // Rectangles (width in X, from y, to y): the whole strip, minus the pocket.
  const parts = [
    { b: x1 - x0, ya: y0, yb: y1, sign: 1 },
    { b: Math.max(0, w1 - w0), ya: back, yb: face, sign: -1 },
  ]
  const area = parts.reduce((a, p) => a + p.sign * p.b * (p.yb - p.ya), 0)
  const centroid = parts.reduce((a, p) => a + p.sign * p.b * (p.yb - p.ya) * ((p.ya + p.yb) / 2), 0) / area
  const inertia = parts.reduce((a, p) => {
    const h = p.yb - p.ya, d = (p.ya + p.yb) / 2 - centroid
    return a + p.sign * (p.b * h ** 3 / 12 + p.b * h * d * d)
  }, 0)
  return { area, centroid, inertia, c: Math.max(centroid - y0, y1 - centroid) }
}

export function backstopStrength(load = LOADS.insertionN): StrengthReport {
  const sup = supports()
  const forces = CONTACTS.map(at => ({ at, f: load / CONTACTS.length }))
  const F = forces.reduce((s, p) => s + p.f, 0)
  const Mx = forces.reduce((s, p) => s + p.f * p.at[0], 0)
  const My = forces.reduce((s, p) => s + p.f * p.at[1], 0)
  // Reactions R_i = a + b x_i + c y_i with sum R = F, sum R x = Mx, sum R y = My.
  const S = (f: (s: Support) => number) => sup.reduce((acc, s) => acc + f(s), 0)
  const A = [
    [sup.length, S(s => s.at[0]), S(s => s.at[1])],
    [S(s => s.at[0]), S(s => s.at[0] ** 2), S(s => s.at[0] * s.at[1])],
    [S(s => s.at[1]), S(s => s.at[0] * s.at[1]), S(s => s.at[1] ** 2)],
  ]
  const [a, b, c] = solve3(A, [F, Mx, My])
  const reactions = sup.map(s => ({ support: s.name, at: s.at, reactionN: a + b * s.at[0] + c * s.at[1] }))

  const lines: StressLine[] = []
  const line = (part: string, stress: number, direction: StressLine['direction']) => {
    const strength = direction == 'in layer' ? STRENGTH_MPA.inLayer : direction == 'across layers' ? STRENGTH_MPA.acrossLayers : STRENGTH_MPA.shear
    lines.push({ part, stressMpa: r2(stress), strengthMpa: strength, direction, safety: r2(strength / Math.max(stress, 1e-9)) })
  }
  sup.forEach((s, i) => {
    const R = Math.abs(reactions[i].reactionN)
    const len = s.tongue[2] - s.tongue[0]
    const t = TONGUE.thickness
    // Tongue root (keeper, printed flat): mean shear x 1.5, and bending with the load at mid-tongue.
    line(`${s.name}: tongue root shear`, (1.5 * R) / (len * t), 'shear')
    line(`${s.name}: tongue root bending`, (6 * R * (TONGUE.depth / 2)) / (len * t * t), 'in layer')
    // Window floor: beam fixed at both ends of the window, as deep as POST_FOOT, as wide as the post.
    const post = POSTS[s.post].rect
    const thick = post[3] - post[1]
    const span = s.window[1] - s.window[0]
    line(`${s.name}: window floor bending`, (6 * ((R * span) / 8)) / (thick * POST_FOOT ** 2), 'in layer')
    // The post at the window level: its full-thickness piers and the wall behind the window, over
    // this window's share of the post (posts with two windows are split between them), pulled
    // across the layers, plus the bending from the reaction's offset from that section's centroid.
    const windows = POSTS[s.post].windows
    const k = windows.indexOf(s.window)
    const x0 = k == 0 ? post[0] : (windows[k - 1][1] + s.window[0]) / 2
    const x1 = k == windows.length - 1 ? post[2] : (s.window[1] + windows[k + 1][0]) / 2
    const section = postSection(post, x0, x1, s.window)
    const e = Math.abs(s.at[1] - section.centroid)
    line(`${s.name}: post at the window (tension + bending)`, R / section.area + (R * e * section.c) / section.inertia, 'across layers')
  })
  // Keeper plate: a beam from the -Y tongues to the P3a tongue, the whole load at the contacts'
  // centroid, the width of the plate under the island.
  const yA = Math.min(...sup.filter(s => s.post != 'P3a').map(s => s.at[1]))
  const yB = sup.find(s => s.post == 'P3a')!.at[1]
  const yF = My / F
  const span = yB - yA
  const M = (F * (yF - yA) * (yB - yF)) / span
  const plate = KEEPER_PARTS[0]
  const width = Math.min(plate[2] - plate[0], 10) // conservative: a 10 mm wide strip carries it
  line('keeper plate bending', (6 * M) / (width * KEEPER_THICKNESS ** 2), 'in layer')
  return { loadN: load, reactions: reactions.map(r => ({ ...r, reactionN: r2(r.reactionN) })), lines, minSafety: Math.min(...lines.map(l => l.safety)) }
}

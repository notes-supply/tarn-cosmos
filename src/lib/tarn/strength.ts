/**
 * Hand calculation of the Tarn socket's backstop (socket.ts) under the switch
 * insertion force: where the force goes, the stress in each part of the path,
 * how far the path gives, and the torque the adjuster takes to set. It is a
 * first-order check, not a finite-element model:
 *
 * - Load: LOADS.insertionN (30 N, Kailh's 3 kgf maximum mating force [K-S30]).
 *   It pushes the hotswap socket onto the adjuster's pad, which carries it
 *   through its thread into the keeper.
 * - The keeper is rigid and rests on its tongues. The tongues bear on the
 *   window floors, which are elastic supports of equal stiffness, so the
 *   reactions follow a plane (a + b x + c y); a negative reaction would mean
 *   that tongue is held down by its window's ceiling.
 * - Each reaction then passes through: the tongue (shear and bending at its
 *   root), the window floor (a beam fixed at both ends of the window), and the
 *   post at the window, in tension with the bending from the reaction's offset
 *   in the post. The keeper plate is checked as a beam between the -Y tongues
 *   and the P3a tongue, at its section through the adjuster's thread.
 * - Print directions: the keeper prints flat and the adjuster on its end, so the
 *   keeper's stresses are in the layer plane and the adjuster's are across its
 *   layers. The case prints upright (open side down), so a post hanging from
 *   the plate is pulled across its layers; the window floor bends along them.
 *
 * Strengths are conservative round numbers for FDM PLA or PETG, **unverified**
 * (they depend on the printer, material and settings): in-layer tension and
 * bending 40 MPa, across layers 15 MPa, shear 10 MPa. The check asks for a
 * safety factor of at least MIN_SAFETY on each. The stiffness and friction
 * values below are **unverified** too.
 *
 * Why a screw and not a spring. The socket's contacts grip the pins with up to
 * the mating force. A sprung backstop that has to close the gap must push the
 * island up harder than that at every point of the stack tolerance: at least
 * 30 N over 1.2 mm of travel (PAD_RANGE), after the 30 N of each insertion has
 * pushed it down. Otherwise the island stops wherever the pins' grip balances
 * the spring, below the spacer. flexureLimit() shows that a printed flexure
 * under the island gives about a newton at most with that travel; a printed
 * spring also creeps under a constant load. The screw has no travel under
 * load: it is set once, before any switch is in, against the spacer, and a
 * thread that self-locks does not turn back under 30 N. Pulling a switch
 * pulls the island against the spacer (the clamp), which unloads the screw,
 * so neither insertion nor removal can turn it.
 */

import { ADJUSTER, HEX, ISLAND, KEEPER_BOTTOM, KEEPER_PARTS, KEEPER_THICKNESS, KEEPER_TONGUES, KEEPER_TOP, LOADS, PAD_RANGE, POST_FOOT, POSTS, SPACER_BOTTOM, TONGUE, WINDOW } from './socket'

export const STRENGTH_MPA = { inLayer: 40, acrossLayers: 15, shear: 10 } as const
export const MIN_SAFETY = 2
/**
 * Elastic modulus for deflection: 2 GPa, a conservative round number for
 * printed PLA or PETG across layers (unverified; PLA filament datasheets give
 * about 3.5 GPa in the layer plane).
 */
export const MODULUS_MPA = 2000
/** Printed PLA or PETG on itself, dry (unverified). It sets the adjuster's torque and its self-locking. */
export const FRICTION = 0.3
/** The thread's flank half-angle: the round thread is taken as a 30-degree flank (unverified approximation). */
export const FLANK_DEG = 30
/** Contact flattening and layer bedding under the pad and on the window floors, added to the deflection (our assumption, unverified). */
export const BEDDING_MM = 0.02

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
  /** How far the island moves down under the load, by part (mm). */
  deflectionMm: Record<string, number> & { total: number }
  adjuster: {
    /** Torque per newton of axial force on the pad, N·mm/N: lead + thread friction + pad friction. */
    torquePerNewtonMm: number
    /** Torque at which the adjuster would load the backstop to its 30 N design force. */
    setTorqueNmm: number
    /** The hex socket's thinnest wall, to the thread root (mm). */
    hexWallMm: number
    /** The thread self-locks when the friction exceeds the lead: tan(lead angle) < FRICTION / cos(flank). */
    leadTan: number
    selfLocking: boolean
    /** Thread length engaged in the keeper at the lowest setting (mm). */
    engagedMm: number
  }
  /** flexureLimit(): what a printed spring under the island could give. */
  spring: ReturnType<typeof flexureLimit>
}

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

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

/**
 * The largest force a printed flexure under the island could give over the
 * adjuster's travel (PAD_RANGE) at the in-layer strength over MIN_SAFETY: a
 * beam across the island's shorter side, loaded at its middle, as wide as the
 * island. For a centre-loaded simply supported beam the stress at deflection d
 * is 6 E t d / L^2, so the thickness is set by the travel, and the force is
 * then 4 E b t^3 d / L^3.
 */
export function flexureLimit() {
  const span = ISLAND[3] - ISLAND[1]
  const width = ISLAND[2] - ISLAND[0]
  const travel = PAD_RANGE[1] - PAD_RANGE[0]
  const allowable = STRENGTH_MPA.inLayer / MIN_SAFETY
  const E = 3500 // the stiffer in-layer value favours the spring
  const t = (allowable * span ** 2) / (6 * E * travel)
  const force = (4 * E * width * t ** 3 * travel) / span ** 3
  return { spanMm: r2(span), widthMm: r2(width), travelMm: r3(travel), thicknessMm: r3(t), maxForceN: r2(force), neededN: LOADS.insertionN }
}

export function backstopStrength(load = LOADS.insertionN): StrengthReport {
  const sup = supports()
  const at = ADJUSTER.at
  const F = load
  const Mx = F * at[0]
  const My = F * at[1]
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
  const deflection: Record<string, number> = {}
  const E = MODULUS_MPA

  // The adjuster. The pad bears on the socket body; the core between the pad and the keeper is
  // in compression; the thread can strip on a cylinder at its mean radius over half its length
  // (the lobe fills half of each turn), in the keeper or in the adjuster.
  // The hex socket (ADR 0014) runs up the bottom of the adjuster, through most of the engaged
  // thread, so the core is taken as a tube everywhere: its area less the socket's.
  const { lobe, offset, pad, pitch, clearance } = ADJUSTER
  const core = lobe - offset
  const mean = lobe
  const hexArea = (Math.sqrt(3) / 2) * HEX.across ** 2
  const hexCorner = HEX.across / Math.sqrt(3)
  const coreArea = Math.PI * core ** 2 - hexArea
  const threadTopLowest = PAD_RANGE[0] - pad.height
  const engaged = Math.min(KEEPER_THICKNESS, threadTopLowest - KEEPER_BOTTOM)
  line('adjuster pad on the socket body (compression)', F / (Math.PI * pad.radius ** 2), 'across layers')
  line('adjuster core around the hex socket (compression)', F / coreArea, 'across layers')
  line('adjuster thread stripping', F / (2 * Math.PI * mean * engaged * 0.5), 'shear')
  // Core compression from the pad to the middle of the engaged thread, at the highest setting (the longest).
  const coreLength = PAD_RANGE[1] - (KEEPER_TOP + KEEPER_BOTTOM) / 2
  deflection.adjusterCore = (F * coreLength) / (E * coreArea)

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
    const floorDeflection = (R * span ** 3) / (192 * E * ((thick * POST_FOOT ** 3) / 12))
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
    const postStretch = (R * (SPACER_BOTTOM - WINDOW.floor)) / (E * section.area)
    // The keeper is rigid on its supports, so the worst support's give is an upper bound at the pad.
    deflection.windowFloors = Math.max(deflection.windowFloors ?? 0, floorDeflection)
    deflection.posts = Math.max(deflection.posts ?? 0, postStretch)
  })

  // Keeper plate: a beam from the -Y tongues to the P3a tongue with the whole load at the adjuster,
  // at its section through the thread (the plate under the island less the hole), at most 10 mm wide.
  const yA = Math.min(...sup.filter(s => s.post != 'P3a').map(s => s.at[1]))
  const yB = sup.find(s => s.post == 'P3a')!.at[1]
  const span = yB - yA
  const la = at[1] - yA, lb = yB - at[1]
  const M = (F * la * lb) / span
  const plate = KEEPER_PARTS[0]
  const hole = 2 * (lobe + offset + clearance)
  const width = Math.min(plate[2] - plate[0] - hole, 10)
  line('keeper plate bending (section through the thread)', (6 * M) / (width * KEEPER_THICKNESS ** 2), 'in layer')
  deflection.keeperPlate = (F * la ** 2 * lb ** 2) / (3 * E * ((width * KEEPER_THICKNESS ** 3) / 12) * span)
  deflection.bedding = BEDDING_MM
  const total = Object.values(deflection).reduce((s, d) => s + d, 0)

  // Torque to turn the adjuster against an axial force: lead, thread friction at the mean radius,
  // and the pad turning on the socket body (uniform pressure: 2/3 of its radius).
  const flank = Math.cos((FLANK_DEG * Math.PI) / 180)
  const torquePerNewton = pitch / (2 * Math.PI) + (FRICTION * mean) / flank + FRICTION * ((2 / 3) * pad.radius)
  const leadTan = pitch / (2 * Math.PI * mean)
  // The hex socket's wall, at its thinnest (between a hex corner and the thread root), as a thin tube in
  // torsion under the torque that would load the backstop to the full design force: more than a set
  // that stops when the island meets the spacer ever needs.
  const setTorque = torquePerNewton * LOADS.insertionN
  const wall = core - hexCorner
  const wallMean = (core + hexCorner) / 2
  line('adjuster wall round the hex socket (torsion at the design-load torque)', setTorque / (2 * Math.PI * wallMean ** 2 * wall), 'shear')
  return {
    loadN: load,
    reactions: reactions.map(r => ({ ...r, reactionN: r2(r.reactionN) })),
    lines,
    minSafety: Math.min(...lines.map(l => l.safety)),
    deflectionMm: { ...Object.fromEntries(Object.entries(deflection).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4])), total: r3(total) },
    adjuster: {
      torquePerNewtonMm: r3(torquePerNewton),
      setTorqueNmm: r2(setTorque),
      hexWallMm: r3(wall),
      leadTan: r3(leadTan),
      selfLocking: leadTan < FRICTION / flank,
      engagedMm: r3(engaged),
    },
    spring: flexureLimit(),
  }
}

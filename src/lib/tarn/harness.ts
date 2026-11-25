/**
 * Switch, socket and harness-stack facts for the Tarn flex harness, and the
 * per-key spec fields built from them (tarnSpec 0.2 and later: switchRotation, seat).
 *
 * Pure numbers: no CAD kernel and no Manifold, so the spec can be built
 * without either. The measurements against the exported case are in seat.ts.
 *
 * Datasheet frame. Every position below is in the switch's datasheet frame:
 * origin at the switch centre on the plate-top plane (the plane the top
 * housing seats on), +Z toward the keycap, and X/Y as the switch footprint is
 * drawn by KiCad and the manufacturers' top views, with KiCad's y negated so
 * the frame is right-handed. In this frame the contacts of Choc and MX
 * switches are on the +Y side and the LED window on the -Y side.
 * docs/research/switches.md (Tarn coordination repo) lists positions in
 * KiCad's convention, where +y is drawn downward toward the LED; a position
 * (x, y) there is (x, -y) here.
 *
 * Sources are the sections of docs/research/switches.md and
 * docs/research/flex-pcb.md that cite the manufacturer drawings, and ADR 0009
 * for the stack.
 */

import { PART_INFO, partBottom, socketSize } from '$lib/geometry/socketsParts'
import type { CuttleKey } from '$lib/worker/config'
import { SOCKET_ID, STIFFENER_TOP } from './socket'
import type { SpecKey } from './spec'

/** Cosmos turns some socket variants' switch model 180 degrees about Z (e.g. North vs South LED). */
export function partFlipped(key: CuttleKey) {
  const info = PART_INFO[key.type]
  return 'flipPart' in info && !!info.flipPart?.(key.variant || {})
}

export type SwitchFamily = 'choc-v2' | 'choc-v1' | 'mx'
type XY = [number, number]

/** A box in the switch frame. */
export interface Box3 {
  min: [number, number, number]
  max: [number, number, number]
}

/** A feature that sticks out below the switch's bottom housing. */
export interface Protrusion {
  name: string
  at: XY
  /** Envelope of the feature (its recommended PCB hole, or its diameter when no hole is given). */
  diameter: number
  /** z of its tip in the switch frame. */
  tipZ: number
}

export interface SocketBody {
  part: string
  /** Footprint including terminals, centred on the midpoint of the two receptacles, along X then Y. */
  size: XY
  /** Height of the body below the board, without the bosses that go into the board's holes. */
  base: number
  source: string
}

export interface SwitchFacts {
  /** z of the bottom of the bottom housing (the face a PCB would touch). */
  housingBottomZ: number
  /** Side of the square bottom housing. */
  housingSide: number
  /** The two electrical contacts: they define the hotswap socket's position. */
  contacts: XY[]
  /** Everything below the housing: contacts, centre post, fixing leg. */
  protrusions: Protrusion[]
  socket: SocketBody
  source: string
}

const CHOC_CONTACTS: XY[] = [[0, 5.9], [5, 3.8]]
const CHOC_SOCKET: SocketBody = {
  part: 'Kailh CPG135001S30',
  size: [13.45, 6.85],
  base: 1.8,
  source: 'switches.md §5 [K-S30]: 13.45 x 6.85 incl. terminals, base 1.80 ± 0.1. Centring the body on the receptacle midpoint is our reading (unverified)',
}

/** Datasheet facts per switch family (docs/research/switches.md). */
export const SWITCHES: Record<SwitchFamily, SwitchFacts> = {
  'choc-v2': {
    housingBottomZ: -2.2,
    housingSide: 13.95,
    contacts: CHOC_CONTACTS,
    protrusions: [
      ...CHOC_CONTACTS.map((at, i) => ({ name: `contact ${i + 1}`, at, diameter: 1.2, tipZ: -5.2 })),
      { name: 'centre post', at: [0, 0], diameter: 4.8, tipZ: -5.5 },
      { name: 'fixing leg', at: [-5, -5.15], diameter: 1.6, tipZ: -5.2 },
    ],
    socket: CHOC_SOCKET,
    source:
      'switches.md §1.2, §1.4 [K-V2R]: housing bottom 2.20 below the plate top, 13.95 bottom housing; contacts 3.00 below it (ø1.20 holes); centre post ø4.80, 3.30 long; fixing leg 3.00 long (ø1.6 hole per kiswitch)',
  },
  'choc-v1': {
    housingBottomZ: -2.2,
    housingSide: 13.8,
    contacts: CHOC_CONTACTS,
    protrusions: [
      ...CHOC_CONTACTS.map((at, i) => ({ name: `contact ${i + 1}`, at, diameter: 1.2, tipZ: -5.2 })),
      { name: 'centre post', at: [0, 0], diameter: 3.4, tipZ: -4.85 },
    ],
    socket: CHOC_SOCKET,
    source:
      'switches.md §2.1, §3 [K-V1R]: housing bottom 2.20 below the plate top, 13.80 bottom housing; contacts 3.00 below it; centre post 2.65 long, ø3.40 hole. Side-peg length is not in the research, so the pegs are not checked',
  },
  'mx': {
    housingBottomZ: -5,
    housingSide: 14,
    contacts: [[-3.81, 2.54], [2.54, 5.08]],
    protrusions: [
      { name: 'contact 1', at: [-3.81, 2.54], diameter: 1.5, tipZ: -8.3 },
      { name: 'contact 2', at: [2.54, 5.08], diameter: 1.5, tipZ: -8.3 },
    ],
    socket: {
      part: 'Kailh CPG151101S11-16',
      size: [14.5, 5.89],
      base: 1.8,
      source: 'switches.md §5 [K-S11-16]: 14.50 x 5.89, base 1.80 ± 0.05. Centring the body on the receptacle midpoint is our reading (unverified)',
    },
    source:
      'switches.md §3 [C-MXS]: housing bottom 5.0 below the plate top, 14.0 cutout; contacts 3.30 below the housing (ø1.50 holes). The centre post length is not in the research, so it is not checked',
  },
}

/**
 * The provisional harness stack under a switch that has no Tarn spacer (any
 * socket but choc-v2-tarn), top to bottom: stiffener, flex, then the hotswap
 * socket body. 1.6 mm is the board the socket is drawn for. ADR 0011 makes the
 * island steel 0.3 + flex 0.12 under a 1.2 mm printed spacer, which only the
 * Tarn socket has (socket.ts holds that stack); the same 1.62 mm in all.
 */
export const STACK = {
  flex: 0.12,
  flexSource: 'flex-pcb.md §2.8 G1: 1 layer, 50 µm PI, 18 µm Cu, 0.12 mm finished',
  stiffeners: [
    { thickness: 1.6, source: 'ADR 0009: FR4 1.6 mm on the switch side of every island (1.6 + 0.12 = 1.72, inside the ±10 % of the 1.6 mm board the socket is drawn for)' },
  ],
} as const

/**
 * Rotation about +Z from the datasheet frame to Cosmos's switch model, for the
 * models Cosmos shares between sockets (PART_INFO partOverride). Measured from
 * the model meshes: the Choc model has its contacts at (0, -5.87) and
 * (-5.00, -3.86), the MX model at (-3.77, 2.70) and (2.70, 5.20).
 */
const MODEL_ROTATION: Record<string, number> = {
  '/src/assets/switch-choc.glb': 180,
  '/target/switch-cherry-mx.glb': 0,
}

export function switchFacts(family: SpecKey['switch']): SwitchFacts | null {
  return family == 'other' ? null : SWITCHES[family]
}

/**
 * Degrees about the switch frame's +Z that take the datasheet frame to the
 * switch as Cosmos places it, or null when the part is not a Choc or MX switch
 * or its model's orientation has not been measured.
 */
export function switchRotation(key: CuttleKey, family: SpecKey['switch']): number | null {
  if (family == 'other') return null
  const info = PART_INFO[key.type]
  const model = 'partOverride' in info ? info.partOverride : undefined
  if (!model || !(model in MODEL_ROTATION)) return null
  return (MODEL_ROTATION[model] + (partFlipped(key) ? 180 : 0)) % 360
}

/** Rotate a datasheet-frame point by `deg` about +Z. Exact for multiples of 90 degrees. */
export function rotateXY([x, y]: XY, deg: number): XY {
  const quarter = ((Math.round(deg / 90) % 4) + 4) % 4
  if (Math.abs(deg - 90 * Math.round(deg / 90)) < 1e-9) {
    return ([[x, y], [-y, x], [-x, -y], [y, -x]] as XY[])[quarter]
  }
  const r = deg * Math.PI / 180
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]
}

const round = (x: number, digits = 6) => {
  const f = 10 ** digits
  const r = Math.round(x * f) / f
  return r == 0 ? 0 : r
}
export const roundBox = (b: Box3): Box3 => ({ min: b.min.map(v => round(v)) as Box3['min'], max: b.max.map(v => round(v)) as Box3['max'] })

/** Axis-aligned box (switch frame) of a datasheet-frame rectangle centred at `centre`, after rotation. */
function rotatedRect(centre: XY, size: XY, deg: number, zMin: number, zMax: number): Box3 {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotateXY([centre[0] + sx * size[0] / 2, centre[1] + sy * size[1] / 2], deg))
  const xs = corners.map(c => c[0]), ys = corners.map(c => c[1])
  return { min: [Math.min(...xs), Math.min(...ys), zMin], max: [Math.max(...xs), Math.max(...ys), zMax] }
}

export interface SpecSeat {
  /** z of the underside of Cosmos's socket (the plate) around the switch. */
  plateUndersideZ: number
  /** z where the top of the harness island's stiffener sits: the lower of the plate underside and the switch's housing bottom. */
  stiffenerTopZ: number
  /** Cosmos's own envelope under the switch (PART_INFO partBottom): the floor is placed below it. */
  reserved: Box3[]
  /** Measured free box under the switch's bottom-housing footprint, from stiffenerTopZ down to the first case, plate or holder material. null until measured. */
  clear: Box3 | null
}

/** The seat fields that need no CAD kernel. `clear` is filled in by seat.ts. */
export function specSeat(key: CuttleKey, family: SpecKey['switch']): SpecSeat | null {
  const facts = switchFacts(family)
  const size = socketSize(key, false)
  if (!facts || !Array.isArray(size)) return null
  const plateUndersideZ = -size[2]
  return {
    plateUndersideZ: round(plateUndersideZ),
    // Under the Tarn socket the island sits against the printed spacer's underside (ADR 0011).
    stiffenerTopZ: key.type == SOCKET_ID ? STIFFENER_TOP : round(Math.min(plateUndersideZ, facts.housingBottomZ)),
    reserved: partBottom(key).map(pts => {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), zs = pts.map(p => p[2])
      return roundBox({ min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)], max: [Math.max(...xs), Math.max(...ys), 0] })
    }),
    clear: null,
  }
}

/** Cosmos's socket footprint (socketSize without margins): the plate around the switch, which the stack's overhang is measured against. */
export function seatFootprint(key: CuttleKey): XY | null {
  const size = socketSize(key, false)
  return Array.isArray(size) ? [size[0], size[1]] : null
}

/** The planned harness stack under one switch, as boxes in the switch frame. */
export interface PlannedStack {
  stiffener: number
  boxes: { name: string; box: Box3 }[]
  /** Lowest point of the stack, switch pins included. */
  bottomZ: number
  /** Lowest point of the socket body. */
  socketBottomZ: number
}

export function plannedStack(facts: SwitchFacts, rotation: number, stiffenerTopZ: number, stiffener: number): PlannedStack {
  const [c1, c2] = facts.contacts
  const socketCentre: XY = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2]
  const socket = rotatedRect(socketCentre, facts.socket.size, rotation, 0, 0)
  const housing = rotatedRect([0, 0], [facts.housingSide, facts.housingSide], rotation, 0, 0)
  // The island (and its stiffener) covers the switch's bottom housing and the socket body. Provisional:
  // the socket's pads and the copper-to-edge margin (flex-pcb.md G3) would make it larger still.
  const island = { min: [Math.min(socket.min[0], housing.min[0]), Math.min(socket.min[1], housing.min[1])], max: [Math.max(socket.max[0], housing.max[0]), Math.max(socket.max[1], housing.max[1])] }
  const flexTop = stiffenerTopZ - stiffener
  const socketTop = flexTop - STACK.flex
  const socketBottomZ = socketTop - facts.socket.base
  const layer = (zMin: number, zMax: number): Box3 => ({ min: [island.min[0], island.min[1], zMin], max: [island.max[0], island.max[1], zMax] })
  const boxes = [
    { name: 'stiffener', box: layer(flexTop, stiffenerTopZ) },
    { name: 'flex', box: layer(socketTop, flexTop) },
    { name: 'socket body', box: { min: [socket.min[0], socket.min[1], socketBottomZ], max: [socket.max[0], socket.max[1], socketTop] } as Box3 },
    ...facts.protrusions.map(p => ({ name: p.name, box: rotatedRect(p.at, [p.diameter, p.diameter], rotation, p.tipZ, facts.housingBottomZ) })),
  ]
  return { stiffener, boxes, bottomZ: Math.min(...boxes.map(b => b.box.min[2])), socketBottomZ }
}

/** Contact positions in the switch frame. */
export function contactsInSwitchFrame(facts: SwitchFacts, rotation: number): XY[] {
  return facts.contacts.map(c => rotateXY(c, rotation))
}

/** A contact lands on a switch model when the model has material within this distance (xy) of where the datasheet puts it... */
export const CONTACT_SEARCH_MM = 1
/** ...whose centre is within this distance of it... */
export const CONTACT_TOLERANCE_MM = 0.3
/** ...and whose tip is within this distance of the datasheet's. */
export const CONTACT_TIP_TOLERANCE_MM = 0.5

export interface ContactMatch {
  name: string
  /** Where the datasheet contact lands in the switch frame. */
  expected: XY
  /** The model's material around it below the housing: centre of its xy bounding box, lowest z, and distance from expected. null when there is none. */
  found: { centre: XY; tipZ: number; offsetMm: number } | null
  lands: boolean
}

/**
 * Match the datasheet contacts, turned by `rotation`, against a switch model's
 * vertices given in the switch frame (xyz triples).
 */
export function matchContacts(local: ArrayLike<number>, facts: SwitchFacts, rotation: number): ContactMatch[] {
  const below = facts.housingBottomZ - 0.5
  return facts.protrusions.filter(p => p.name.startsWith('contact')).map(p => {
    const expected = rotateXY(p.at, rotation)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity
    for (let i = 0; i < local.length; i += 3) {
      const x = local[i], y = local[i + 1], z = local[i + 2]
      if (z < below && Math.hypot(x - expected[0], y - expected[1]) <= CONTACT_SEARCH_MM) {
        x0 = Math.min(x0, x), x1 = Math.max(x1, x), y0 = Math.min(y0, y), y1 = Math.max(y1, y), z0 = Math.min(z0, z)
      }
    }
    if (!Number.isFinite(z0)) return { name: p.name, expected, found: null, lands: false }
    const centre: XY = [(x0 + x1) / 2, (y0 + y1) / 2]
    const offsetMm = Math.hypot(centre[0] - expected[0], centre[1] - expected[1])
    const lands = offsetMm <= CONTACT_TOLERANCE_MM && Math.abs(z0 - p.tipZ) <= CONTACT_TIP_TOLERANCE_MM
    return { name: p.name, expected, found: { centre, tipZ: z0, offsetMm }, lands }
  })
}

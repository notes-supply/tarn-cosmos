/**
 * Tarn spec export: turns a Cosmos design into a Tarn spec (tarnSpec 0.2).
 *
 * This module is pure geometry. It never loads OpenCascade, so the spec can be
 * produced quickly even where the CAD kernel is unavailable. The frame
 * conventions are documented in docs/research/cosmos-pipeline.md in the Tarn
 * coordination repo, and summarised here:
 *
 * - Cosmos key frame (geo.keyHolesTrsfs[i]): origin at the centre of the top
 *   face of the socket, which is the plane the switch's top housing seats on.
 *   +Z points out of the socket toward the keycap, +Y toward the top of the
 *   legend, +X = Y x Z. This is already the Tarn switch frame, so no local
 *   rotation or offset is needed.
 * - Half frame: Cosmos's world frame for that half, shifted down so that z = 0
 *   is the bottom face of the bottom plate (geo.floorZ). This is the same
 *   frame as the STEP file Cosmos itself downloads for that half.
 * - Left half: Cosmos lays the left half out mirrored, as if it were a right
 *   half (fromCosmosConfig with flipLeft), then mirrors the finished solids
 *   across the YZ plane (getSTEP in src/lib/worker/api.ts). A mirrored key
 *   transform has determinant -1, so the pose is mirrored a second time in the
 *   key's own frame (M * T * M with M = diag(-1, 1, 1)). That is the same flip
 *   Cosmos applies to the switch holders before mirroring them, so the pose is
 *   the physical (proper) pose of the switch that sits in the left case.
 * - Datasheet frame and switchRotation: see harness.ts. switchRotation is the
 *   same on both halves, because the left pose already describes an unmirrored
 *   switch.
 */

import { boardElements, convertToCustomConnectors } from '$lib/geometry/microcontrollers'
import { bomName, PART_INFO } from '$lib/geometry/socketsParts'
import { switchInfo } from '$lib/geometry/switches'
import { convertToMaybeCustomConnectors, type Cuttleform, type CuttleKey, type FullCuttleform, type Geometry, newGeometry, setBottomZ } from '$lib/worker/config'
import { type CosmosCluster, type CosmosKeyboard, fromCosmosConfig, getRowColumn, mirrorCluster } from '$lib/worker/config.cosmos'
import Trsf from '$lib/worker/modeling/transformation'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { deserialize } from '../../routes/beta/lib/serialize'
import { type Box3, partFlipped, type SpecSeat, specSeat, switchRotation } from './harness'
import { retainers, SOCKET_ID } from './socket'

export const TARN_SPEC_VERSION = '0.2'
export { partFlipped }
export type Side = 'left' | 'right'
export const SIDES: Side[] = ['left', 'right']

export type Pose = number[]

export interface SpecKey {
  id: string
  cluster: string
  column: number | null
  row: number | null
  switch: 'choc-v2' | 'choc-v1' | 'mx' | 'other'
  socket: string
  keycap: { profile: string; widthU: number; heightU: number; row: string } | null
  label: string | null
  pose: Pose
  /** Degrees about the switch frame's +Z from the datasheet frame to the switch as placed (harness.ts). null for 'other'. */
  switchRotation: number | null
  /** Room under the switch for the harness island, in the switch frame. null for 'other'. */
  seat: SpecSeat | null
  /** Declared by spec 0.2 (ADR 0006 item 7). The Tarn socket (choc-v2-tarn, socket.ts) has both; Cosmos's own sockets have neither. */
  backstop?: Retainer
  clamp?: Retainer
}

/** A case feature that holds the harness at one key. */
export interface Retainer {
  kind: string
  /** z (switch frame) of the face that bears on the socket body (backstop) or on the island (clamp). */
  bearingZ: number
  /** The region it occupies, switch frame. */
  region: Box3
  /** Force it is sized for, N. */
  designLoadN: number
  /** Output (e.g. caseStl) whose solid contains it. */
  part: string
}

export interface SpecHalf {
  side: Side
  keys: SpecKey[]
  microcontroller: { type: string; pose: Pose } | null
  connectors: { type: string; pose: Pose }[]
  screws: { type: string; pose: Pose }[]
  outputs: Record<string, string>
}

export interface TarnSpec {
  tarnSpec: string
  units: 'mm'
  source: { generator: 'tarn-cosmos'; commit: string | null; design: string }
  halves: SpecHalf[]
}

// ---------------------------------------------------------------------------
// Design input

/**
 * Extract the part of a Cosmos design reference that Cosmos's own
 * deserializer understands ("cm:<base64>", "cm", "cf:<base64>", ...).
 *
 * Accepts a full URL (https://ryanis.cool/cosmos/beta#cm:...), a hash with or
 * without the leading '#', or a bare base64 Cosmos config.
 */
export function designHash(input: string): string {
  let text = input.trim()
  const hashAt = text.indexOf('#')
  if (hashAt >= 0) text = text.slice(hashAt + 1)
  else if (/^https?:\/\//.test(text)) text = 'cm' // A Cosmos URL without a hash is the default design
  if (text.includes('%')) text = decodeURIComponent(text)
  if (text == '') throw new Error('Empty design reference')
  // A bare base64 config, as Cosmos's own tests store them
  if (!text.includes(':') && !['cm', 'cf', 'manuform', 'lightcycle'].includes(text)) text = 'cm:' + text
  return text
}

/** Decode a Cosmos design reference into Cosmos's configuration object. */
export function decodeDesign(input: string): CosmosKeyboard {
  const hash = designHash(input)
  const state = deserialize(hash, () => {
    throw new Error(`Not a Cosmos design reference: ${JSON.stringify(input.slice(0, 80))}`)
  })
  if (state.keyboard == 'error') throw state.error ?? new Error('Could not decode the design')
  if (state.keyboard == 'expert') throw new Error('Expert-mode (#expert:) designs run user code and are not supported. Export a #cm: link from the basic editor instead.')
  if (state.keyboard != 'cm' && state.keyboard != 'cf') throw new Error(`Design type ${state.keyboard} is not a Cosmos design`)
  return state.options as CosmosKeyboard
}

/** Build the per-side Cosmos configurations exactly as the Cosmos app does before a download. */
export function cosmosHalves(cosmos: CosmosKeyboard): Record<Side, Cuttleform> {
  if (cosmos.unibody) throw new Error(`Unibody designs are not supported by tarnSpec ${TARN_SPEC_VERSION} (it has left and right halves only)`)
  const full: FullCuttleform = fromCosmosConfig(cosmos)
  if (full.center) throw new Error(`Designs with a centre piece are not supported by tarnSpec ${TARN_SPEC_VERSION}`)
  if (!full.left || !full.right) throw new Error('The design must have both a left and a right half')
  // Cosmos's download dialog puts both halves at the same height before exporting.
  setBottomZ(full)
  return { left: full.left, right: full.right }
}

// ---------------------------------------------------------------------------
// Frames

/** diag(-1, 1, 1): reflection across the YZ plane. */
export const MIRROR_X = new Matrix4().makeScale(-1, 1, 1)

/** Transform from Cosmos's world frame for this half (as modelled) to the Tarn half frame. */
export function halfTransform(geo: Geometry, side: Side): Matrix4 {
  const shift = new Matrix4().makeTranslation(0, 0, -geo.floorZ)
  return side == 'left' ? new Matrix4().multiplyMatrices(MIRROR_X, shift) : shift
}

/**
 * Pose (row-major, 16 numbers) in the half frame of a part placed in Cosmos's
 * frame by `t`. For the left half the part frame is mirrored back so the pose
 * stays a proper rotation.
 */
export function partPose(t: Trsf | Matrix4, half: Matrix4, side: Side): Pose {
  return rowMajor(partMatrix(t, half, side))
}

export function partMatrix(t: Trsf | Matrix4, half: Matrix4, side: Side): Matrix4 {
  const m = new Matrix4().multiplyMatrices(half, t instanceof Trsf ? t.wrapped : t)
  if (side == 'left') m.multiply(MIRROR_X)
  return m
}

function round(x: number, digits: number) {
  const f = 10 ** digits
  const r = Math.round(x * f) / f
  return r == 0 ? 0 : r // no -0 in the JSON
}

/** Row-major copy of a Matrix4. Rotation terms keep 9 decimals, translations 6 (1 nm). */
export function rowMajor(m: Matrix4): Pose {
  const e = m.elements // column-major
  const rows = [
    [e[0], e[4], e[8], e[12]],
    [e[1], e[5], e[9], e[13]],
    [e[2], e[6], e[10], e[14]],
    [e[3], e[7], e[11], e[15]],
  ]
  return rows.flatMap((r, i) => r.map((x, j) => round(x, j == 3 && i < 3 ? 6 : 9)))
}

// ---------------------------------------------------------------------------
// Keys

/** Map a Cosmos socket to Tarn's switch family, using the switch Cosmos puts in the bill of materials. */
export function switchFamily(key: CuttleKey): SpecKey['switch'] {
  const name = bomName(key)
  if (/choc v2/i.test(name)) return 'choc-v2'
  if (/choc v1/i.test(name)) return 'choc-v1'
  if (/^MX-Compatible/i.test(name)) return 'mx'
  return 'other'
}

/** Keys that are not physical parts (Cosmos "shaper" keys) are left out of the spec. */
export function isSpecKey(key: CuttleKey) {
  return key.type != 'blank'
}

/**
 * The clusters Cosmos builds a side from, in the order it emits keys
 * (mirrors the selection in sideFromCosmosConfig).
 */
function sideClusters(c: CosmosKeyboard, side: Side): CosmosCluster[] {
  const clusters = c.clusters.filter(cl => cl.side == side)
  if (side == 'left') {
    const right = (name: string) => c.clusters.find(cl => cl.side == 'right' && cl.name == name)
    if (!c.clusters.find(cl => cl.side == 'left' && cl.name == 'fingers') && right('fingers')) clusters.unshift(mirrorCluster(right('fingers')!, c))
    if (!c.clusters.find(cl => cl.side == 'left' && cl.name == 'thumbs') && right('thumbs')) clusters.push(mirrorCluster(right('thumbs')!, c))
  }
  return clusters
}

/**
 * Stable key ids: `<side>-<cluster>-c<i>-r<j>`, where i is the column's index
 * within its Cosmos cluster and j the key's index within that column, both in
 * Cosmos's own order. For a mirrored left half the indices match the right
 * half's, so partners differ only in the side prefix.
 */
export function keyIds(cosmos: CosmosKeyboard, conf: Cuttleform, side: Side): string[] {
  const ids: string[] = []
  for (const cluster of sideClusters(cosmos, side)) {
    cluster.clusters.forEach((column, ci) => {
      column.keys.forEach((_, ri) => ids.push(`${side}-${column.name || cluster.name}-c${ci}-r${ri}`))
    })
  }
  const consistent = ids.length == conf.keys.length && conf.keys.every((k, i) => ids[i].startsWith(`${side}-${k.cluster}-`))
  if (consistent) return ids
  // Fall back to the index in Cosmos's key list if the cluster tree could not be matched.
  return conf.keys.map((k, i) => `${side}-${k.cluster}-k${i}`)
}

function logicalPosition(key: CuttleKey) {
  const { row, column, type } = getRowColumn(key.position)
  if (!type) return { column: null, row: null }
  return { column: Number.isFinite(column) ? round(column, 6) : null, row: Number.isFinite(row) ? round(row, 6) : null }
}

function specKeycap(key: CuttleKey): SpecKey['keycap'] {
  if (!('keycap' in key) || !key.keycap || !PART_INFO[key.type].keycap) return null
  const aspect = key.aspect || 1
  return {
    profile: key.keycap.profile,
    widthU: round(aspect >= 1 ? aspect : 1, 6),
    heightU: round(aspect >= 1 ? 1 : 1 / aspect, 6),
    row: String(key.keycap.row),
  }
}

/** Distance from the switch frame origin (plate top) to the bottom of the keycap, as Cosmos places it. */
export function keycapSeat(key: CuttleKey) {
  return switchInfo(key.type).height
}

// ---------------------------------------------------------------------------
// Halves

export interface HalfContext {
  side: Side
  conf: Cuttleform
  geo: Geometry
  half: Matrix4
}

export function halfContext(conf: Cuttleform, side: Side): HalfContext {
  const geo = newGeometry(conf)
  return { side, conf, geo, half: halfTransform(geo, side) }
}

export function specHalf(cosmos: CosmosKeyboard, ctx: HalfContext): SpecHalf {
  const { side, conf, geo, half } = ctx
  const ids = keyIds(cosmos, conf, side)
  const trsfs = geo.keyHolesTrsfs

  const keys: SpecKey[] = []
  conf.keys.forEach((key, i) => {
    if (!isSpecKey(key)) return
    const family = switchFamily(key)
    keys.push({
      id: ids[i],
      cluster: key.cluster,
      ...logicalPosition(key),
      switch: family,
      socket: key.type,
      keycap: specKeycap(key),
      label: 'keycap' in key && key.keycap?.letter ? key.keycap.letter : null,
      pose: partPose(trsfs[i], half, side),
      switchRotation: switchRotation(key, family),
      seat: specSeat(key, family),
      ...(key.type == SOCKET_ID ? retainers(switchRotation(key, family)!) : {}),
    })
  })

  const connOrigin = geo.connectorOrigin
  let microcontroller: SpecHalf['microcontroller'] = null
  if (conf.microcontroller && connOrigin) {
    const board = boardElements(conf, false)[0]
    microcontroller = { type: conf.microcontroller, pose: partPose(connOrigin.pretranslated(board.offset.xyz()), half, side) }
  }

  const connectors: SpecHalf['connectors'] = []
  if (connOrigin) {
    for (const conn of convertToMaybeCustomConnectors(conf)) {
      const cut = convertToCustomConnectors(conf, conn)
      // Cosmos cuts the connector hole in the XZ plane of the connector origin, centred at (x, 0, y)
      connectors.push({ type: conn.preset ?? 'custom', pose: partPose(connOrigin.pretranslated(cut.x, 0, cut.y), half, side) })
    }
  }

  const screwType = `${conf.screwSize} ${conf.screwType}`
  const screws = geo.screwPositions.map(t => ({ type: screwType, pose: partPose(t, half, side) }))

  return { side, keys, microcontroller, connectors, screws, outputs: {} }
}

export function buildSpec(input: string, commit: string | null) {
  const cosmos = decodeDesign(input)
  const confs = cosmosHalves(cosmos)
  const contexts = SIDES.map(side => halfContext(confs[side], side))
  const spec: TarnSpec = {
    tarnSpec: TARN_SPEC_VERSION,
    units: 'mm',
    source: { generator: 'tarn-cosmos', commit, design: input.trim() },
    halves: contexts.map(ctx => specHalf(cosmos, ctx)),
  }
  return { spec, cosmos, contexts }
}

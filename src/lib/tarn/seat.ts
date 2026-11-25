/**
 * Harness seat measurements against the exported case, with Manifold.
 *
 * For every switch key, in its switch frame:
 * - the clear box: the switch's bottom-housing footprint (under a Tarn
 *   socket, the part of it the island covers), from the stiffener plane down
 *   to the first material of the fused case body, the bottom plate, the
 *   microcontroller holder or a keeper (spec key seat.clear);
 * - the planned-stack check: the ADR 0009 stack from harness.ts (stiffener,
 *   flex, socket body, switch pins) as solids, intersected with that material.
 *   Under a Tarn socket (choc-v2-tarn) the stack is the whole island envelope
 *   of socket.ts: stiffener and flex over the island outline, the hotswap
 *   socket's real outline and the diode, plus the switch pins;
 * - for Tarn sockets, the keepers and their adjusters: each against the case,
 *   its neighbours, the room the keeper needs to go in and the room to turn
 *   the adjuster's knob (checkKeepers).
 *
 * Obstacles and poses are both in the half frame, so a key's switch-frame boxes
 * are placed with its spec pose.
 */

import type { Manifold, ManifoldToplevel, Mat4 } from '@rianadon/manifold-3d'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { type Box3, plannedStack, rotateXY, roundBox, seatFootprint, STACK, switchFacts } from './harness'
import {
  ADJUSTER,
  ADJUSTER_LENGTH,
  boxToSwitchFrame,
  FOOTPRINT_RECT,
  ISLAND,
  islandEnvelope,
  KEEPER_BOTTOM,
  KEEPER_THICKNESS,
  PAD_RANGE,
  POST_BOTTOM,
  type Prism,
  SOCKET_ID,
  socketTurn,
  TONGUE,
} from './socket'
import { type HalfContext, isSpecKey, type Pose, type SpecHalf } from './spec'

/**
 * The clear box and the stack are tested this far below the stiffener plane, so
 * faces lying on the plane (the socket's underside, which the stiffener bears
 * on) do not count. It covers the fused case's 1 µm snap (solids.ts SNAP_MM).
 */
export const PLANE_GAP_MM = 0.01
/** How far below the stiffener plane the clear box is searched. */
const SEARCH_DEPTH_MM = 100
/** Intersections smaller than this are boolean noise (touching faces), not material. */
export const INTERFERENCE_MM3 = 1e-3

/** Matrix4 from a row-major spec pose. */
export function poseMatrix(p: Pose): Matrix4 {
  return new Matrix4().set(...(p as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
}

/** A Tarn key's socket frame (socket.ts) in the half frame: its pose turned by socketTurn(switchRotation). */
export function socketPose(key: { pose: Pose; switchRotation: number | null }): Matrix4 {
  return poseMatrix(key.pose).multiply(new Matrix4().makeRotationZ((socketTurn(key.switchRotation ?? 180) * Math.PI) / 180))
}

/** A switch-frame box placed in the half frame. */
export function boxSolid(mf: ManifoldToplevel, box: Box3, pose: Matrix4): Manifold {
  const size = [0, 1, 2].map(i => box.max[i] - box.min[i]) as [number, number, number]
  const local = mf.Manifold.cube(size, false).translate(box.min)
  const placed = local.transform(pose.elements as unknown as Mat4)
  local.delete()
  return placed
}

/** A prism (polygon in XY between two heights) placed in the half frame, shrunk by `shrink` at both ends. */
export function prismSolid(mf: ManifoldToplevel, p: Prism, pose: Matrix4, shrink = 0): Manifold {
  const area = p.outline.reduce((a, [x, y], i) => {
    const [x2, y2] = p.outline[(i + 1) % p.outline.length]
    return a + x * y2 - x2 * y
  }, 0)
  const outline = area < 0 ? [...p.outline].reverse() : p.outline
  const local = mf.Manifold.extrude([outline], p.zMax - p.zMin - 2 * shrink).translate([0, 0, p.zMin + shrink])
  const placed = local.transform(pose.elements as unknown as Mat4)
  local.delete()
  return placed
}

/** Volume of `solid` inside `material` (consumes neither). */
function overlapVolume(solid: Manifold, material: Manifold) {
  const overlap = solid.intersect(material)
  const volume = Math.max(0, overlap.volume())
  overlap.delete()
  return volume
}

/** Highest switch-frame z of the material in `solid`, ignoring sliver components. */
function topZ(solid: Manifold, inverse: Matrix4): number | null {
  let top = -Infinity
  const v = new Vector3()
  for (const piece of solid.decompose()) {
    if (Math.abs(piece.volume()) >= INTERFERENCE_MM3) {
      const m = piece.getMesh()
      for (let i = 0; i < m.vertProperties.length; i += m.numProp) {
        v.set(m.vertProperties[i], m.vertProperties[i + 1], m.vertProperties[i + 2]).applyMatrix4(inverse)
        top = Math.max(top, v.z)
      }
    }
    piece.delete()
  }
  return Number.isFinite(top) ? top : null
}

export interface StackResult {
  /** 'planned' for the generic stack; 'tarn island' for the island envelope under a Tarn socket. */
  stack: 'planned' | 'tarn island'
  stiffener: number
  /** Lowest point of the stack (switch pins included) and of the socket body, switch frame. */
  bottomZ: number
  socketBottomZ: number
  /** Volume of each stack part inside case, plate or holder material (parts above the noise threshold only). */
  interferingParts: Record<string, number>
  /** Stack bottom above the clear box's bottom (negative: the stack is too deep). */
  clearDepthMarginMm: number
  /** Stack bottom above the bottom of Cosmos's reserved envelope (negative: Cosmos does not reserve that deep). */
  reservedDepthMarginMm: number
  /** How far the stack reaches past Cosmos's socket footprint (the plate around the switch). */
  overhangMm: number
  /** Contact tips below the socket body's underside (positive: they poke out of it). */
  pinsBelowSocketMm: number
  /** No part of the stack is inside material. */
  fits: boolean
  /** The same, with the stiffener cut back to the plate's footprint (flex and socket body unchanged). */
  fitsWithStiffenerOnPlate: boolean
}

export interface SeatResult {
  id: string
  socket: string
  switchRotation: number
  clear: Box3
  /** True when nothing was found down to the search depth, so clear.min is a lower bound. */
  clearIsLowerBound: boolean
  stacks: StackResult[]
}

export interface SeatReport {
  side: string
  stiffeners: number[]
  keys: SeatResult[]
  skipped: string[]
  /** Keys where the stack fits, per stiffener thickness; and with the stiffener cut back to the plate. */
  fits: Record<string, number>
  fitsWithStiffenerOnPlate: Record<string, number>
  ms: number
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 || 0

/**
 * Measure the clear box of every switch key of a half, fill in seat.clear in
 * the spec half, and check the planned stack against the material.
 */
export function measureSeats(mf: ManifoldToplevel, ctx: HalfContext, half: SpecHalf, obstacles: Manifold, opts = { stacks: true }): SeatReport {
  const start = performance.now()
  const confKeys = ctx.conf.keys.filter(isSpecKey)
  const report: SeatReport = { side: ctx.side, stiffeners: STACK.stiffeners.map(s => s.thickness), keys: [], skipped: [], fits: {}, fitsWithStiffenerOnPlate: {}, ms: 0 }
  half.keys.forEach((key, n) => {
    const facts = switchFacts(key.switch)
    const footprint = seatFootprint(confKeys[n])
    if (!facts || !key.seat || key.switchRotation == null || !footprint) {
      report.skipped.push(key.id)
      return
    }
    const pose = poseMatrix(key.pose)
    const inverse = pose.clone().invert()
    const top = key.seat.stiffenerTopZ
    const [w, h] = footprint
    const c = facts.housingSide / 2
    // The clear box is the housing footprint; under a Tarn socket, the part of it the island
    // covers (the island is off-centre, and the socket's posts stand beside it under the housing).
    let [x0, y0, x1, y1] = [-c, -c, c, c]
    if (key.socket == SOCKET_ID) {
      const island = boxToSwitchFrame({ min: [ISLAND[0], ISLAND[1], 0], max: [ISLAND[2], ISLAND[3], 0] }, key.switchRotation)
      ;[x0, y0, x1, y1] = [Math.max(x0, island.min[0]), Math.max(y0, island.min[1]), Math.min(x1, island.max[0]), Math.min(y1, island.max[1])]
    }

    const prism = boxSolid(mf, { min: [x0, y0, top - SEARCH_DEPTH_MM], max: [x1, y1, top - PLANE_GAP_MM] }, pose)
    const hit = prism.intersect(obstacles)
    const hitTop = topZ(hit, inverse)
    prism.delete()
    hit.delete()
    const clear = roundBox({ min: [x0, y0, hitTop ?? top - SEARCH_DEPTH_MM], max: [x1, y1, top] })
    key.seat.clear = clear

    const reservedBottom = Math.min(...key.seat.reserved.map(b => b.min[2]))
    const contactTips = facts.protrusions.filter(p => p.name.startsWith('contact')).map(p => p.tipZ)
    const inside = (box: Box3) => {
      const solid = boxSolid(mf, box, pose)
      const volume = overlapVolume(solid, obstacles)
      solid.delete()
      return volume
    }
    const overhangOf = (boxes: Box3[]) => r3(Math.max(0, ...boxes.flatMap(b => [b.max[0] - w / 2, -w / 2 - b.min[0], b.max[1] - h / 2, -h / 2 - b.min[1]])))
    const stacks = !opts.stacks ? [] : key.socket == SOCKET_ID ? [tarnStack()] : STACK.stiffeners.map(({ thickness }) => {
      const stack = plannedStack(facts, key.switchRotation!, top, thickness)
      // Tested a hair below the plane it bears on; reported as planned.
      const tested = plannedStack(facts, key.switchRotation!, top - PLANE_GAP_MM, thickness)
      const interferingParts: Record<string, number> = {}
      for (const b of tested.boxes) {
        const v = inside(b.box)
        if (v > INTERFERENCE_MM3) interferingParts[b.name] = r3(v)
      }
      const others = Object.keys(interferingParts).filter(name => name != 'stiffener')
      const stiffener = tested.boxes.find(b => b.name == 'stiffener')!.box
      const onPlate: Box3 = {
        min: [Math.max(stiffener.min[0], -w / 2), Math.max(stiffener.min[1], -h / 2), stiffener.min[2]],
        max: [Math.min(stiffener.max[0], w / 2), Math.min(stiffener.max[1], h / 2), stiffener.max[2]],
      }
      const fits = Object.keys(interferingParts).length == 0
      const result: StackResult = {
        stack: 'planned',
        stiffener: thickness,
        bottomZ: r3(stack.bottomZ),
        socketBottomZ: r3(stack.socketBottomZ),
        interferingParts,
        clearDepthMarginMm: r3(stack.bottomZ - clear.min[2]),
        reservedDepthMarginMm: r3(stack.bottomZ - reservedBottom),
        overhangMm: overhangOf(stack.boxes.map(b => b.box)),
        pinsBelowSocketMm: r3(stack.socketBottomZ - Math.min(...contactTips)),
        fits,
        fitsWithStiffenerOnPlate: fits || (others.length == 0 && inside(onPlate) <= INTERFERENCE_MM3),
      }
      return result
    })

    /** The island envelope of socket.ts and the switch pins, against the material (keepers included). */
    function tarnStack(): StackResult {
      const rot = key.switchRotation!
      const prisms = islandEnvelope()
      const pins = facts!.protrusions.map(p => {
        const [x, y] = rotateXY(p.at, rot)
        const r = p.diameter / 2
        return { name: p.name, box: { min: [x - r, y - r, p.tipZ], max: [x + r, y + r, facts!.housingBottomZ] } as Box3 }
      })
      const interferingParts: Record<string, number> = {}
      const frame = socketPose(key)
      for (const p of prisms) {
        // Shrunk at both ends: the stiffener bears on the switch housing and the socket body on the adjuster.
        const solid = prismSolid(mf, p, frame, PLANE_GAP_MM)
        const v = overlapVolume(solid, obstacles)
        solid.delete()
        if (v > INTERFERENCE_MM3) interferingParts[p.name] = r3(v)
      }
      for (const b of pins) {
        const v = inside({ min: b.box.min, max: [b.box.max[0], b.box.max[1], b.box.max[2] - PLANE_GAP_MM] })
        if (v > INTERFERENCE_MM3) interferingParts[b.name] = r3(v)
      }
      const socket = prisms.find(p => p.name == 'hotswap socket')!
      const bottomZ = Math.min(...prisms.map(p => p.zMin), ...pins.map(b => b.box.min[2]))
      const fits = Object.keys(interferingParts).length == 0
      // Overhang past the socket's footprint, which is offset to the island (island frame).
      const [fx0, fy0, fx1, fy1] = FOOTPRINT_RECT
      const overhang = Math.max(0, ...prisms.flatMap(p => p.outline.flatMap(([x, y]) => [fx0 - x, x - fx1, fy0 - y, y - fy1])))
      return {
        stack: 'tarn island',
        stiffener: STACK.stiffeners[0].thickness,
        bottomZ: r3(bottomZ),
        socketBottomZ: r3(socket.zMin),
        interferingParts,
        clearDepthMarginMm: r3(bottomZ - clear.min[2]),
        reservedDepthMarginMm: r3(bottomZ - reservedBottom),
        overhangMm: r3(overhang),
        pinsBelowSocketMm: r3(socket.zMin - Math.min(...contactTips)),
        fits,
        fitsWithStiffenerOnPlate: fits,
      }
    }
    report.keys.push({ id: key.id, socket: key.socket, switchRotation: key.switchRotation, clear, clearIsLowerBound: hitTop == null, stacks })
  })
  for (const t of report.stiffeners) {
    const results = report.keys.flatMap(k => k.stacks.filter(s => s.stiffener == t))
    report.fits[String(t)] = results.filter(s => s.fits).length
    report.fitsWithStiffenerOnPlate[String(t)] = results.filter(s => s.fitsWithStiffenerOnPlate).length
  }
  report.ms = Math.round(performance.now() - start)
  return report
}

/**
 * The keeper's way in: it comes in under the socket with its top below the
 * posts, then rises flat to its insertion place (TONGUE.slide toward +Y). So
 * its own outline, swept down from there by its thickness and the posts' foot
 * plus `marginMm`, must be free of case material.
 */
export const KEEPER_ACCESS = { marginMm: 0.2 } as const
/**
 * Room to turn the adjuster's knob with fingertips from below (bottom plate
 * off): a cylinder `margin` wider than the knob, from the knob at its lowest
 * setting `depth` down, more than twice the knob's height. Our assumption
 * (unverified) for a fingertip rolling or pinching the knurled rim.
 */
export const KNOB_ACCESS = { marginMm: 1.0, depthMm: 4 } as const
/** Touching faces (tongue on window floor, keeper under P3b) leave slivers this small after meshing. */
export const KEEPER_TOUCH_MM3 = 0.02

export interface KeeperResult {
  id: string
  /** Keeper volume inside case, plate or holder material, touching faces not counted. */
  installedOverlapMm3: number
  /** Neighbouring keepers it overlaps, with volumes. */
  keeperOverlaps: Record<string, number>
  /** Keeper at its insertion place (TONGUE.slide toward +Y) inside the case body. */
  insertionOverlapMm3: number
  /** Case body material in the way in (KEEPER_ACCESS). */
  wayInOverlapMm3: number
  /** Case body material where a fingertip turns the adjuster's knob (KNOB_ACCESS). */
  knobAccessOverlapMm3: number
  ok: boolean
}

export interface KeeperReport {
  side: string
  keys: KeeperResult[]
  ok: number
  ms: number
}

/**
 * Check every Tarn keeper of a half: that it fits where it is installed, that
 * it does not collide with its neighbours, that it can go in from below with
 * the bottom plate off, and that a fingertip can reach its adjuster's knob. `keeper` is the keeper with its adjuster as
 * installed, in the socket frame; `sliding` the keeper as it slides in (snap
 * arm pressed down, adjuster screwed back); `material` is case, plate and
 * holder; `body` the case alone.
 */
export function checkKeepers(mf: ManifoldToplevel, half: SpecHalf, keeper: Manifold, sliding: Manifold, material: Manifold, body: Manifold): KeeperReport {
  const start = performance.now()
  const keys = half.keys.filter(k => k.socket == SOCKET_ID)
  const placed = keys.map(k => keeper.transform(socketPose(k).elements as unknown as Mat4))
  const centres = keys.map(k => new Vector3(k.pose[3], k.pose[7], k.pose[11]))
  const sweepBottom = POST_BOTTOM - KEEPER_THICKNESS - KEEPER_ACCESS.marginMm
  const results = keys.map((k, i): KeeperResult => {
    const shifted = socketPose(k).multiply(new Matrix4().makeTranslation(0, TONGUE.slide, 0))
    const installedOverlapMm3 = r3(overlapVolume(placed[i], material))
    const keeperOverlaps: Record<string, number> = {}
    keys.forEach((other, j) => {
      if (j == i || centres[i].distanceTo(centres[j]) > 40) return
      const v = overlapVolume(placed[i], placed[j])
      if (v > KEEPER_TOUCH_MM3) keeperOverlaps[other.id] = r3(v)
    })
    const moved = sliding.transform(shifted.elements as unknown as Mat4)
    const insertionOverlapMm3 = r3(overlapVolume(moved, body))
    moved.delete()
    // The way in: the keeper's own outline (as it slides in) moved down step by step to below the posts.
    const steps = Math.ceil((KEEPER_BOTTOM - sweepBottom) / 0.5)
    const copies = Array.from({ length: steps }, (_, n) => sliding.translate([0, 0, -((n + 1) * (KEEPER_BOTTOM - sweepBottom)) / steps]))
    const swept = mf.Manifold.union(copies)
    copies.forEach(c => c.delete())
    const sweep = swept.transform(shifted.elements as unknown as Mat4)
    swept.delete()
    const wayInOverlapMm3 = r3(overlapVolume(sweep, body))
    sweep.delete()
    const knobBottom = PAD_RANGE[0] - ADJUSTER_LENGTH - ADJUSTER.knob.height
    const r = ADJUSTER.knob.radius + KNOB_ACCESS.marginMm
    const finger = mf.Manifold.cylinder(KNOB_ACCESS.depthMm, r, r, 32)
      .translate([ADJUSTER.at[0], ADJUSTER.at[1], knobBottom - KNOB_ACCESS.depthMm])
    const fingerPlaced = finger.transform(socketPose(k).elements as unknown as Mat4)
    finger.delete()
    const knobAccessOverlapMm3 = r3(overlapVolume(fingerPlaced, body))
    fingerPlaced.delete()
    const ok = [installedOverlapMm3, insertionOverlapMm3, wayInOverlapMm3, knobAccessOverlapMm3].every(v => v <= KEEPER_TOUCH_MM3) && Object.keys(keeperOverlaps).length == 0
    return { id: k.id, installedOverlapMm3, keeperOverlaps, insertionOverlapMm3, wayInOverlapMm3, knobAccessOverlapMm3, ok }
  })
  placed.forEach(p => p.delete())
  return { side: half.side, keys: results, ok: results.filter(r => r.ok).length, ms: Math.round(performance.now() - start) }
}

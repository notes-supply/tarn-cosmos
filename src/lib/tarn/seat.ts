/**
 * Harness seat measurements against the exported case, with Manifold.
 *
 * For every switch key, in its switch frame:
 * - the clear box: the switch's bottom-housing footprint, from the stiffener
 *   plane down to the first material of the fused case body, the bottom plate
 *   or the microcontroller holder (spec key seat.clear);
 * - the planned-stack check: the provisional stack from harness.ts (stiffener,
 *   flex, socket body, switch pins) as solids, intersected with that material.
 *
 * Obstacles and poses are both in the half frame, so a key's switch-frame boxes
 * are placed with its spec pose.
 */

import type { Manifold, ManifoldToplevel, Mat4 } from '@rianadon/manifold-3d'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { type Box3, plannedStack, roundBox, seatFootprint, STACK, switchFacts } from './harness'
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

/** A switch-frame box placed in the half frame. */
export function boxSolid(mf: ManifoldToplevel, box: Box3, pose: Matrix4): Manifold {
  const size = [0, 1, 2].map(i => box.max[i] - box.min[i]) as [number, number, number]
  const local = mf.Manifold.cube(size, false).translate(box.min)
  const placed = local.transform(pose.elements as unknown as Mat4)
  local.delete()
  return placed
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

    const prism = boxSolid(mf, { min: [-c, -c, top - SEARCH_DEPTH_MM], max: [c, c, top - PLANE_GAP_MM] }, pose)
    const hit = prism.intersect(obstacles)
    const hitTop = topZ(hit, inverse)
    prism.delete()
    hit.delete()
    const clear = roundBox({ min: [-c, -c, hitTop ?? top - SEARCH_DEPTH_MM], max: [c, c, top] })
    key.seat.clear = clear

    const reservedBottom = Math.min(...key.seat.reserved.map(b => b.min[2]))
    const stacks = !opts.stacks ? [] : STACK.stiffeners.map(({ thickness }) => {
      const stack = plannedStack(facts, key.switchRotation!, top, thickness)
      // Tested a hair below the plane it bears on; reported as planned.
      const tested = plannedStack(facts, key.switchRotation!, top - PLANE_GAP_MM, thickness)
      const inside = (box: Box3) => {
        const solid = boxSolid(mf, box, pose)
        const overlap = solid.intersect(obstacles)
        const volume = Math.max(0, overlap.volume())
        solid.delete()
        overlap.delete()
        return volume
      }
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
      const overhang = Math.max(...stack.boxes.flatMap(b => [b.box.max[0] - w / 2, -w / 2 - b.box.min[0], b.box.max[1] - h / 2, -h / 2 - b.box.min[1]]))
      const contactTips = facts.protrusions.filter(p => p.name.startsWith('contact')).map(p => p.tipZ)
      const result: StackResult = {
        stiffener: thickness,
        bottomZ: r3(stack.bottomZ),
        socketBottomZ: r3(stack.socketBottomZ),
        interferingParts,
        clearDepthMarginMm: r3(stack.bottomZ - clear.min[2]),
        reservedDepthMarginMm: r3(stack.bottomZ - reservedBottom),
        overhangMm: r3(Math.max(0, overhang)),
        pinsBelowSocketMm: r3(stack.socketBottomZ - Math.min(...contactTips)),
        fits,
        fitsWithStiffenerOnPlate: fits || (others.length == 0 && inside(onPlate) <= INTERFERENCE_MM3),
      }
      return result
    })
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

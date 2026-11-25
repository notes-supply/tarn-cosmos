/**
 * Access lines and holes for a whole half (access.ts per key): what is in the
 * way, what may be cut, what must not be, and the holes as OpenCascade cuts.
 *
 * While the adjusters are set (socket.ts, assembly step 4) the bottom plate,
 * the battery and the MCU board are out; the holder stays screwed in. So the
 * lines must miss the case and the holder (with any holes cut), and the other
 * keepers and adjusters. A line may pass where the board sits; the spec then
 * says so (`remove`).
 */

import type { Manifold, ManifoldToplevel, Mat4 } from '@rianadon/manifold-3d'
import { makeCylinder, type Shape3D } from 'replicad'
import { Vector3 } from 'three/src/math/Vector3.js'
import { type AccessHole, type AccessPlan, blockingVolumes, planAccessWithHole } from './access'
import { ANTENNA, BOARD_ENVELOPE, type Box, grow, OVERMOLD, RF_CLEARANCE, USB } from './mcu'
import { boxSolid, poseMatrix, reservedSolid, socketPose } from './seat'
import { SOCKET_ID } from './socket'
import { type CaseParts, fuseShapes, type MeshOptions } from './solids'
import { type SpecHalf, TARN_MCU } from './spec'

/** Where no access hole may go, board frame: the USB-C opening and a 1 mm rim (mcu.ts OVERMOLD; the reference design's connector). */
export const USB_RECESS: Box = {
  min: [USB.faceCentre[0] - OVERMOLD.max[0] / 2 - OVERMOLD.margin - 1, -10, USB.faceCentre[2] - OVERMOLD.max[1] / 2 - OVERMOLD.margin - 1],
  max: [USB.faceCentre[0] + OVERMOLD.max[0] / 2 + OVERMOLD.margin + 1, 20, USB.faceCentre[2] + OVERMOLD.max[1] / 2 + OVERMOLD.margin + 1],
}

export interface HalfAccess {
  plans: AccessPlan[]
  holes: AccessHole[]
  /** Keys whose line passes where the MCU board sits, with the overlap (mm^3): set them with the board out. */
  throughBoard: Record<string, number>
  ms: number
}

/**
 * Plan every Tarn key's access line on a half and write it into the spec
 * (key.backstop.access). `keeper` is one keeper with its adjuster as
 * installed (socket frame).
 */
export function planHalfAccess(mf: ManifoldToplevel, half: SpecHalf, parts: CaseParts, keeper: Manifold, plateTopZ: number, opts: MeshOptions): HalfAccess {
  const start = performance.now()
  const walls = fuseShapes(mf, parts.body.filter(p => p.name == 'Walls').map(p => p.shape), opts).manifold
  const rest = fuseShapes(mf, parts.body.filter(p => p.name != 'Walls').map(p => p.shape), opts).manifold
  const holder = parts.holder ? fuseShapes(mf, [parts.holder], opts).manifold : null
  const mcu = half.microcontroller && half.microcontroller.type == TARN_MCU ? poseMatrix(half.microcontroller.pose) : null
  const board = mcu ? mf.Manifold.union(BOARD_ENVELOPE.map(b => boxSolid(mf, b, mcu))) : null
  const zones = mcu ? [boxSolid(mf, grow(ANTENNA, RF_CLEARANCE), mcu), boxSolid(mf, USB_RECESS, mcu)] : []
  const bay = reservedSolid(mf, half, 'battery')
  if (bay) zones.push(bay)
  const forbidden = zones.length ? mf.Manifold.union(zones) : null
  zones.forEach(z => z.delete())

  const keys = half.keys.filter(k => k.socket == SOCKET_ID)
  const placed = keys.map(k => keeper.transform(socketPose(k).elements as unknown as Mat4))
  const centre = (k: (typeof keys)[number]) => new Vector3(k.pose[3], k.pose[7], k.pose[11])
  const plans: AccessPlan[] = []
  const holes: AccessHole[] = []
  const throughBoard: Record<string, number> = {}
  keys.forEach((k, i) => {
    const others = keys.flatMap((o, j): [string, Manifold][] => (j != i && centre(o).distanceTo(centre(k)) <= 80 ? [[o.id, placed[j]]] : []))
    const { plan, hole } = planAccessWithHole(
      mf,
      k.id,
      socketPose(k),
      plateTopZ,
      [['case', rest], ...others],
      [['case walls', walls], ...(holder ? [['holder', holder] as [string, Manifold]] : [])],
      forbidden,
    )
    plans.push(plan)
    if (hole) holes.push(hole)
    const viaBoard = board ? blockingVolumes(mf, plan, plateTopZ, [['MCU board', board]]) : {}
    if (viaBoard['MCU board']) throughBoard[k.id] = viaBoard['MCU board']
    k.backstop!.access = {
      axis: plan.axis,
      diameter: plan.diameter,
      angleDeg: plan.angleDeg,
      ...(viaBoard['MCU board'] ? { remove: ['MCU board'] } : {}),
    }
  })
  for (const m of [walls, rest, holder, board, forbidden, ...placed]) m?.delete()
  return { plans, holes, throughBoard, ms: Math.round(performance.now() - start) }
}

/** An access hole as a solid (OpenCascade): its line from the mouth, run 10 mm past the plate plane. */
function holeSolid(hole: AccessHole): Shape3D {
  const top = new Vector3(...hole.axis[1]), bottom = new Vector3(...hole.axis[0])
  const dir = bottom.clone().sub(top)
  const length = dir.length() + 10
  dir.normalize()
  return makeCylinder(hole.diameter / 2, length, top.toArray() as [number, number, number], dir.toArray() as [number, number, number])
}

/** Cut the holes from the walls and the holder (in place). */
export function applyAccessHoles(parts: CaseParts, holes: AccessHole[]) {
  if (!holes.length) return
  for (const hole of holes) {
    const cutter = holeSolid(hole)
    if (hole.through['case walls']) {
      const walls = parts.body.find(p => p.name == 'Walls')!
      walls.shape = (walls.shape as Shape3D).cut(cutter)
    }
    if (hole.through['holder'] && parts.holder) parts.holder = (parts.holder as Shape3D).cut(cutter)
    cutter.delete()
  }
}

/**
 * Tarn's MCU board in the reference design's case (mcu.ts, mcuCase.ts): the
 * USB-C overmold, the J3 relief, the antenna volume and the battery bay,
 * checked on the exported solids of both halves, in the board frame.
 */

import '../../model_gen/node-model' // points Cosmos's loaders at the files on disk
import type { Manifold, ManifoldToplevel, Mat4 } from '@rianadon/manifold-3d'
import { beforeAll, describe, expect, test } from 'bun:test'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { setup } from '../../model_gen/node-model'
import { referenceDesign } from '../../scripts/tarn-reference-design'
import { ANTENNA, BATTERY_BAY, batterySpace, BOARD, type Box, cellBox, CELLS, grow, J3, J3_CLEARANCE, leadPath, OVERMOLD, RF_CLEARANCE, USB } from './mcu'
import { poseMatrix, prismSolid, socketPose } from './seat'
import * as S from './socket'
import { buildCaseParts, fuseShapes, manifoldKernel, tarnKeepers, toManifold } from './solids'
import { buildSpec, type SpecHalf } from './spec'

const MESH = { tolerance: 0.05, angularTolerance: 5 }
/** Touching faces leave slivers about this big after meshing. */
const TOUCH_MM3 = 0.02

let mf: ManifoldToplevel
const { spec, contexts } = buildSpec(referenceDesign(), null)
/** Per half, in the board frame: the fused case, holder, plate, keepers with adjusters, and the islands. */
const parts: Record<string, { case: Manifold; holder: Manifold; plate: Manifold; keepers: Manifold; islands: Manifold; half: SpecHalf; toBoard: Matrix4 }> = {}

beforeAll(async () => {
  await setup()
  mf = await manifoldKernel()
  for (const ctx of contexts) {
    const half = spec.halves.find(h => h.side == ctx.side)!
    const toBoard = poseMatrix(half.microcontroller!.pose).invert()
    const local = (m: Manifold) => m.transform(toBoard.elements as unknown as Mat4)
    const built = await buildCaseParts(ctx, {})
    const body = fuseShapes(mf, built.body.map(p => p.shape), MESH)
    const holder = fuseShapes(mf, [built.holder!], MESH)
    const plate = fuseShapes(mf, [built.plate!], MESH)
    const keepers = (await tarnKeepers(mf, half, MESH))!
    const keys = half.keys.filter(k => k.socket == S.SOCKET_ID)
    const islands = mf.Manifold.union(keys.flatMap(k => S.islandEnvelope().map(p => prismSolid(mf, p, socketPose(k)))))
    parts[ctx.side] = {
      case: local(body.manifold),
      holder: local(holder.manifold),
      plate: local(plate.manifold),
      keepers: local(toManifold(mf, keepers.placed)),
      islands: local(islands),
      half,
      toBoard,
    }
    for (const p of built.body) p.shape.delete()
  }
}, 240000)

const solid = (b: Box) => mf.Manifold.cube([0, 1, 2].map(i => b.max[i] - b.min[i]) as [number, number, number]).translate(b.min)
const overlap = (a: Manifold, b: Manifold) => {
  const i = a.intersect(b)
  const v = Math.max(0, i.volume())
  i.delete()
  return v
}
const printed = (_side: string) => ['case', 'holder', 'plate', 'keepers'] as const

describe.each(['left', 'right'])('%s half', side => {
  test('a USB-C overmold up to 13 x 7.5 mm reaches the receptacle face clear of every printed part', () => {
    const [x, y, z] = USB.faceCentre
    const [w, h] = OVERMOLD.max
    const probe = solid({ min: [x - w / 2, y, z - h / 2], max: [x + w / 2, y + 30, z + h / 2] })
    for (const name of printed(side)) expect(overlap(probe, parts[side][name]), name).toBeLessThan(1e-6)
  })

  test('the holder keeps 0.5 mm from the J3 connector and its mated plug', () => {
    const env = solid(grow(J3, J3_CLEARANCE - 0.01))
    expect(overlap(env, parts[side].holder)).toBeLessThan(1e-6)
    for (const name of printed(side)) expect(overlap(solid(J3), parts[side][name]), name).toBeLessThan(1e-6)
  })

  test('nothing printed, no screw and no part of the battery bay comes within 10 mm of the antenna keep-out', () => {
    const region = solid(ANTENNA)
    for (const name of printed(side)) expect(parts[side][name].minGap(region, RF_CLEARANCE + 1), name).toBeGreaterThanOrEqual(RF_CLEARANCE)
    // Screws: the M3 head (ISO 4762, 5.5 mm) along the whole axis, as Tarn tools' antenna check models them.
    const P = parts[side].half.microcontroller!.pose
    for (const s of parts[side].half.screws) {
      const x = s.pose[3] - P[3], y = s.pose[7] - P[7]
      const d = Math.hypot(Math.max(ANTENNA.min[0] - x, 0, x - ANTENNA.max[0]), Math.max(ANTENNA.min[1] - y, 0, y - ANTENNA.max[1]))
      expect(d - 2.75, `screw at (${x.toFixed(1)}, ${y.toFixed(1)})`).toBeGreaterThanOrEqual(RF_CLEARANCE)
    }
    for (const b of [batterySpace(side as any), ...leadPath(side as any)]) {
      const gap = Math.hypot(...[0, 1, 2].map(i => Math.max(ANTENNA.min[i] - b.max[i], 0, b.min[i] - ANTENNA.max[i])))
      expect(gap).toBeGreaterThanOrEqual(RF_CLEARANCE)
    }
  })

  test(`a ${BATTERY_BAY.cell} cell stands in the bay clear of the case, holder, plate, keepers and islands`, () => {
    // 0.01 mm in from its faces: the cell stands on the plate and the cradle's walls touch it.
    const space = solid(grow(batterySpace(side as any), -0.01))
    for (const name of [...printed(side), 'islands'] as const) expect(overlap(space, parts[side][name]), name).toBeLessThan(1e-6)
    // The cell fits the space with its allowances.
    const cell = cellBox(side as any)
    const [t, w, l] = CELLS[BATTERY_BAY.cell]
    expect([0, 1, 2].map(i => Math.round((cell.max[i] - cell.min[i]) * 1000) / 1000)).toEqual([t, l, w])
    const s = batterySpace(side as any)
    for (let i = 0; i < 3; i++) {
      expect(cell.min[i]).toBeGreaterThanOrEqual(s.min[i] - 1e-9)
      expect(cell.max[i]).toBeLessThanOrEqual(s.max[i] + 1e-9)
    }
  })

  test('the lead has a clear way from the cradle slot to J3', () => {
    const boxes = leadPath(side as any)
    for (const b of boxes) {
      const path = solid(b)
      for (const name of [...printed(side), 'islands'] as const) expect(overlap(path, parts[side][name]), name).toBeLessThan(TOUCH_MM3)
    }
    // The boxes join up: the first reaches the bay's space, the last the plug's mating face.
    const s = batterySpace(side as any)
    const [first, last] = [boxes[0], boxes[boxes.length - 1]]
    expect(first.min[0] < s.max[0] && first.max[0] > s.min[0]).toBe(true)
    expect(last.max[1]).toBeCloseTo(J3.min[1], 6)
    for (let i = 0; i + 1 < boxes.length; i++) {
      for (let k = 0; k < 3; k++) {
        expect(boxes[i].min[k]).toBeLessThan(boxes[i + 1].max[k])
        expect(boxes[i + 1].min[k]).toBeLessThan(boxes[i].max[k])
      }
    }
  })

  test('the bottom plate (with its cradle) and the holder stay clear of the case', () => {
    expect(overlap(parts[side].plate, parts[side].case)).toBeLessThan(TOUCH_MM3)
    expect(overlap(parts[side].holder, parts[side].case)).toBeLessThan(TOUCH_MM3)
  })

  test('the spec declares the antenna, the bay and the lead as reserved regions, and the cell', () => {
    const half = parts[side].half
    expect(half.reserved.map(r => r.kind as string)).toEqual(['antenna', 'battery', ...leadPath(side as any).map(() => 'battery lead')])
    expect(half.reserved[0].box).toEqual(ANTENNA)
    expect(half.reserved[0].clearanceMm).toBe(RF_CLEARANCE)
    expect(half.reserved[half.battery!.bay].box).toEqual(batterySpace(side as any))
    for (const r of half.reserved) expect(r.pose).toEqual(half.microcontroller!.pose)
    expect(half.battery!.sizeMm).toEqual([...CELLS[BATTERY_BAY.cell]])
  })
})

test('the board frame is where the spec says: the board sits on the holder at its seat height', () => {
  for (const side of ['left', 'right']) {
    // The holder carries the board's underside at board z 0 and is clear of the board above it.
    const board = solid({ min: [BOARD.min[0] + 0.5, BOARD.min[1] + 0.5, 0.02], max: [BOARD.max[0] - 0.5, BOARD.max[1] - 0.5, BOARD.max[2]] })
    expect(overlap(board, parts[side].holder), side).toBeLessThan(1e-6)
  }
})

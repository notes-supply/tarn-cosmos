/**
 * The Tarn Choc V2 socket (socket.ts) and the Tarn reference design: relations
 * between the socket, the harness island with the ADR 0009 stack, the keeper
 * and the case, checked on the solids themselves.
 */

import '../../model_gen/node-model' // points Cosmos's loaders at the files on disk
import { PART_INFO, partBottom, socketOffset, socketSize } from '$lib/geometry/socketsParts'
import type { Manifold, ManifoldToplevel } from '@rianadon/manifold-3d'
import { beforeAll, describe, expect, test } from 'bun:test'
import { setup } from '../../model_gen/node-model'
import { referenceDesign } from '../../scripts/tarn-reference-design'
import { cosmosChecks } from './checks'
import { checkKeepers, measureSeats } from './seat'
import * as S from './socket'
import { buildCaseParts, fuseShapes, manifoldKernel, shapeMesh, tarnKeepers, toManifold } from './solids'
import { buildSpec, keyIds } from './spec'
import { backstopStrength, MIN_SAFETY } from './strength'

const MESH = { tolerance: 0.02, angularTolerance: 2 }
/** Touching faces leave slivers about this big after meshing; anything larger is an overlap. */
const TOUCH_MM3 = 0.02

let mf: ManifoldToplevel
const solid = (shape: { delete(): void } & Parameters<typeof shapeMesh>[0]) => {
  const m = toManifold(mf, shapeMesh(shape, MESH))
  shape.delete()
  return m
}
const overlap = (a: Manifold, b: Manifold) => {
  const i = a.intersect(b)
  const v = Math.max(0, i.volume())
  i.delete()
  return v
}

beforeAll(async () => {
  await setup()
  mf = await manifoldKernel()
})

describe('the socket holds the island with the ADR 0009 stack', () => {
  test('the stack is FR4 1.6 + flex 0.12 + socket body 1.8 under the switch housing (ADR 0009)', () => {
    expect(S.STIFFENER_TOP).toBeCloseTo(S.HOUSING_BOTTOM, 9)
    expect(S.STIFFENER_TOP - S.SOCKET_BOTTOM).toBeCloseTo(1.6 + 0.12 + 1.8, 9)
    // ADR 0009: about 0.5 mm deeper than Cosmos's 5.2 mm Choc box, before the keeper.
    expect(-S.SOCKET_BOTTOM).toBeGreaterThan(5.2 + 0.5)
  })

  test('the island envelope lies inside the socket footprint and clear of the socket solid', () => {
    const socket = solid(S.socketSolid())
    const [fx0, fy0, fx1, fy1] = S.FOOTPRINT_RECT
    for (const p of S.islandEnvelope()) {
      for (const [x, y] of p.outline) {
        expect(x).toBeGreaterThanOrEqual(fx0)
        expect(x).toBeLessThanOrEqual(fx1)
        expect(y).toBeGreaterThanOrEqual(fy0)
        expect(y).toBeLessThanOrEqual(fy1)
      }
    }
    for (const { name, shape } of S.islandSolids()) {
      const island = solid(shape)
      expect(overlap(island, socket), name).toBeLessThan(1e-6)
      island.delete()
    }
    socket.delete()
  })

  test('the island fits the pocket with clearance on every side', () => {
    const [ix0, iy0, ix1, iy1] = S.ISLAND
    const [px0, py0, px1, py1] = S.POCKET
    expect([ix0 - px0, iy0 - py0, px1 - ix1, py1 - iy1].every(g => g > 0)).toBe(true)
    // Posts stand outside the pocket.
    for (const post of Object.values(S.POSTS)) {
      const [x0, y0, x1, y1] = post.rect
      const inside = x0 < px1 - 1e-9 && x1 > px0 + 1e-9 && y0 < py1 - 1e-9 && y1 > py0 + 1e-9
      expect(inside).toBe(false)
    }
  })

  test('the ledge (clamp) is directly over the island stiffener, and the keeper (backstop) directly under the hotswap socket', () => {
    const socket = solid(S.socketSolid())
    // A thin slab just above the stiffener top, over the island outside the clip relief, is socket material.
    for (const r of S.ledgeOverIsland()) {
      const slab = mf.Manifold.cube([r[2] - r[0], r[3] - r[1], 0.05]).translate([r[0], r[1], S.STIFFENER_TOP])
      expect(overlap(slab, socket) / slab.volume()).toBeGreaterThan(0.99)
      slab.delete()
    }
    socket.delete()
    // Under the hotswap socket, KEEPER_GAP below it, the keeper is solid over most of the socket's outline.
    const keeper = solid(S.keeperSolid())
    const body = S.islandEnvelope().find(p => p.name == 'hotswap socket')!
    const under = mf.Manifold.extrude([ccw(body.outline)], 0.05).translate([0, 0, S.KEEPER_TOP - 0.05])
    expect(overlap(under, keeper) / under.volume()).toBeGreaterThan(0.9)
    under.delete()
    // ... and nothing of the keeper rises into the socket body or the diode.
    for (const { name, shape } of S.islandSolids()) {
      const island = solid(shape)
      expect(overlap(island, keeper), name).toBeLessThan(1e-6)
      island.delete()
    }
    keeper.delete()
    expect(S.KEEPER_TOP).toBeLessThan(S.SOCKET_BOTTOM)
    expect(S.SOCKET_BOTTOM - S.KEEPER_TOP).toBeCloseTo(S.KEEPER_GAP, 9)
  })

  test('the keeper goes in: flat at its insertion place, then slid toward -Y into the windows', () => {
    const socket = solid(S.socketSolid())
    const sliding = solid(S.keeperSolid(false))
    const installed = solid(S.keeperSolid())
    // At the insertion place (TONGUE.slide toward +Y), with the snap arm pressed down, it clears the socket.
    const atStart = sliding.translate([0, S.TONGUE.slide, 0])
    expect(overlap(atStart, socket)).toBeLessThan(1e-6)
    // In place, the nub sits in P3b's hole and nothing overlaps.
    expect(overlap(installed, socket)).toBeLessThan(1e-6)
    // Every tongue is inside its window when installed, and outside it at the insertion place.
    for (const t of S.KEEPER_TONGUES) {
      const post = Object.values(S.POSTS).find(p => p.windows.some(w => t[0] >= w[0] && t[2] <= w[1]))!
      expect(t[1]).toBeLessThan(post.rect[3]) // reaches into the post's +Y face
      expect(t[1] + S.TONGUE.slide).toBeGreaterThan(post.rect[3]) // and is out of it before the slide
    }
    // The snap nub drops into P3b's hole only after the full slide.
    expect(S.SNAP.hole.diameter / 2 - S.SNAP.nub.diameter / 2).toBeLessThan(S.TONGUE.slide)
    socket.delete()
    sliding.delete()
    installed.delete()
    atStart.delete()
  })
})

describe('links have an exit on each side', () => {
  const exits = S.linkExits()
  test.each(Object.entries(exits))('%s side', (side, exit) => {
    // At least the widest link the harness uses: a 13-trace spine split 5 + 4 + 4 with 0.5 mm slits
    // (ADR 0006 item 3), w(N) = 0.3 N + 0.45 mm per strip (research/flex-pcb.md §6), plus 0.5 mm each side.
    // Column links (at most 4 traces, 1.65 mm) need less; the -Y exit is sized for those.
    const spine = 3 * 0.45 + 0.3 * 13 + 2 * 0.5
    const need = side == '-y' ? 0.3 * 4 + 0.45 + 1.0 : spine + 1.0
    expect(exit.width).toBeGreaterThanOrEqual(need)
  })
  test('the exits are open below: no post or keeper part closes them under the island', () => {
    // A link leaving an exit and turning down passes between the posts; the keeper stays inside the pocket outline there.
    for (const [side, exit] of Object.entries(exits) as [S.EdgeSide, S.LinkExit][]) {
      for (const post of Object.values(S.POSTS)) {
        const [x0, y0, x1, y1] = post.rect
        const along = side.endsWith('y') ? [x0, x1] : [y0, y1]
        const overlapsExit = along[0] < exit.to - 1e-9 && along[1] > exit.from + 1e-9
        const beside = side == '-y' ? y1 <= S.ISLAND[1] : side == '+y' ? y0 >= S.ISLAND[3] : side == '-x' ? x1 <= S.ISLAND[0] : x0 >= S.ISLAND[2]
        expect(overlapsExit && beside).toBe(false)
      }
    }
  })
})

describe('Cosmos sees the socket as socket.ts describes it', () => {
  const key = (island: string, mirrored = false) => ({ type: S.SOCKET_ID, variant: { island }, mirrored, aspect: 1 }) as any
  test('footprint, offset and frame depth', () => {
    const size = socketSize(key('Island West'), false) as number[]
    expect(size[0]).toBeCloseTo(S.FOOTPRINT[0], 6)
    expect(size[1]).toBeCloseTo(S.FOOTPRINT[1], 6)
    expect(size[2]).toBeCloseTo(S.FRAME_DEPTH, 6)
    expect(socketOffset(key('Island West'))).toEqual(S.FOOTPRINT_CENTRE)
    // East is the same socket turned 180 degrees; a mirrored left-half key's socket is flipped in X.
    expect(socketOffset(key('Island East'))).toEqual([-S.FOOTPRINT_CENTRE[0], -S.FOOTPRINT_CENTRE[1]])
    expect(socketOffset(key('Island West', true))).toEqual([-S.FOOTPRINT_CENTRE[0], S.FOOTPRINT_CENTRE[1]])
  })
  test('the floor envelope reaches below the posts under both variants', () => {
    for (const island of S.VARIANTS) {
      const pts = partBottom(key(island)).flat()
      expect(Math.min(...pts.map(p => p[2]))).toBeLessThanOrEqual(S.POST_BOTTOM)
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      expect(Math.min(...xs)).toBeLessThanOrEqual(-Math.max(-S.FOOTPRINT_RECT[0], S.FOOTPRINT_RECT[2]))
      expect(Math.min(...ys)).toBeLessThanOrEqual(-Math.max(-S.FOOTPRINT_RECT[1], S.FOOTPRINT_RECT[3]))
    }
    expect(PART_INFO[S.SOCKET_ID].stepFile).toContain(S.SOCKET_ID)
  })
})

test('the backstop carries the insertion force with a safety factor of at least 2', () => {
  const report = backstopStrength()
  expect(report.reactions.reduce((s, r) => s + r.reactionN, 0)).toBeCloseTo(report.loadN, 1) // reactions are rounded to 0.01 N
  for (const l of report.lines) expect(l.safety, l.part).toBeGreaterThanOrEqual(MIN_SAFETY)
})

describe('the Tarn reference design', () => {
  const url = referenceDesign()
  const { spec, cosmos, contexts } = buildSpec(url, null)

  test('every switch key has the Tarn socket, a backstop and a clamp', () => {
    for (const half of spec.halves) {
      expect(half.keys.length).toBeGreaterThan(0)
      for (const k of half.keys) {
        expect(k.socket).toBe(S.SOCKET_ID)
        expect(k.switch).toBe('choc-v2')
        expect(k.backstop?.bearingZ).toBeCloseTo(S.KEEPER_TOP, 6)
        expect(k.backstop?.designLoadN).toBeGreaterThanOrEqual(29.4) // 3 kgf
        expect(k.clamp?.bearingZ).toBeCloseTo(S.STIFFENER_TOP, 6)
        expect(k.backstop!.region.max[2]).toBeLessThan(k.clamp!.bearingZ)
      }
      expect(half.microcontroller?.type).toBe('lemon-wireless')
    }
  })

  test('partner keys put the island on mirrored sides', () => {
    const [left, right] = ['left', 'right'].map(s => spec.halves.find(h => h.side == s)!)
    for (const k of right.keys) {
      const partner = left.keys.find(l => l.id == k.id.replace('right-', 'left-'))!
      expect((partner.switchRotation! - k.switchRotation! + 360) % 360).toBe(180)
    }
  })

  test.each(contexts.map(c => [c.side, c] as const))('Cosmos reports no errors or warnings, %s half', (side, ctx) => {
    const results = cosmosChecks(ctx, keyIds(cosmos, ctx.conf, ctx.side))
    expect(results.map(r => `${r.severity}: ${r.message}`)).toEqual([])
  })

  test.each(contexts.map(c => [c.side, c] as const))('islands fit and keepers fit and go in, %s half', async (side, ctx) => {
    const half = structuredClone(spec.halves.find(h => h.side == side)!)
    const parts = await buildCaseParts(ctx, {})
    const opts = { tolerance: 0.05, angularTolerance: 5 }
    const body = fuseShapes(mf, parts.body.map(p => p.shape), opts)
    const others = [parts.plate, parts.holder].filter(p => p).map(p => fuseShapes(mf, [p!], opts))
    const material = mf.Manifold.union([body.manifold, ...others.map(o => o.manifold)])
    const keepers = (await tarnKeepers(half, opts))!
    const placed = toManifold(mf, keepers.placed)
    const seats = measureSeats(mf, ctx, half, material.add(placed))
    for (const k of seats.keys) expect(k.stacks.map(s => [k.id, s.stack, s.fits, s.interferingParts])).toEqual([[k.id, 'tarn island', true, {}]])
    const report = checkKeepers(mf, half, toManifold(mf, keepers.template), toManifold(mf, keepers.sliding), material, body.manifold)
    expect(report.keys.filter(k => !k.ok)).toEqual([])
    for (const p of parts.body) p.shape.delete()
  }, 60000)
})

function ccw(pts: [number, number][]) {
  const area = pts.reduce((a, [x, y], i) => a + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)
  return area < 0 ? [...pts].reverse() : pts
}

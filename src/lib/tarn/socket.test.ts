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
import { CONTACT_SEARCH_MM, CONTACT_TOLERANCE_MM, SWITCHES } from './harness'
import { checkKeepers, measureSeats } from './seat'
import * as S from './socket'
import { buildCaseParts, fuseShapes, inFrame, manifoldKernel, shapeMesh, switchMesh, tarnKeepers, toManifold } from './solids'
import { buildSpec, islandMatrix, isSpecKey, keyIds, rowMajor } from './spec'
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

  test('the ledge (clamp) is directly over the island stiffener, 0.2 mm above the switch housing it bears on', () => {
    const socket = solid(S.socketSolid())
    // A thin slab just under the ledge, over the island outside the clip relief, is socket material...
    for (const r of S.ledgeOverIsland()) {
      const slab = mf.Manifold.cube([r[2] - r[0], r[3] - r[1], 0.05]).translate([r[0], r[1], S.LEDGE_Z])
      expect(overlap(slab, socket) / slab.volume()).toBeGreaterThan(0.99)
      slab.delete()
    }
    // ...and nothing of the socket reaches down to the stiffener (the switch housing is the datum).
    const stiffener = solid(S.islandSolids().find(p => p.name == 'stiffener')!.shape)
    const raised = stiffener.translate([0, 0, S.TOL.case - 0.01])
    expect(overlap(raised, socket)).toBeLessThan(1e-6)
    expect(S.LEDGE_Z - S.STIFFENER_TOP).toBeCloseTo(S.TOL.case, 9)
    for (const m of [socket, stiffener, raised]) m.delete()
  })

  test('the adjuster (backstop) is under the hotswap socket body, and closes the gap over the whole tolerance', () => {
    const socket = solid(S.socketSolid())
    const keeper = S.keeperManifold(mf, solid(S.keeperSolid()))
    const island = S.islandSolids().map(({ name, shape }) => ({ name, m: solid(shape) }))
    const body = S.islandEnvelope().find(p => p.name == 'hotswap socket')!
    // The pad lies wholly under the socket body.
    const pad = mf.Manifold.cylinder(0.05, S.ADJUSTER.pad.radius, S.ADJUSTER.pad.radius, 48).translate([...S.ADJUSTER.at, S.SOCKET_BOTTOM - 0.05])
    const under = mf.Manifold.extrude([ccw(body.outline)], 0.05).translate([0, 0, S.SOCKET_BOTTOM - 0.05])
    expect(overlap(pad, under) / pad.volume()).toBeGreaterThan(0.99)
    // The range covers the socket body's place over the stack and print tolerances.
    const reach = S.TOL.stiffened + S.TOL.socketBase + S.TOL.case + S.TOL.part
    expect(S.PAD_RANGE[0]).toBeLessThanOrEqual(S.SOCKET_BOTTOM - reach)
    expect(S.PAD_RANGE[1]).toBeGreaterThanOrEqual(S.SOCKET_BOTTOM + reach)
    // The keeper stays below the socket body even with every tolerance against it.
    expect(S.KEEPER_TOP + S.TOL.case + S.TOL.part).toBeLessThan(S.SOCKET_BOTTOM - S.TOL.stiffened - S.TOL.socketBase)
    for (const padTop of [S.PAD_RANGE[0], S.SOCKET_BOTTOM, S.PAD_RANGE[1], S.KEEPER_TOP - 0.1]) {
      const adjuster = S.adjusterManifold(mf, padTop)
      // It turns freely in the keeper's thread and clears the socket at every setting...
      expect(overlap(adjuster, keeper), `pad at ${padTop}`).toBeLessThan(1e-6)
      expect(overlap(adjuster, socket), `pad at ${padTop}`).toBeLessThan(1e-6)
      // ...and at the nominal setting only the pad touches the island (on the socket body's underside).
      if (padTop == S.SOCKET_BOTTOM) for (const i of island) expect(overlap(adjuster, i.m), i.name).toBeLessThan(1e-6)
      adjuster.delete()
    }
    // The threads really engage: the same adjuster half a turn out of phase collides with the keeper.
    const [ax, ay] = S.ADJUSTER.at
    const adjuster = S.adjusterManifold(mf, S.SOCKET_BOTTOM)
    const turned = adjuster.translate([-ax, -ay, 0]).rotate([0, 0, 180]).translate([ax, ay, 0])
    expect(overlap(turned, keeper)).toBeGreaterThan(1)
    // Its knob stays below the keeper at the highest setting and above the Cosmos floor at the lowest.
    expect(S.PAD_RANGE[1] - S.ADJUSTER_LENGTH).toBeLessThanOrEqual(S.KEEPER_BOTTOM - 0.1)
    const lowest = S.adjusterManifold(mf, S.PAD_RANGE[0])
    expect(lowest.boundingBox().min[2]).toBeGreaterThan(-S.PART_BOTTOM_DEPTH)
    for (const m of [socket, keeper, pad, under, adjuster, turned, lowest, ...island.map(i => i.m)]) m.delete()
  })

  test('the adjuster self-locks, and a printed spring could not do its job', () => {
    const { adjuster, spring, deflectionMm } = backstopStrength()
    expect(adjuster.selfLocking).toBe(true)
    // A spring would have to give at least the insertion force over the whole travel.
    expect(spring.maxForceN).toBeLessThan(spring.neededN / 10)
    // The screw gives less than 0.1 mm under 30 N.
    expect(deflectionMm.total).toBeLessThan(0.1)
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

describe('pin engagement (switch contacts in the hotswap socket)', () => {
  const e = S.pinEngagement(backstopStrength().deflectionMm.total)
  test('with the adjuster set, the stiffener is against the housing: pin length less stiffener and flex', () => {
    expect(e.set.nominal).toBeCloseTo(S.PIN_LENGTH - S.STACK.stiffener - S.STACK.flex, 9)
    expect(e.set.nominal).toBeGreaterThanOrEqual(e.required)
    // Print and socket-base tolerances do not enter: the adjuster takes them up.
    expect(e.set.max - e.set.min).toBeCloseTo(2 * S.TOL.stiffened, 9)
  })
  // Fails on the ADR 0009 stack: FR4 1.6 + flex 0.12 at JLC's ±10 % leaves 1.108 mm at the minimum
  // (1.15 with FR4 ±0.1, flex ±0.03). No backstop can raise it; only a thinner stack can.
  test.failing('the minimum engagement is at least 1.24 mm (a 1.76 mm PCB)', () => {
    expect(e.set.min).toBeGreaterThanOrEqual(e.required)
    expect(e.setPartTolerances.min).toBeGreaterThanOrEqual(e.required)
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
        expect(k.backstop?.bearingZ).toBeCloseTo(S.SOCKET_BOTTOM, 6)
        expect(k.backstop?.designLoadN).toBeGreaterThanOrEqual(29.4) // 3 kgf
        expect(k.clamp?.bearingZ).toBeCloseTo(S.LEDGE_Z, 6)
        expect(k.backstop!.region.max[2]).toBeLessThan(k.clamp!.bearingZ)
        expect(k.island, k.id).toBeDefined()
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

  test('both variants occur on both halves', () => {
    for (const half of spec.halves) expect(new Set(half.keys.map(k => k.island!.variant))).toEqual(new Set(['west', 'east']))
  })

  test('spec 0.3 island: a proper pose, equal to pose · Rz(switchRotation) · T(0, 0, stiffener top), and the same island on every key', () => {
    const fields = S.islandSpecFields(180)
    for (const k of spec.halves.flatMap(h => h.keys)) {
      const island = k.island!
      expect(island.pose).toEqual(rowMajor(islandMatrix(k.pose, k.switchRotation!)))
      const p = island.pose
      const det = p[0] * (p[5] * p[10] - p[6] * p[9]) - p[1] * (p[4] * p[10] - p[6] * p[8]) + p[2] * (p[4] * p[9] - p[5] * p[8])
      expect(det, k.id).toBeCloseTo(1, 6)
      expect(island.variant).toBe(S.socketTurn(k.switchRotation!) == 0 ? 'west' : 'east')
      expect(island.envelope).toEqual(fields.envelope)
      expect(island.exits).toEqual(fields.exits)
      expect(island.envelope.stiffenerTopZ - island.envelope.stiffenerBottomZ).toBeCloseTo(S.STACK.stiffener, 9)
    }
  })

  test.each(contexts.map(c => [c.side, c] as const))("spec 0.3 island: the datasheet pins and centre post land on the switch model's, inside the envelope, %s half", async (side, ctx) => {
    // switches.stl is these meshes (solids.switchAndKeycapMeshes), merged.
    const half = spec.halves.find(h => h.side == side)!
    const facts = SWITCHES['choc-v2']
    const confIndex = ctx.conf.keys.flatMap((k, i) => (isSpecKey(k) ? [i] : []))
    const checked = { west: 0, east: 0 }
    const postTip = new Set<number>()
    const round3 = (x: number) => Math.round(x * 1000) / 1000
    for (const [n, key] of half.keys.entries()) {
      const island = key.island!
      const frame = islandMatrix(key.pose, key.switchRotation!)
      const mesh = (await switchMesh(ctx, confIndex[n]))!
      // The switch model's vertices in the island frame (z = 0 is the stiffener top, the housing bottom).
      const local = inFrame(mesh, frame)
      for (const p of facts.protrusions.filter(p => p.name != 'fixing leg')) {
        const r = p.diameter / 2
        const [x, y] = p.at
        // Inside the island outline, with the whole pin or post.
        expect(x - r, `${key.id} ${p.name}`).toBeGreaterThanOrEqual(island.envelope.min[0])
        expect(x + r, `${key.id} ${p.name}`).toBeLessThanOrEqual(island.envelope.max[0])
        expect(y - r, `${key.id} ${p.name}`).toBeGreaterThanOrEqual(island.envelope.min[1])
        expect(y + r, `${key.id} ${p.name}`).toBeLessThanOrEqual(island.envelope.max[1])
        // The model's pin below the housing: centred on the datasheet position, reaching the datasheet tip.
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity
        for (let i = 0; i < local.length; i += 3) {
          if (local[i + 2] < -0.5 && Math.hypot(local[i] - x, local[i + 1] - y) <= r + CONTACT_SEARCH_MM) {
            x0 = Math.min(x0, local[i]), x1 = Math.max(x1, local[i]), y0 = Math.min(y0, local[i + 1]), y1 = Math.max(y1, local[i + 1]), z0 = Math.min(z0, local[i + 2])
          }
        }
        expect(Number.isFinite(z0), `${key.id} ${p.name} found`).toBe(true)
        expect(Math.hypot((x0 + x1) / 2 - x, (y0 + y1) / 2 - y), `${key.id} ${p.name} offset`).toBeLessThanOrEqual(CONTACT_TOLERANCE_MM)
        // Contacts reach the datasheet tip. Cosmos's model draws the centre post 0.65 mm off the datasheet's 3.30 length, so only its position is checked.
        if (p.name.startsWith('contact')) expect(Math.abs(z0 - (p.tipZ - S.STIFFENER_TOP)), `${key.id} ${p.name} tip`).toBeLessThanOrEqual(0.5)
        else postTip.add(round3(z0 + S.STIFFENER_TOP))
      }
      checked[island.variant]++
    }
    expect(checked.west).toBeGreaterThan(0)
    expect(checked.east).toBeGreaterThan(0)
    // The model's centre post is the same on every key, 0.65 mm off the datasheet's tip.
    expect([...postTip].map(z => Math.abs(z - facts.protrusions.find(p => p.name == 'centre post')!.tipZ))).toEqual([expect.closeTo(0.65, 2)])
  }, 60000)

  test.each(contexts.map(c => [c.side, c] as const))('islands fit and keepers fit and go in, %s half', async (side, ctx) => {
    const half = structuredClone(spec.halves.find(h => h.side == side)!)
    const parts = await buildCaseParts(ctx, {})
    const opts = { tolerance: 0.05, angularTolerance: 5 }
    const body = fuseShapes(mf, parts.body.map(p => p.shape), opts)
    const others = [parts.plate, parts.holder].filter(p => p).map(p => fuseShapes(mf, [p!], opts))
    const material = mf.Manifold.union([body.manifold, ...others.map(o => o.manifold)])
    const keepers = (await tarnKeepers(mf, half, opts))!
    const placed = toManifold(mf, keepers.placed)
    const seats = measureSeats(mf, ctx, half, material.add(placed))
    for (const k of seats.keys) expect(k.stacks.map(s => [k.id, s.stack, s.fits, s.interferingParts])).toEqual([[k.id, 'tarn island', true, {}]])
    const report = checkKeepers(mf, half, keepers.installed, keepers.sliding, material, body.manifold)
    expect(report.keys.filter(k => !k.ok)).toEqual([])
    for (const p of parts.body) p.shape.delete()
  }, 60000)
})

function ccw(pts: [number, number][]) {
  const area = pts.reduce((a, [x, y], i) => a + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0)
  return area < 0 ? [...pts].reverse() : pts
}

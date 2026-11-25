import { socketSize } from '$lib/geometry/socketsParts'
import { beforeAll, describe, expect, test } from 'bun:test'
import { setup } from '../../model_gen/node-model'
import { type Box3, contactsInSwitchFrame, matchContacts, rotateXY, switchFacts } from './harness'
import { measureSeats, poseMatrix } from './seat'
import { buildCaseParts, type CaseParts, type Fused, fuseShapes, inFrame, manifoldKernel, manifoldMesh, shapeMesh, signedVolume, switchMesh, toManifold, type TriMesh } from './solids'
import { buildSpec, type HalfContext, isSpecKey, type SpecHalf } from './spec'

/** The Cosmos default layout with Choc V2 and with MX sockets (designs/ in the Tarn repo). */
const DEFAULT_CHOC_V2 =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwYYiiCCAQIEAg=='
const DEFAULT_MX =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwaCAQIEAg=='

const MESH = { tolerance: 0.1, angularTolerance: 10 }
/** The export's own STL settings, so the fused volumes are the ones written to case.stl. */
const EXPORT_MESH = { tolerance: 0.01, angularTolerance: 1 }

function nearestVertex(mesh: TriMesh, p: number[]) {
  let best = Infinity
  const v = mesh.positions
  for (let i = 0; i < v.length; i += 3) best = Math.min(best, Math.hypot(v[i] - p[0], v[i + 1] - p[1], v[i + 2] - p[2]))
  return best
}

const apply = (pose: number[], [x, y, z]: number[]) => [0, 1, 2].map(i => pose[4 * i] * x + pose[4 * i + 1] * y + pose[4 * i + 2] * z + pose[4 * i + 3])
const insideBox = (b: Box3, p: number[], tol = 1e-6) => p.every((x, i) => x >= b.min[i] - tol && x <= b.max[i] + tol)

/** Every edge is used exactly twice, once in each direction. */
function closedAndOriented(mesh: TriMesh) {
  const directed = new Map<string, number>()
  for (let t = 0; t < mesh.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const key = `${mesh.indices[t + e]},${mesh.indices[t + (e + 1) % 3]}`
      directed.set(key, (directed.get(key) ?? 0) + 1)
    }
  }
  for (const [key, n] of directed) {
    const [a, b] = key.split(',')
    if (n != 1 || directed.get(`${b},${a}`) != 1) return false
  }
  return true
}

beforeAll(async () => {
  await setup()
})

/** Case parts per design and half, built once for all tests. */
const partsCache = new Map<string, Promise<CaseParts>>()
const caseParts = (url: string, ctx: HalfContext) => {
  const key = `${url} ${ctx.side}`
  if (!partsCache.has(key)) partsCache.set(key, buildCaseParts(ctx, {}))
  return partsCache.get(key)!
}

describe('case solids agree with the spec poses', () => {
  const { spec, contexts } = buildSpec(DEFAULT_CHOC_V2, null)
  test.each(contexts.map(c => [c.side, c] as const))('%s half', async (side, ctx) => {
    const parts = await caseParts(DEFAULT_CHOC_V2, ctx)
    const holders = shapeMesh(parts.body.find(p => p.name == 'Switch Holders')!.shape, MESH)
    const half = spec.halves.find(h => h.side == side)!
    for (const [i, key] of half.keys.entries()) {
      const size = socketSize(ctx.conf.keys[i])
      if (!Array.isArray(size)) continue
      // The pose origin is the centre of the socket's top face, so its top corners sit at (±w/2, ±h/2, 0).
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = apply(key.pose, [sx * size[0] / 2, sy * size[1] / 2, 0])
        expect(nearestVertex(holders, corner), `${key.id} corner ${sx},${sy}`).toBeLessThan(1e-3)
      }
      // The socket's bottom face is the plate underside the spec reports.
      const bottom = apply(key.pose, [size[0] / 2, size[1] / 2, key.seat!.plateUndersideZ])
      expect(nearestVertex(holders, bottom), `${key.id} plate underside`).toBeLessThan(1e-3)
    }
    // Mirroring the left half must not turn the meshes inside out.
    for (const p of parts.body) expect(signedVolume(shapeMesh(p.shape, MESH)), p.name).toBeGreaterThan(0)
    expect(signedVolume(shapeMesh(parts.plate!, MESH)), 'plate').toBeGreaterThan(0)
  }, 120_000)
})

describe.each([['Choc V2', DEFAULT_CHOC_V2], ['MX', DEFAULT_MX]])('%s: fused case and harness seats', (_, url) => {
  const { spec, contexts } = buildSpec(url, null)
  const built: Record<string, { parts: CaseParts; body: Fused; obstacles: Fused; half: SpecHalf }> = {}

  beforeAll(async () => {
    const mf = await manifoldKernel()
    for (const ctx of contexts) {
      const parts = await caseParts(url, ctx)
      const body = fuseShapes(mf, parts.body.map(p => p.shape), EXPORT_MESH)
      const obstacles = fuseShapes(mf, [...parts.body.map(p => p.shape), parts.plate!, parts.holder!], MESH)
      const half = spec.halves.find(h => h.side == ctx.side)!
      measureSeats(mf, ctx, half, obstacles.manifold, { stacks: false })
      built[ctx.side] = { parts, body, obstacles, half }
    }
  }, 120_000)

  test('each half fuses into one closed manifold, and the halves have the same volume', async () => {
    const mf = await manifoldKernel()
    for (const side of ['left', 'right']) {
      const { body, parts } = built[side]
      expect(body.components, `${side} components`).toBe(1)
      expect(body.manifold.status(), side).toBe('NoError')
      // Manifold's own mesh is a 2-manifold, and so is the STL read back by position, as STL readers
      // do: closed and oriented, no zero-area triangles, no edges with four triangles.
      expect(closedAndOriented(manifoldMesh(body.manifold)), `${side} Manifold mesh closed and oriented`).toBe(true)
      expect(body.stl.degenerate, `${side} STL degenerate triangles`).toBe(0)
      expect(body.stl.unbalancedEdges, `${side} STL open or misoriented edges`).toBe(0)
      expect(body.stl.pinchedEdges, `${side} STL pinched edges`).toBe(0)
      // A reader that builds a Manifold from the STL gets the same solid back.
      const reread = toManifold(mf, body.mesh)
      expect(Math.abs(reread.volume() - body.stl.volume), `${side} STL read back: ${reread.volume()} vs ${body.stl.volume}`).toBeLessThan(0.01)
      expect(Math.abs(body.stl.volume - body.volume), `${side} STL vs fused volume`).toBeLessThan(1)
      reread.delete()
      expect(signedVolume(body.mesh), `${side} STL volume`).toBeCloseTo(body.volume, 0)
      // A union holds at least its largest part and at most all of them (plus the float-noise voids it fills).
      const volumes = parts.body.map(p => signedVolume(shapeMesh(p.shape, EXPORT_MESH)))
      expect(Math.abs(body.voidVolume), `${side} filled voids`).toBeLessThan(1)
      expect(body.volume).toBeGreaterThanOrEqual(Math.max(...volumes) - 1e-3)
      expect(body.volume).toBeLessThanOrEqual(volumes.reduce((a, b) => a + b, 0) - body.voidVolume + 1e-3)
    }
    const [l, r] = [built.left.body, built.right.body]
    expect(Math.abs(l.volume - r.volume) / r.volume, `left ${l.volume} vs right ${r.volume}`).toBeLessThan(1e-6)
    expect(Math.abs(l.stl.volume - r.stl.volume) / r.stl.volume, `STL left ${l.stl.volume} vs right ${r.stl.volume}`).toBeLessThan(1e-6)
  })

  test('the seat volume contains the switch pins', async () => {
    for (const [side, { half }] of Object.entries(built)) {
      const ctx = contexts.find(c => c.side == side)!
      const confIndex = ctx.conf.keys.flatMap((k, i) => (isSpecKey(k) ? [i] : []))
      for (const [n, key] of half.keys.entries()) {
        const facts = switchFacts(key.switch)
        if (!facts) continue
        const seat = key.seat!
        expect(seat.clear, key.id).not.toBeNull()
        const clear = seat.clear!
        expect(clear.max[2]).toBe(seat.stiffenerTopZ)
        expect(seat.stiffenerTopZ).toBeLessThanOrEqual(seat.plateUndersideZ)
        const inSeat = (q: number[], what: string) => {
          expect(insideBox(clear, q), `${key.id} ${what} ${q} in clear ${JSON.stringify(clear)}`).toBe(true)
          expect(seat.reserved.some(b => insideBox(b, q)), `${key.id} ${what} ${q} in Cosmos's envelope`).toBe(true)
        }
        // Datasheet pins, as placed by switchRotation: their axis from the housing bottom to the tip.
        for (const p of facts.protrusions.filter(p => p.name.startsWith('contact'))) {
          const [x, y] = rotateXY(p.at, key.switchRotation!)
          for (const z of [facts.housingBottomZ, p.tipZ]) inSeat([x, y, z], p.name)
        }
        // The pins of the exported switch model: every vertex below the housing near a contact.
        const local = inFrame((await switchMesh(ctx, confIndex[n]))!, poseMatrix(key.pose))
        const pins = contactsInSwitchFrame(facts, key.switchRotation!)
        let vertices = 0
        for (let i = 0; i < local.length; i += 3) {
          const q = [local[i], local[i + 1], local[i + 2]]
          if (q[2] < facts.housingBottomZ - 0.5 && pins.some(c => Math.hypot(q[0] - c[0], q[1] - c[1]) < 1)) {
            inSeat(q, 'model pin vertex')
            vertices++
          }
        }
        expect(vertices, key.id).toBeGreaterThan(0)
        expect(matchContacts(local, facts, key.switchRotation!).every(m => m.lands), key.id).toBe(true)
      }
    }
  })

  test('partner keys have the same clear box', () => {
    const [left, right] = [built.left.half, built.right.half]
    for (const [i, l] of left.keys.entries()) {
      const r = right.keys[i]
      if (!l.seat?.clear || !r.seat?.clear) continue
      for (const end of ['min', 'max'] as const) {
        l.seat.clear[end].forEach((x, j) => expect(Math.abs(x - r.seat!.clear![end][j]), `${l.id} clear.${end}[${j}]`).toBeLessThan(1e-3))
      }
    }
  })
})

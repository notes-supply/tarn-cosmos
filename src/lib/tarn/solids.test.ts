import { beforeAll, describe, expect, test } from 'bun:test'
import { socketSize } from '$lib/geometry/socketsParts'
import { setup } from '../../model_gen/node-model'
import { buildCaseParts, shapeMesh, signedVolume, type TriMesh } from './solids'
import { buildSpec } from './spec'

/** The Cosmos default layout with Choc V2 sockets (designs/cosmos-default-choc-v2 in the Tarn repo). */
const DEFAULT_CHOC_V2 =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwYYiiCCAQIEAg=='

function nearestVertex(mesh: TriMesh, p: number[]) {
  let best = Infinity
  const v = mesh.positions
  for (let i = 0; i < v.length; i += 3) best = Math.min(best, Math.hypot(v[i] - p[0], v[i + 1] - p[1], v[i + 2] - p[2]))
  return best
}

const apply = (pose: number[], [x, y, z]: number[]) => [0, 1, 2].map(i => pose[4 * i] * x + pose[4 * i + 1] * y + pose[4 * i + 2] * z + pose[4 * i + 3])

describe('case solids agree with the spec poses', () => {
  beforeAll(async () => {
    await setup()
  })

  const { spec, contexts } = buildSpec(DEFAULT_CHOC_V2, null)
  test.each(contexts.map(c => [c.side, c] as const))('%s half', async (side, ctx) => {
    const parts = await buildCaseParts(ctx, {})
    const holders = shapeMesh(parts.body.find(p => p.name == 'Switch Holders')!.shape, { tolerance: 0.1, angularTolerance: 10 })
    const half = spec.halves.find(h => h.side == side)!
    for (const [i, key] of half.keys.entries()) {
      const size = socketSize(ctx.conf.keys[i])
      if (!Array.isArray(size)) continue
      // The pose origin is the centre of the socket's top face, so its top corners sit at (±w/2, ±h/2, 0).
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const corner = apply(key.pose, [sx * size[0] / 2, sy * size[1] / 2, 0])
        expect(nearestVertex(holders, corner), `${key.id} corner ${sx},${sy}`).toBeLessThan(1e-3)
      }
    }
    // Mirroring the left half must not turn the meshes inside out.
    for (const p of parts.body) expect(signedVolume(shapeMesh(p.shape, { tolerance: 0.1, angularTolerance: 10 })), p.name).toBeGreaterThan(0)
    expect(signedVolume(shapeMesh(parts.plate!, { tolerance: 0.1, angularTolerance: 10 })), 'plate').toBeGreaterThan(0)
  }, 120_000)
})

import { describe, expect, test } from 'bun:test'
import type { CosmosCluster, CosmosKeyboard } from '$lib/worker/config.cosmos'
import { buildSpec, type Pose, type SpecHalf, type TarnSpec } from './spec'

/** The Cosmos default layout (MX, direct solder) and the same layout with Choc V2 sockets. */
const DEFAULT_MX =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwaCAQIEAg=='
const DEFAULT_CHOC_V2 =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwYYiiCCAQIEAg=='
/** From model.test.ts: one column with a shaper key and a display, given as a bare hash. */
const SHAPER_AND_DISPLAY =
  'Ck8KRxIWCAgQMCATKGQw9ANAgOaQHEiAgJD9AxIVCBIQQCAAQIC8uAxIgLaqofoHiAFQEgkgAECrhbyc8DgSCSAAQKyFvJzwODgAGABAgJAXCgIYAiIKCMgBEMgBGAAgAGgAggECBALyAQIIAg=='

const DESIGNS = { 'default MX': DEFAULT_MX, 'default Choc V2': DEFAULT_CHOC_V2, 'shaper and display': SHAPER_AND_DISPLAY }
/** Designs with an ordinary keywell, where every finger key faces up and toward the typist. */
const TYPICAL = new Set([DEFAULT_MX, DEFAULT_CHOC_V2])

type M3 = number[][]
const rot = (p: Pose): M3 => [0, 1, 2].map(i => [0, 1, 2].map(j => p[4 * i + j]))
const pos = (p: Pose) => [p[3], p[7], p[11]]
const col = (p: Pose, j: number) => [p[j], p[4 + j], p[8 + j]]
const det = (r: M3) => r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])
const mirror = (v: number[]) => [-v[0], v[1], v[2]]
const near = (a: number[], b: number[], tol: number) => a.every((x, i) => Math.abs(x - b[i]) <= tol)

function allPoses(half: SpecHalf): [string, Pose][] {
  return [
    ...half.keys.map(k => [k.id, k.pose] as [string, Pose]),
    ...(half.microcontroller ? [[`${half.side}/microcontroller`, half.microcontroller.pose] as [string, Pose]] : []),
    ...half.connectors.map((c, i) => [`${half.side}/connector${i}`, c.pose] as [string, Pose]),
    ...half.screws.map((s, i) => [`${half.side}/screw${i}`, s.pose] as [string, Pose]),
  ]
}

/** Count the physical keys of one side straight from Cosmos's cluster tree. */
function designKeyCount(cosmos: CosmosKeyboard, side: 'left' | 'right') {
  const typeOf = (k: CosmosCluster['keys'][number], col: CosmosCluster, cl: CosmosCluster) => k.partType.type || col.partType.type || cl.partType.type || cosmos.partType.type
  const count = (clusters: CosmosCluster[]) => clusters.reduce((n, cl) => n + cl.clusters.reduce((m, col) => m + col.keys.filter(k => typeOf(k, col, cl) != 'blank').length, 0), 0)
  const own = cosmos.clusters.filter(c => c.side == side)
  if (side == 'right') return count(own)
  // A left half without its own clusters mirrors the right half's.
  const right = cosmos.clusters.filter(c => c.side == 'right')
  return count(['fingers', 'thumbs'].flatMap(name => own.filter(c => c.name == name).length ? own.filter(c => c.name == name) : right.filter(c => c.name == name)))
}

const halves = (spec: TarnSpec) => ({ left: spec.halves.find(h => h.side == 'left')!, right: spec.halves.find(h => h.side == 'right')! })

describe.each(Object.entries(DESIGNS))('%s', (_, url) => {
  const { spec, cosmos } = buildSpec(url, null)
  const { left, right } = halves(spec)

  test('every pose is a proper rigid transform', () => {
    for (const half of spec.halves) {
      for (const [id, pose] of allPoses(half)) {
        expect(pose.length, id).toBe(16)
        const r = rot(pose)
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const dotij = r[0][i] * r[0][j] + r[1][i] * r[1][j] + r[2][i] * r[2][j]
            expect(Math.abs(dotij - (i == j ? 1 : 0)), `${id} R^T R [${i}][${j}]`).toBeLessThan(1e-6)
          }
        }
        expect(Math.abs(det(r) - 1), `${id} det`).toBeLessThan(1e-6)
        expect(pose.slice(12), `${id} bottom row`).toEqual([0, 0, 0, 1])
      }
    }
  })

  test('key count matches the design and ids are unique', () => {
    expect(left.keys.length).toBe(designKeyCount(cosmos, 'left'))
    expect(right.keys.length).toBe(designKeyCount(cosmos, 'right'))
    const ids = spec.halves.flatMap(h => h.keys.map(k => k.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the switch type carries through', () => {
    for (const half of spec.halves) {
      for (const key of half.keys) {
        if (key.socket.startsWith('mx-')) expect(key.switch).toBe('mx')
        else if (key.socket.startsWith('choc-v2')) expect(key.switch).toBe('choc-v2')
        else if (key.socket.startsWith('choc-v1')) expect(key.switch).toBe('choc-v1')
        else expect(key.switch).toBe('other')
      }
      // Every switch key uses the design's default socket (none of these designs override it per key).
      const switches = half.keys.filter(k => k.switch != 'other')
      expect(switches.length).toBeGreaterThan(0)
      for (const key of switches) expect(key.socket).toBe(cosmos.partType.type)
    }
  })

  test('left and right are mirror images', () => {
    expect(left.keys.map(k => k.id.replace(/^left-/, ''))).toEqual(right.keys.map(k => k.id.replace(/^right-/, '')))
    const pairs: [Pose, Pose, string][] = left.keys.map((k, i) => [k.pose, right.keys[i].pose, k.id])
    if (left.microcontroller && right.microcontroller) pairs.push([left.microcontroller.pose, right.microcontroller.pose, 'microcontroller'])
    left.connectors.forEach((c, i) => pairs.push([c.pose, right.connectors[i].pose, `connector ${i}`]))
    left.screws.forEach((s, i) => pairs.push([s.pose, right.screws[i].pose, `screw ${i}`]))
    for (const [l, r, what] of pairs) {
      // The position mirrors across the split plane (x = 0 of the half frames)...
      expect(near(pos(l), mirror(pos(r)), 1e-5), `${what} position`).toBe(true)
      // ...and the frames correspond: Y and Z mirror, X mirrors and flips so the frame stays right-handed.
      expect(near(col(l, 1), mirror(col(r, 1)), 1e-6), `${what} +Y`).toBe(true)
      expect(near(col(l, 2), mirror(col(r, 2)), 1e-6), `${what} +Z`).toBe(true)
      expect(near(col(l, 0), mirror(col(r, 0)).map(x => -x), 1e-6), `${what} +X`).toBe(true)
    }
    for (const [l, r] of [[left, right], [right, left]]) {
      expect(l.keys.map(k => [k.cluster, k.row, k.switch, k.socket, JSON.stringify(k.keycap)])).toEqual(r.keys.map(k => [k.cluster, k.row, k.switch, k.socket, JSON.stringify(k.keycap)]))
    }
  })

  test.if(TYPICAL.has(url))('switch frames face the typist the way the switch frame says', () => {
    for (const half of spec.halves) {
      for (const key of half.keys.filter(k => k.cluster == 'fingers')) {
        const p = key.pose
        expect(col(p, 2)[2], `${key.id}: +Z (toward the fingertip) points up out of the case`).toBeGreaterThan(0)
        expect(col(p, 1)[1], `${key.id}: +Y (top of legend) points away from the typist`).toBeGreaterThan(0)
        expect(col(p, 0)[0], `${key.id}: +X (legend reading direction) points to the typist's right`).toBeGreaterThan(0)
        expect(pos(p)[2], `${key.id}: above the bottom of the case`).toBeGreaterThan(0)
      }
    }
  })
})

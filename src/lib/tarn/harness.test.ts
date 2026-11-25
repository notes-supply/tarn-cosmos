import '../../model_gen/node-model' // points Cosmos's GLB loader at the files on disk
import { encodeCosmosConfig, serializeCosmosConfig } from '$lib/worker/config.serialize'
import { describe, expect, test } from 'bun:test'
import { matchContacts, partFlipped, switchFacts } from './harness'
import { poseMatrix } from './seat'
import { inFrame, switchMesh } from './solids'
import { buildSpec, decodeDesign, isSpecKey } from './spec'

/** The Cosmos default layout with MX and with Choc V2 sockets (designs/ in the Tarn repo). */
const DEFAULT_MX =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwaCAQIEAg=='
const DEFAULT_CHOC_V2 =
  'https://ryanis.cool/cosmos/beta#cm:Cp0BChUSBRCAPyAnEgIgExICIAASADgxQAAKFRIFEIBLICcSAiATEgIgABIAOB1AAAoiEgUQgFcgJxICIBMSAiAAEgMQsC8SBRCwayAoOAlAgPC8AgofEgUQgGMgJxICIBMSAiAAEgMQsDsSBRCwIyAoOApAAAoZEgUQgG8gJxICIBMSAiAAEgA4HkCAhorABxgAQOiFoK7wVUjc8KKgAQqOAQorEhMQwIACQICAmAJIwpmglZC8AVBDEhJAgIDMAkjCmaCVkLwBUIYBWDo4CAoVEhAQQECAgCBI0JWA3ZD1A1ALUJ4CCicSEBBAQICA+AFI5pn8p5ALUFcSEUCAgKQDSPCZxLXQMFB0WJUBUH8YAiIOCMgBEMgBGAAgADAAOABAy4v8n9AxSK2R3I3BkwYYiiCCAQIEAg=='

/** The same layout with another socket, as tarn-set-socket makes it (no per-key overrides in these designs). */
function withSocket(url: string, type: string, variant: number) {
  const cosmos = decodeDesign(url)
  cosmos.partType = { ...cosmos.partType, type: type as any, variant }
  return 'https://ryanis.cool/cosmos/beta#cm:' + serializeCosmosConfig(encodeCosmosConfig(cosmos))
}

// Sockets whose variants Cosmos shows turned 180 degrees and not turned.
const DESIGNS = {
  'choc-v2': DEFAULT_CHOC_V2,
  'mx-better': DEFAULT_MX,
  'choc-v2-hotswap, North LED': withSocket(DEFAULT_CHOC_V2, 'choc-v2-hotswap', 0),
  'choc-v2-hotswap, South LED': withSocket(DEFAULT_CHOC_V2, 'choc-v2-hotswap', 1),
  'mx-hotswap, North LED': withSocket(DEFAULT_MX, 'mx-hotswap', 0),
  'mx-hotswap, South LED': withSocket(DEFAULT_MX, 'mx-hotswap', 4),
}

describe.each(Object.entries(DESIGNS))('switchRotation, %s', (name, url) => {
  const { spec, contexts } = buildSpec(url, null)

  test('the design exercises the socket it names', () => {
    const keys = contexts.flatMap(c => c.conf.keys.filter(isSpecKey))
    expect(keys.every(k => name.startsWith(k.type + ',') || name == k.type)).toBe(true)
    const flipped = keys.filter(partFlipped).length
    expect(flipped == 0 || flipped == keys.length).toBe(true)
  })

  test.each(contexts.map(c => [c.side, c] as const))('datasheet contacts land on the switch model pins, %s half', async (side, ctx) => {
    const half = spec.halves.find(h => h.side == side)!
    const confIndex = ctx.conf.keys.flatMap((k, i) => (isSpecKey(k) ? [i] : []))
    let checked = 0
    for (const [n, key] of half.keys.entries()) {
      const facts = switchFacts(key.switch)
      if (!facts) continue
      expect(key.switchRotation, key.id).not.toBeNull()
      const local = inFrame((await switchMesh(ctx, confIndex[n]))!, poseMatrix(key.pose))
      for (const m of matchContacts(local, facts, key.switchRotation!)) {
        expect(m.found, `${key.id} ${m.name}: model material at (${m.expected})`).not.toBeNull()
        expect(m.lands, `${key.id} ${m.name}: found ${JSON.stringify(m.found)} for (${m.expected})`).toBe(true)
      }
      // The check discriminates: the switch turned the other way round does not match.
      expect(matchContacts(local, facts, (key.switchRotation! + 180) % 360).every(m => m.lands), `${key.id} turned 180`).toBe(false)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('both halves carry the same rotation', () => {
    const [left, right] = ['left', 'right'].map(s => spec.halves.find(h => h.side == s)!)
    expect(left.keys.map(k => k.switchRotation)).toEqual(right.keys.map(k => k.switchRotation))
  })
})

test('a turned variant differs from the plain one by 180 degrees', () => {
  const rotation = (url: string) => buildSpec(url, null).spec.halves[0].keys[0].switchRotation!
  expect((rotation(DESIGNS['choc-v2-hotswap, South LED']) - rotation(DESIGNS['choc-v2-hotswap, North LED']) + 360) % 360).toBe(180)
  expect((rotation(DESIGNS['mx-hotswap, North LED']) - rotation(DESIGNS['mx-hotswap, South LED']) + 360) % 360).toBe(180)
})

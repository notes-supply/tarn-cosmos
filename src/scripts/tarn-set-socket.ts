#!/usr/bin/env bun
/**
 * Print a Cosmos design URL with every switch socket replaced by one socket type,
 * keeping the layout. This is how Tarn makes the same design for another switch.
 *
 *   bun src/scripts/tarn-set-socket.ts <design-url|hash|file> <socket> [--variant <n>]
 *
 * <socket> is a Cosmos socket id (src/lib/geometry/socketsParts.ts), e.g.
 * choc-v2, choc-v2-hotswap, mx-better. Non-switch parts (encoders, trackballs,
 * displays, shaper keys) are left alone. Run it from the repository root.
 */

import { PART_INFO } from '$lib/geometry/socketsParts'
import { decodeDesign } from '$lib/tarn/spec'
import type { CuttleKey } from '$lib/worker/config'
import type { CosmosCluster, CosmosKey, PartType } from '$lib/worker/config.cosmos'
import { encodeCosmosConfig, serializeCosmosConfig } from '$lib/worker/config.serialize'
import { existsSync, readFileSync, statSync } from 'fs'

const COSMOS_URL = 'https://ryanis.cool/cosmos/beta#cm:'

const args = process.argv.slice(2)
const variantAt = args.indexOf('--variant')
const variant = variantAt >= 0 ? Number(args.splice(variantAt, 2)[1]) : 0
if (args.length != 2 || !Number.isInteger(variant)) {
  console.error('usage: bun src/scripts/tarn-set-socket.ts <design-url|hash|file> <socket> [--variant <n>]')
  process.exit(2)
}
let [design, socket] = args
if (existsSync(design) && statSync(design).isFile()) design = readFileSync(design, 'utf-8').trim()

type Socket = CuttleKey['type']
const isSwitchSocket = (t: string | undefined): t is Socket => !!t && t in PART_INFO && t != 'blank' && !!PART_INFO[t as Socket].keycap
if (!isSwitchSocket(socket)) {
  console.error(`${socket} is not a Cosmos switch socket. Switch sockets: ${Object.keys(PART_INFO).filter(isSwitchSocket).join(', ')}`)
  process.exit(2)
}
const info = PART_INFO[socket]
const newVariant = 'variants' in info ? variant : undefined

const cosmos = decodeDesign(design)

/** Drop per-cluster, per-column and per-key switch overrides so every switch inherits the new socket. */
function clear(p: PartType) {
  if (isSwitchSocket(p.type) || (!p.type && p.variant !== undefined)) {
    p.type = undefined
    p.variant = undefined
  }
}
const visit = (c: CosmosCluster) => {
  clear(c.partType)
  c.clusters.forEach(visit)
  c.keys.forEach((k: CosmosKey) => clear(k.partType))
}
if (isSwitchSocket(cosmos.partType.type)) {
  cosmos.partType = { ...cosmos.partType, type: socket, variant: newVariant as number }
} else {
  console.error(`warning: the design's default part is ${cosmos.partType.type}; only explicit switch sockets are replaced`)
}
cosmos.clusters.forEach(visit)

if (info.keycap == 'choc' && cosmos.profile != 'choc') {
  console.error(`warning: ${socket} takes Choc V1 keycaps but the design uses ${cosmos.profile}`)
}

console.log(COSMOS_URL + serializeCosmosConfig(encodeCosmosConfig(cosmos)))

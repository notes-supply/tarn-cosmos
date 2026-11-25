#!/usr/bin/env bun
/**
 * Print the design link of the Tarn Choc V2 reference design
 * (designs/tarn-choc-v2 in the Tarn repo), built from Cosmos's default layout.
 * Every change from the default is listed in CHANGES, with its reason; the
 * design README repeats them.
 *
 *   bun src/scripts/tarn-reference-design.ts [--json]
 *
 * --json prints the changes and the link as JSON instead of the bare link.
 * Run it from the repository root.
 */

import { microcontrollerConnectors } from '$lib/geometry/microcontrollers'
import { encodeVariant } from '$lib/geometry/socketsParts'
import { SOCKET_ID } from '$lib/tarn/socket'
import { decodeDesign } from '$lib/tarn/spec'
import { decodeTuple, encodeTuple } from '$lib/worker/config'
import type { CosmosCluster, CosmosKeyboard } from '$lib/worker/config.cosmos'
import { encodeCosmosConfig, serializeCosmosConfig } from '$lib/worker/config.serialize'

const COSMOS_URL = 'https://ryanis.cool/cosmos/beta#cm:'

/** One change to the default layout. `apply` edits the decoded design in place. */
interface Change {
  what: string
  from: string
  to: string
  why: string
  apply: (c: CosmosKeyboard) => void
}

const fingers = (c: CosmosKeyboard) => c.clusters.find(cl => cl.side == 'right' && cl.name == 'fingers')!
const thumbs = (c: CosmosKeyboard) => c.clusters.find(cl => cl.side == 'right' && cl.name == 'thumbs')!
const column = (cl: CosmosCluster, col: number) => cl.clusters.find(c => c.column == col)!

/** Move a cluster's offset (tenths of a mm in Cosmos's position tuple) by dx, dy, dz mm. */
function move(cl: CosmosCluster, [dx, dy, dz]: [number, number, number]) {
  const [x, y, z, a] = cl.position ? decodeTuple(cl.position) : [0, 0, 0, 0]
  cl.position = encodeTuple([x + Math.round(dx * 10), y + Math.round(dy * 10), z + Math.round(dz * 10), a])
}

const WEST = encodeVariant(SOCKET_ID as any, { island: 'Island West' })
const EAST = encodeVariant(SOCKET_ID as any, { island: 'Island East' })

export const CHANGES: Change[] = [
  {
    what: 'switch socket (every key)',
    from: 'choc-v2',
    to: SOCKET_ID,
    why: 'Tarn Choc V2 socket: holds the flex harness island (ADR 0006 item 7) with the ADR 0009 stack, and the keeper under its hotswap socket.',
    apply: c => {
      c.partType = { ...c.partType, type: SOCKET_ID as any, variant: WEST }
    },
  },
  {
    what: 'island side (right half; the left half is the mirror image)',
    from: '-',
    to: 'Island West on finger columns c0-c2 and the thumb keys; Island East on c3 (ring), c4 (pinky) and thumbs-c0-r1',
    why:
      "The island is off-centre, so the socket reaches 10.4 mm from the switch centre on the island side and 9.2 mm on the other. Two wide sides must not meet across a steep gap, or the web between them climbs under the lower key's keycaps. c4 sits 12.5 mm above c3 (the default layout's pinky-wall clearance problem): c3's wide side faces c4, so the web starts further from c3's keycaps, and c4's narrow side faces back. c2 sits 5.7 mm below both neighbours on the number row: its wide side faces c1, whose narrow side faces back, and its narrow side faces c3's narrow side. thumbs-c0-r1 is East so its socket clears thumbs-c2-r1's. Chosen by running Cosmos's checks, the island and keeper checks and the keycap clearance for both variants of every column and thumb key.",
    apply: c => {
      for (const col of [0.5, 1.5]) {
        const cl = column(fingers(c), col)
        cl.partType = { ...cl.partType, variant: EAST }
      }
      const key = thumbs(c).clusters[0].keys[1]
      key.partType = { ...key.partType, variant: EAST }
    },
  },
  {
    what: 'webMinThicknessFactor',
    from: '0.8',
    to: '0.6',
    why:
      'Where a key sits much lower than its neighbours (the middle-finger column, 5.7 mm under them on the number row), Cosmos thickens the web between them to this fraction of the socket depth, and the thickened web reached under the keycaps: pressed middle-column keycaps came within 0 to 0.33 mm of it. At 0.6 the web there stays at least 1.3 mm thick and the keycaps keep at least 0.7 mm.',
    apply: c => {
      c.webMinThicknessFactor = 0.6
    },
  },
  {
    what: 'thumb cluster spacing (horizontal and vertical)',
    from: '20 mm',
    to: '21 mm',
    why: 'The Tarn socket is 19.6 x 19.9 mm (Cosmos choc-v2: 18 x 18). At 20 mm the thumb sockets overlapped each other.',
    apply: c => {
      thumbs(c).curvature = { ...thumbs(c).curvature, horizontalSpacing: 21, verticalSpacing: 21 }
    },
  },
  {
    what: 'thumb cluster position',
    from: '(-35.8, -25.6, -7.1)',
    to: '(-35.8, -26.1, -7.1)',
    why: "0.5 mm toward the typist: the keeper of thumbs-c1-r0 could not come up past a corner of fingers-c1-r3's socket.",
    apply: c => move(thumbs(c), [0, -0.5, 0]),
  },
  {
    what: 'verticalClearance',
    from: '0.1 mm',
    to: '1 mm',
    why: 'Lifts the keywell 0.9 mm off the floor so the keeper of thumbs-c2-r0 can come in over the screw boss under it.',
    apply: c => {
      c.verticalClearance = 1
    },
  },
  {
    what: 'microcontroller',
    from: 'kb2040-adafruit',
    to: 'lemon-wireless',
    why: "ADR 0010: Tarn's MCU board uses the lemon-wireless holder outline. Connectors follow, as Cosmos's editor sets them for that board.",
    apply: c => {
      c.microcontroller = 'lemon-wireless'
      const { connectors, mirrorConnectors } = microcontrollerConnectors(c.microcontroller, c.connectors)
      c.connectors = connectors
      c.mirrorConnectors = mirrorConnectors
    },
  },
  {
    what: 'bottom plate screws',
    from: 'screw insert (heat-set)',
    to: 'tapped hole',
    why: 'Heat-set inserts need a soldering iron (Cosmos docs/docs/screws.md), which Tarn rules out. M3 screws go straight into the printed hole.',
    apply: c => {
      c.screwType = 'tapped hole'
    },
  },
]

function referenceDesign() {
  const cosmos = decodeDesign('https://ryanis.cool/cosmos/beta#cm')
  for (const change of CHANGES) change.apply(cosmos)
  return COSMOS_URL + serializeCosmosConfig(encodeCosmosConfig(cosmos))
}

if (import.meta.main) {
  const url = referenceDesign()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ url, changes: CHANGES.map(({ apply, ...c }) => c) }, null, 2))
  } else {
    console.log(url)
  }
}

export { referenceDesign }

/**
 * Close-up renders of one Tarn socket with its harness island and keeper in
 * place: two sections and two views from below. Everything is drawn
 * in the key's switch frame (socket.ts), so the pictures read the same on
 * every key.
 *
 * Colours: case blue-grey, keeper orange, FR4 stiffener
 * green, flex amber, hotswap socket and diode near black, switch grey, keycap
 * off-white.
 */

import type { Manifold, ManifoldToplevel, Mat4 } from '@rianadon/manifold-3d'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { render, type RenderItem, type RGB } from './render'
import { manifoldMesh, toManifold, type TriMesh } from './solids'

export const CLOSEUP_COLORS: Record<string, RGB> = {
  case: [150, 170, 200],
  keeper: [235, 140, 50],
  stiffener: [70, 150, 80],
  flex: [215, 165, 40],
  'hotswap socket': [45, 45, 50],
  diode: [80, 80, 85],
  switch: [120, 120, 130],
  keycap: [235, 230, 220],
}

export interface CloseupInput {
  /** The key's pose (half frame from switch frame). */
  pose: Matrix4
  /** The fused case body of the half, in the half frame. */
  caseBody: Manifold
  /** In the switch frame. */
  keeper: TriMesh
  island: { name: string; mesh: TriMesh }[]
  /** In the half frame (Cosmos's models, not closed solids). */
  switchMesh: TriMesh | null
  keycapMesh: TriMesh | null
}

/** The region drawn around the socket, switch frame. */
const REGION = { min: [-13.5, -13.5, -12], max: [13.5, 13.5, 15] }

/** Keep the triangles of an open mesh whose centroid passes `keep`. */
function filterTriangles(mesh: TriMesh, keep: (x: number, y: number, z: number) => boolean): TriMesh {
  const p = mesh.positions
  const out: number[] = []
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]]
    const x = (p[3 * a] + p[3 * b] + p[3 * c]) / 3, y = (p[3 * a + 1] + p[3 * b + 1] + p[3 * c + 1]) / 3, z = (p[3 * a + 2] + p[3 * b + 2] + p[3 * c + 2]) / 3
    if (keep(x, y, z)) out.push(a, b, c)
  }
  return { positions: mesh.positions, indices: Uint32Array.from(out) }
}

function toLocal(mesh: TriMesh, inverse: Matrix4): TriMesh {
  const e = inverse.elements
  const p = mesh.positions
  const positions = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    positions[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    positions[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    positions[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
  return { positions, indices: mesh.indices }
}

interface Cut {
  axis: 0 | 1
  /** Keep material at coordinate >= at along the axis. */
  at: number
}

export interface Closeup {
  name: string
  description: string
  png: Uint8Array
}

/**
 * Renders of the socket at one key: a section across X through the W window
 * and the hotswap socket's receptacle, a section across Y through the -X ledge
 * and the keeper's rim, and two views from below (with and without the keeper).
 */
export function socketCloseups(mf: ManifoldToplevel, input: CloseupInput, size = 1024): Closeup[] {
  const inverse = input.pose.clone().invert()
  const local = input.caseBody.transform(inverse.elements as unknown as Mat4)
  const region = mf.Manifold.cube([REGION.max[0] - REGION.min[0], REGION.max[1] - REGION.min[1], REGION.max[2] - REGION.min[2]]).translate(REGION.min as [number, number, number])
  const caseLocal = local.intersect(region)
  local.delete()
  region.delete()
  const inRegion = (x: number, y: number, z: number) => [x, y, z].every((v, i) => v >= REGION.min[i] && v <= REGION.max[i])
  const switchLocal = input.switchMesh ? filterTriangles(toLocal(input.switchMesh, inverse), inRegion) : null
  const keycapLocal = input.keycapMesh ? filterTriangles(toLocal(input.keycapMesh, inverse), inRegion) : null

  const solids: { name: string; solid: Manifold }[] = [
    { name: 'case', solid: caseLocal },
    { name: 'keeper', solid: toManifold(mf, input.keeper) },
    ...input.island.map(i => ({ name: i.name, solid: toManifold(mf, i.mesh) })),
  ]

  const items = (cut: Cut | null, skip: string[] = [], open = true): RenderItem[] => {
    const out: RenderItem[] = []
    for (const { name, solid } of solids) {
      if (skip.includes(name)) continue
      let mesh: TriMesh
      if (cut) {
        const size = [60, 60, 60] as [number, number, number]
        const origin: [number, number, number] = [-30, -30, -30]
        origin[cut.axis] = cut.at
        const half = mf.Manifold.cube(size).translate(origin)
        const kept = solid.intersect(half)
        half.delete()
        mesh = manifoldMesh(kept)
        kept.delete()
      } else {
        mesh = manifoldMesh(solid)
      }
      if (mesh.indices.length) out.push({ mesh, color: CLOSEUP_COLORS[name] ?? [200, 0, 200] })
    }
    if (open) {
      for (const [name, mesh] of [['switch', switchLocal], ['keycap', keycapLocal]] as const) {
        if (!mesh || skip.includes(name)) continue
        const kept = cut ? filterTriangles(mesh, (x, y) => (cut.axis == 0 ? x : y) >= cut.at) : mesh
        if (kept.indices.length) out.push({ mesh: kept, color: CLOSEUP_COLORS[name] })
      }
    }
    return out
  }

  const views: { name: string; description: string; items: RenderItem[]; look: [number, number, number]; up: [number, number, number] }[] = [
    {
      name: 'section-x',
      description:
        'Section at x = 0.5 mm, seen from -X (switch frame; -Y, the hotswap socket side, is on the right): keycap, switch, plate and ledge, stiffener and flex, the hotswap socket on the keeper, the keeper tongue in the W window.',
      items: items({ axis: 0, at: 0.5 }),
      look: [1, 0, 0],
      up: [0, 0, 1],
    },
    {
      name: 'section-y',
      description: "Section at y = -2.2 mm, seen from -Y (+X on the right): the ledge over the island's -X strip, the keeper rim beside the hotswap socket, P3a and P3b behind.",
      items: items({ axis: 1, at: -2.2 }),
      look: [0, 1, 0],
      up: [0, 0, 1],
    },
    {
      name: 'below',
      description: 'From below, keeper in place: its four tongues in the windows of W, P4 and P3a, the snap arm under P3b.',
      items: items(null, ['keycap'], false),
      look: [0.35, 0.45, 1],
      up: [0, 1, 0],
    },
    {
      name: 'below-no-keeper',
      description: 'From below without the keeper: the island in its pocket, the windows in W, P4 and P3a, the snap hole in P3b, and the four open sides where links leave.',
      items: items(null, ['keeper', 'keycap'], false),
      look: [0.35, 0.45, 1],
      up: [0, 1, 0],
    },
  ]
  const out = views.map(v => ({ name: v.name, description: v.description, png: render(v.items, { look: v.look, up: v.up }, size, size, 2, 0.4) }))
  solids.forEach(s => s.solid.delete())
  return out
}

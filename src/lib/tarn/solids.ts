/**
 * Case solids and part meshes for the Tarn export.
 *
 * Builds the same parts as Cosmos's STEP download (src/lib/worker/api.ts,
 * getSTEP) with the Node-side OpenCascade setup from src/model_gen/node-model.ts,
 * places them in the Tarn half frame, and writes STEP and binary STL files.
 * The caller must have run node-model's setup() with the repository root as
 * the working directory, because Cosmos resolves its socket and part assets
 * relative to it.
 */

import { keyGeometry } from '$lib/loaders/keycaps'
import { partGeometry } from '$lib/loaders/parts'
import { boardHolder, cutWithConnector, keyHoles, makePlate, makerScrewInserts, makeWalls, webSolid } from '$lib/worker/model'
import { Assembly } from '$lib/worker/modeling/assembly'
import { combine } from '$lib/worker/modeling/index'
import Trsf from '$lib/worker/modeling/transformation'
import { newGeometry } from '$lib/worker/config'
import type { AnyShape } from 'replicad'
import type { BufferGeometry } from 'three'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { type HalfContext, isSpecKey, keycapSeat, partFlipped, partMatrix } from './spec'

/** A triangle mesh in the half frame. */
export interface TriMesh {
  positions: Float32Array // xyz per vertex
  indices: Uint32Array // 3 per triangle
}

export interface MeshOptions {
  tolerance: number
  angularTolerance: number
}

export type CasePartName = 'Walls' | 'Web' | 'Switch Holders' | 'Screw Attachments' | 'Bottom Plate' | 'Microcontroller Holder'

/** The case parts Cosmos produces for one half, already in the Tarn half frame. */
export interface CaseParts {
  /** Walls, web, switch holders and screw attachments: Cosmos's "case" model. */
  body: { name: CasePartName; shape: AnyShape }[]
  plate: AnyShape | null
  holder: AnyShape | null
}

/** Move a shape from Cosmos's modelling frame into the half frame (same as Cosmos's STEP download). */
function toHalfFrame<T extends AnyShape>(shape: T, ctx: HalfContext): T {
  const shifted = new Trsf().translate(0, 0, -ctx.geo.floorZ).transform(shape)
  shape.delete()
  if (ctx.side != 'left') return shifted
  const mirrored = shifted.mirror('YZ', [0, 0, 0]) as T
  return mirrored
}

export async function buildCaseParts(ctx: HalfContext, timings: Record<string, number>): Promise<CaseParts> {
  const { conf, side } = ctx
  // A fresh geometry: Cosmos memoizes geometry and some model functions mutate cached transforms.
  const geo = newGeometry(conf)
  const time = async <T>(label: string, f: () => T | Promise<T>) => {
    const start = performance.now()
    const result = await f()
    timings[label] = Math.round(performance.now() - start)
    return result
  }

  if (conf.shell.type == 'stilts') throw new Error('Stilts shells need Cosmos Pro and are not supported')

  const body: CaseParts['body'] = []
  let walls = await time('walls', () => makeWalls(conf, geo.allWallCriticalPoints(), geo.worldZ, geo.bottomZ).toSolid(true, false))
  if (geo.connectorOrigin) walls = await time('connector', () => cutWithConnector(conf, walls, geo.connectorOrigin!))
  body.push({ name: 'Walls', shape: walls })
  body.push({ name: 'Web', shape: await time('web', () => webSolid(conf, geo).toSolid(true, true)) })

  // Cosmos flips each socket in its own frame before mirroring the left half, so the sockets keep their handedness.
  const flip = new Trsf().scaleIsDangerous(side == 'left' ? -1 : 1, 1, 1)
  const holes = await time('switchHolders', () => keyHoles(conf, geo.keyHolesTrsfs.map(t => t.clone().multiply(flip))))
  body.push({ name: 'Switch Holders', shape: holes })

  if (geo.screwPositions.length) {
    body.push({ name: 'Screw Attachments', shape: await time('screwInserts', () => makerScrewInserts(conf, geo, ['base'])) })
  }

  const plate = await time('plate', async () => {
    const { top, bottom } = makePlate(conf, newGeometry(conf), true, true)
    return combine([await top(), bottom ? await bottom() : undefined])
  })
  const holder = conf.microcontroller ? await time('holder', () => boardHolder(conf, geo)) : null

  return {
    body: body.map(p => ({ name: p.name, shape: toHalfFrame(p.shape, ctx) })),
    plate: toHalfFrame(plate, ctx),
    holder: holder ? toHalfFrame(holder, ctx) : null,
  }
}

/** STEP file of named shapes, as an assembly (the shapes are not consumed). */
export async function stepFile(parts: { name: string; shape: AnyShape }[]): Promise<Uint8Array> {
  const assembly = new Assembly()
  for (const p of parts) assembly.add(p.name, p.shape)
  return new Uint8Array(await assembly.blobSTEP().arrayBuffer())
}

/** Triangulate a shape with OpenCascade. */
export function shapeMesh(shape: AnyShape, opts: MeshOptions): TriMesh {
  const m = shape.mesh(opts)
  return { positions: Float32Array.from(m.vertices), indices: Uint32Array.from(m.triangles) }
}

export function mergeMeshes(meshes: TriMesh[]): TriMesh {
  const nPos = meshes.reduce((n, m) => n + m.positions.length, 0)
  const nIdx = meshes.reduce((n, m) => n + m.indices.length, 0)
  const positions = new Float32Array(nPos)
  const indices = new Uint32Array(nIdx)
  let p = 0
  let i = 0
  for (const m of meshes) {
    positions.set(m.positions, p)
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = m.indices[k] + p / 3
    p += m.positions.length
    i += m.indices.length
  }
  return { positions, indices }
}

/** Copy a three.js geometry into the half frame. */
function placedGeometry(geometry: BufferGeometry, matrix: Matrix4): TriMesh {
  const pos = geometry.getAttribute('position')
  const positions = new Float32Array(pos.count * 3)
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix)
    positions[3 * i] = v.x
    positions[3 * i + 1] = v.y
    positions[3 * i + 2] = v.z
  }
  const index = geometry.getIndex()
  const indices = index ? Uint32Array.from(index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count }, (_, i) => i)
  // A mirrored placement would turn the triangles inside out.
  if (matrix.determinant() < 0) {
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  }
  return { positions, indices }
}

const ROT_Z_180 = new Matrix4().makeRotationZ(Math.PI)

/**
 * Switches and keycaps at rest, placed with the same poses as the spec,
 * using Cosmos's own part and keycap models.
 */
export async function switchAndKeycapMeshes(ctx: HalfContext) {
  const { conf, geo, half, side } = ctx
  const switches: TriMesh[] = []
  const keycaps: TriMesh[] = []
  const missing = new Set<string>()
  for (let i = 0; i < conf.keys.length; i++) {
    const key = conf.keys[i]
    if (!isSpecKey(key)) continue
    const pose = partMatrix(geo.keyHolesTrsfs[i], half, side)
    try {
      const part = await partGeometry(key.type, key.variant)
      if (part) switches.push(placedGeometry(part, pose.clone().multiply(partFlipped(key) ? ROT_Z_180 : new Matrix4())))
    } catch (e) {
      missing.add(`switch model for ${key.type}: ${(e as Error).message}`)
    }
    try {
      const cap = await keyGeometry(key)
      if (cap) keycaps.push(placedGeometry(cap, pose.clone().multiply(new Matrix4().makeTranslation(0, 0, keycapSeat(key)))))
    } catch (e) {
      missing.add(`keycap model for ${key.type}: ${(e as Error).message}`)
    }
  }
  return { switches: mergeMeshes(switches), keycaps: mergeMeshes(keycaps), missing: [...missing] }
}

/** Binary STL. Facet normals are computed from the winding. */
export function binarySTL(mesh: TriMesh, header = 'tarn-cosmos'): Uint8Array {
  const n = mesh.indices.length / 3
  const buf = new ArrayBuffer(84 + 50 * n)
  const bytes = new Uint8Array(buf)
  bytes.set(new TextEncoder().encode(header.slice(0, 80)))
  const view = new DataView(buf)
  view.setUint32(80, n, true)
  const p = mesh.positions
  let o = 84
  for (let t = 0; t < n; t++) {
    const a = 3 * mesh.indices[3 * t], b = 3 * mesh.indices[3 * t + 1], c = 3 * mesh.indices[3 * t + 2]
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len, ny /= len, nz /= len
    for (const x of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) {
      view.setFloat32(o, x, true)
      o += 4
    }
    view.setUint16(o, 0, true)
    o += 2
  }
  return bytes
}

/** Signed volume of a closed mesh (positive when the triangles wind outward). */
export function signedVolume(mesh: TriMesh) {
  const p = mesh.positions
  let v = 0
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = 3 * mesh.indices[t], b = 3 * mesh.indices[t + 1], c = 3 * mesh.indices[t + 2]
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])
  }
  return v / 6
}


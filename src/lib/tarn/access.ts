/**
 * Access lines to the Tarn keepers' adjusters (Tarn ADR 0014): the straight
 * line a 2.5 mm ball-end hex key takes from below, with the bottom plate off
 * and the battery out, to the adjuster's hex socket.
 *
 * Per key, the key's axis passes through the ball's centre, BALL_END
 * .centreDepth inside the socket, and may lean up to BALL_END.maxAngleDeg off
 * the adjuster axis. The planner tries directions ring by ring, from the axis
 * out, and takes the first ring with a clear direction, in the middle of its
 * widest clear arc. A line is clear when a ø ACCESS.diameter cylinder along
 * it, from the socket's mouth to where the line reaches the bottom plate's
 * top plane, misses the case (posts included), the holder and every other
 * keeper and adjuster, and when the key's long arm (ISO 2936, HEX.key
 * .longArm[0]) reaches the ball's tip from there. Where no direction in the
 * cone is clear, the case gets an access hole (ø ACCESS_HOLE) along the
 * least-blocked direction (mcuCase-style cut, applied by the export).
 */

import type { Manifold, ManifoldToplevel, Mat4 } from '@rianadon/manifold-3d'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { ACCESS, ADJUSTER, ADJUSTER_BOTTOM, BALL_END, HEX } from './socket'

/** Diameter of an access hole through a wall or the holder where no direction in the cone is clear. */
export const ACCESS_HOLE = 6.5
/** Ring and arc steps of the direction search (degrees). */
export const SEARCH = { tiltStepDeg: 2.5, azimuthStepDeg: 15 } as const
/** Overlaps smaller than this (mm^3) are touching faces, not material in the way. */
export const ACCESS_TOUCH_MM3 = 0.02

type XYZ = [number, number, number]

export interface AccessLine {
  /** From the bottom plate's top plane (axis[0]) up to the socket's mouth (axis[1]), half frame. */
  axis: [XYZ, XYZ]
  diameter: number
  /** Angle between the line and the adjuster axis (degrees). */
  angleDeg: number
}

export interface AccessPlan extends AccessLine {
  id: string
  /** Azimuth of the lean in the key's socket frame (degrees), meaningless at 0 tilt. */
  azimuthDeg: number
  /** Ball centre to the plate plane plus the ball's radius: what the long arm must reach. */
  reachMm: number
  /** What the chosen line still runs into (empty when clear), by name, mm^3. */
  blockedBy: Record<string, number>
  clear: boolean
  /** Directions tried before this one. */
  tried: number
}

/** The ball's centre and the unit direction of a key leaning `tilt` toward `azimuth`, half frame (from the socket out, down). */
export function keyDirection(socket: Matrix4, tiltDeg: number, azimuthDeg: number) {
  const t = (tiltDeg * Math.PI) / 180, a = (azimuthDeg * Math.PI) / 180
  const centre = new Vector3(ADJUSTER.at[0], ADJUSTER.at[1], ADJUSTER_BOTTOM + BALL_END.centreDepth).applyMatrix4(socket)
  const dir = new Vector3(Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a), -Math.cos(t)).transformDirection(socket)
  return { centre, dir }
}

/** The access line of a key leaning `tilt` toward `azimuth`: from the plate plane to where the key's axis crosses the socket's mouth plane. */
export function accessLine(socket: Matrix4, tiltDeg: number, azimuthDeg: number, plateTopZ: number): AccessLine & { reachMm: number } {
  const { centre, dir } = keyDirection(socket, tiltDeg, azimuthDeg)
  const mouth = centre.clone().addScaledVector(dir, BALL_END.centreDepth / Math.cos((tiltDeg * Math.PI) / 180))
  const s = (plateTopZ - mouth.z) / dir.z
  const plane = mouth.clone().addScaledVector(dir, s)
  const r6 = (v: Vector3) => v.toArray().map(x => Math.round(x * 1e6) / 1e6 || 0) as XYZ
  return { axis: [r6(plane), r6(mouth)], diameter: ACCESS.diameter, angleDeg: tiltDeg, reachMm: centre.distanceTo(plane) + BALL_END.ballRadius }
}

/**
 * A cylinder of `diameter` along a line from `top` down to `bottom`, run on
 * past `bottom` by its radius and cut off at the plane z = trimZ, so a leaning
 * line's end is flush with the plane.
 */
export function lineSolid(mf: ManifoldToplevel, top: XYZ, bottom: XYZ, diameter: number, trimZ: number): Manifold {
  const a = new Vector3(...top), b = new Vector3(...bottom)
  const w = b.clone().sub(a)
  const length = w.length()
  w.normalize()
  const u = Math.abs(w.z) < 0.9 ? new Vector3(0, 0, 1).cross(w).normalize() : new Vector3(1, 0, 0).cross(w).normalize()
  const v = w.clone().cross(u)
  const frame = new Matrix4().makeBasis(u, v, w).setPosition(a)
  const r = diameter / 2
  const c = mf.Manifold.cylinder(length + r, r, r, 48)
  const placed = c.transform(frame.elements as unknown as Mat4)
  const out = placed.trimByPlane([0, 0, 1], trimZ + 0.01)
  c.delete()
  placed.delete()
  return out
}

function overlap(a: Manifold, b: Manifold) {
  const i = a.intersect(b)
  const v = Math.max(0, i.volume())
  i.delete()
  return v
}

/** What a line runs into: obstacles by name with their overlap volumes above ACCESS_TOUCH_MM3. */
export function blockingVolumes(mf: ManifoldToplevel, line: AccessLine, plateTopZ: number, obstacles: [string, Manifold][]): Record<string, number> {
  const solid = lineSolid(mf, line.axis[1], line.axis[0], line.diameter, plateTopZ)
  const out: Record<string, number> = {}
  for (const [name, m] of obstacles) {
    const v = overlap(solid, m)
    if (v > ACCESS_TOUCH_MM3) out[name] = Math.round(v * 1000) / 1000
  }
  solid.delete()
  return out
}

/**
 * The best access line for one key. `socket` is its socket frame in the half
 * frame; `obstacles` are case, holder and the other keepers (local to the key
 * is enough). Returns the plan; `clear` is false when no direction in the cone
 * is clear, and the line is then the least-blocked one.
 */
export function planAccess(mf: ManifoldToplevel, id: string, socket: Matrix4, plateTopZ: number, obstacles: [string, Manifold][]): AccessPlan {
  let tried = 0
  let best: { tilt: number; az: number; volume: number; blocked: Record<string, number> } | null = null
  const longArm = HEX.key.longArm[0]
  for (let tilt = 0; tilt <= BALL_END.maxAngleDeg + 1e-9; tilt += SEARCH.tiltStepDeg) {
    const azimuths = tilt == 0 ? [0] : Array.from({ length: 360 / SEARCH.azimuthStepDeg }, (_, i) => i * SEARCH.azimuthStepDeg)
    const clear: boolean[] = []
    for (const az of azimuths) {
      tried++
      const line = accessLine(socket, tilt, az, plateTopZ)
      const blocked = line.reachMm <= longArm ? blockingVolumes(mf, line, plateTopZ, obstacles) : { reach: line.reachMm }
      const volume = Object.values(blocked).reduce((s, v) => s + v, 0)
      clear.push(volume == 0)
      if (!best || volume < best.volume) best = { tilt, az, volume, blocked }
    }
    if (clear.some(c => c)) {
      // The middle of the widest run of clear azimuths (the ring wraps round).
      const n = azimuths.length
      let bestRun = { start: 0, length: 0 }
      for (let i = 0; i < n; i++) {
        if (!clear[i] || (n > 1 && clear[(i - 1 + n) % n] && clear.some(c => !c))) continue
        let len = 0
        while (len < n && clear[(i + len) % n]) len++
        if (len > bestRun.length) bestRun = { start: i, length: len }
      }
      const az = n == 1 ? 0 : azimuths[(bestRun.start + Math.floor((bestRun.length - 1) / 2)) % n]
      const line = accessLine(socket, tilt, az, plateTopZ)
      return { id, ...line, azimuthDeg: az, blockedBy: {}, clear: true, tried }
    }
  }
  const line = accessLine(socket, best!.tilt, best!.az, plateTopZ)
  return { id, ...line, azimuthDeg: best!.az, blockedBy: best!.blocked, clear: false, tried }
}

export interface AccessHole {
  id: string
  /** The hole's axis, the key's access line (half frame), and its diameter. */
  axis: [XYZ, XYZ]
  diameter: number
  /** The parts it goes through, with the volume it removes from each (mm^3). */
  through: Record<string, number>
}

/**
 * Plan a key's access line, with a hole where the cone has no clear direction.
 * `fixed` must stay clear (case parts other than the walls, other keepers, the
 * MCU board); `holeable` may be cut (the walls, the holder); `forbidden` is
 * where no hole may go (the antenna's clearance, the USB recess, the battery
 * bay). The hole is the direction that cuts least, closest to the axis on a tie.
 */
export function planAccessWithHole(
  mf: ManifoldToplevel,
  id: string,
  socket: Matrix4,
  plateTopZ: number,
  fixed: [string, Manifold][],
  holeable: [string, Manifold][],
  forbidden: Manifold | null,
): { plan: AccessPlan; hole: AccessHole | null } {
  const plan = planAccess(mf, id, socket, plateTopZ, [...fixed, ...holeable])
  if (plan.clear) return { plan, hole: null }
  let best: { tilt: number; az: number; cut: number; through: Record<string, number> } | null = null
  for (let tilt = 0; tilt <= BALL_END.maxAngleDeg + 1e-9; tilt += SEARCH.tiltStepDeg) {
    for (const az of tilt == 0 ? [0] : Array.from({ length: 360 / SEARCH.azimuthStepDeg }, (_, i) => i * SEARCH.azimuthStepDeg)) {
      const line = accessLine(socket, tilt, az, plateTopZ)
      if (line.reachMm > HEX.key.longArm[0]) continue
      if (Object.keys(blockingVolumes(mf, line, plateTopZ, fixed)).length) continue
      const holeLine = { ...line, diameter: ACCESS_HOLE }
      if (forbidden && Object.keys(blockingVolumes(mf, holeLine, plateTopZ, [['forbidden', forbidden]])).length) continue
      const through = blockingVolumes(mf, holeLine, plateTopZ, holeable)
      const cut = Object.values(through).reduce((s, v) => s + v, 0)
      if (!best || cut < best.cut - 1e-6) best = { tilt, az, cut, through }
    }
  }
  if (!best) return { plan, hole: null }
  const line = accessLine(socket, best.tilt, best.az, plateTopZ)
  return {
    plan: { id, ...line, azimuthDeg: best.az, blockedBy: {}, clear: true, tried: plan.tried },
    hole: { id, axis: line.axis, diameter: ACCESS_HOLE, through: best.through },
  }
}

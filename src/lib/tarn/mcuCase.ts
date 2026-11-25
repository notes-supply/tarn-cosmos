/**
 * The tarn-mcu-v1 case features of mcu.ts as solids (replicad / OpenCascade),
 * applied to Cosmos's parts in the half frame: the holder is cut back around J3
 * and around the antenna, the bottom plate gets the antenna hole and the
 * battery cradle. Everything is built in the board frame and placed with the
 * microcontroller pose.
 */

import { drawRoundedRectangle, makeBox, type Shape3D } from 'replicad'
import type { Matrix4 } from 'three/src/math/Matrix4.js'
import { ANTENNA, BATTERY_BAY, BOARD, type Box, J3, J3_CLEARANCE, J3_STOPPER_TOP, J3_WIRE_RUN, layoutX, RF_CLEARANCE, RF_CUT_MARGIN } from './mcu'
import type { Side } from './spec'

const box = (b: Box) => makeBox(b.min, b.max)

/** Place a board-frame shape with the microcontroller pose: a turn about Z and a translation (Cosmos tilts no board). */
export function placeOnBoard(shape: Shape3D, pose: Matrix4): Shape3D {
  const e = pose.elements
  if (Math.abs(e[10] - 1) > 1e-6) throw new Error('the microcontroller pose is tilted; the Tarn MCU features only handle a turn about Z')
  const angle = (Math.atan2(e[1], e[0]) * 180) / Math.PI
  const turned = Math.abs(angle) > 1e-9 ? shape.rotate(angle, [0, 0, 0], [0, 0, 1]) : shape
  return turned.translate(e[12], e[13], e[14])
}

/**
 * The J3 relief, cut from the holder: the connector and mated-plug envelope
 * plus J3_CLEARANCE on every side but the board, run out J3_WIRE_RUN past the
 * board's front edge for the plug and its wires; below it the holder's front
 * stopper is cut down to J3_STOPPER_TOP. It also takes away the rail clamp at
 * the board's front-left corner, which the envelope reaches.
 */
export function j3Relief(): Shape3D {
  const c = J3_CLEARANCE
  const main = box({ min: [J3.min[0] - c, BOARD.min[1] - J3_WIRE_RUN, J3_STOPPER_TOP], max: [J3.max[0] + c, J3.max[1] + c, J3.max[2] + c] })
  const clamp = box({ min: [J3.min[0] - 3, BOARD.min[1] - 0.3, BOARD.max[2] + 0.05], max: [J3.min[0], BOARD.min[1] + 2, BOARD.max[2] + 2] })
  return main.fuse(clamp)
}

/**
 * The antenna volume: every point within RF_CLEARANCE (+ RF_CUT_MARGIN) of the
 * keep-out, rounded in plan, and taken straight up and down by the same
 * distance (which holds the 10 mm ball and a little more).
 */
export function antennaVolume(extra = RF_CUT_MARGIN): Shape3D {
  const r = RF_CLEARANCE + extra
  const [x0, y0, z0] = ANTENNA.min, [x1, y1, z1] = ANTENNA.max
  return drawRoundedRectangle(x1 - x0 + 2 * r, y1 - y0 + 2 * r, r)
    .translate((x0 + x1) / 2, (y0 + y1) / 2)
    .sketchOnPlane('XY', z0 - r)
    .extrude(z1 - z0 + 2 * r) as Shape3D
}

/** The battery cradle on a half (board frame), its walls sunk 0.5 mm into the plate so they fuse with it. */
export function batteryCradle(side: Side): Shape3D {
  const { walls, slot } = BATTERY_BAY.cradle
  let shape: Shape3D | null = null
  for (const w of walls) {
    const b = layoutX(side, w)
    const solid = box({ min: [b.min[0], b.min[1], b.min[2] - 0.5], max: b.max })
    shape = shape ? shape.fuse(solid) : solid
  }
  const s = layoutX(side, slot)
  return shape!.cut(box({ min: [s.min[0], s.min[1], s.min[2] - 0.01], max: s.max }))
}

export interface McuCaseParts {
  holder: Shape3D | null
  plate: Shape3D | null
}

/** Apply the features to a half's holder and plate (half frame); `pose` is the microcontroller pose. */
export function applyMcuFeatures(parts: McuCaseParts, pose: Matrix4, side: Side): McuCaseParts {
  const antenna = placeOnBoard(antennaVolume(), pose)
  const holder = parts.holder ? parts.holder.cut(placeOnBoard(j3Relief(), pose)).cut(antenna) : null
  const plate = parts.plate ? parts.plate.cut(antenna).fuse(placeOnBoard(batteryCradle(side), pose)) : null
  return { holder, plate }
}

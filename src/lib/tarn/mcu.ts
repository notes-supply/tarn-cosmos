/**
 * Tarn's MCU board, tarn-mcu-v1, in Cosmos's lemon-wireless holder (Tarn ADR
 * 0010), and the case features it needs:
 * - the J3 relief: the holder is cut back around the JST-PH battery connector
 *   and its mated plug, with room for the plug's wires to leave toward -Y;
 * - the antenna volume: no printed part, screw or battery within RF_CLEARANCE
 *   of the NINA-B306 antenna keep-out. The holder and the bottom plate are cut
 *   back; the case, the keepers and the screws must already keep clear (the
 *   screws through the lemon-wireless keepClear regions in Cosmos);
 * - the battery bay: a 502535 pouch cell standing on its long edge in the
 *   strip between the outer wall and the keywell, in a cradle on the bottom
 *   plate, which holds it when the plate is screwed on.
 * The USB-C overmold recess is a design setting (the USB opening in the
 * reference design's connectors, scripts/tarn-reference-design.ts).
 *
 * Frame: the board frame, i.e. the spec's microcontroller pose: origin at the
 * centre of the board's USB edge on its underside, +X right seen from above
 * with the USB edge at the top, +Y toward the USB edge, +Z out of the
 * component side. It is hardware/mcu/tarn-mcu-v1/interface.json's holder frame
 * (Tarn repo; numbers read, nothing else). The board is not mirrored on the
 * left half, so its features (J3, antenna) are on the same side of the board on
 * both halves, while the case is mirrored. Case-layout features (the battery
 * bay) are therefore given for a right half and mirrored in X on the left
 * (layoutX).
 *
 * Sources: interface.json [mcu-if]; the J3 envelope from Tarn
 * tools/src/tarn/mcu/models.py [jst-env] (JST PH SM4 catalogue: 7.9 wide incl.
 * tabs, 7.6 deep from the mating face, 5.5 high with a mated plug); u-blox
 * NINA-B3 data sheet UBX-17052099 R15 Table 28 [nina-ds] (module 10.0 x 15.0 x
 * 2.23 mm); u-blox NINA-B3 system integration manual UBX-17056748 R15 §3.3.3
 * [nina-sim] (NINA-B3x6 antenna: 10 mm to the casing even in plastic, and to
 * large or metal parts); SCE Battery Li-polymer catalogue [sce] (nominal pouch
 * sizes, thickness x width x length).
 */

import type { Side } from './spec'

type XYZ = [number, number, number]
export interface Box {
  min: XYZ
  max: XYZ
}

/** Board outline and PCB thickness [mcu-if frame.board_extent]. */
export const BOARD: Box = { min: [-14.95, -42, 0], max: [14.95, 0, 1.6] }
/** The holder seats the board's underside this far above the holder floor (the plate top) [mcu-if frame.holder]. */
export const SEAT_HEIGHT = 1.835

/** USB-C receptacle J1: front face centre and shell [mcu-if usb_c]. */
export const USB = { faceCentre: [6.0, 1.3, 3.23] as XYZ, shell: [8.94, 3.26] as [number, number] }
/**
 * USB-C cable overmolds the opening takes: up to 13 x 7.5 mm (the brief), which
 * covers the tested Same Sky CBL-40-UC-UC-1 at 12.35 x 6.5 mm (its drawing p. 2,
 * as Tarn tools/src/tarn/mcu/fit.py OVERMOLD_XZ). The opening is the reference
 * design's USB connector: OVERMOLD.max plus `margin` a side, corner radius 1,
 * centred on the receptacle face, through the rear wall (whose inner face is at
 * the receptacle face), so a plug seats fully.
 */
export const OVERMOLD = { max: [13, 7.5] as [number, number], tested: [12.35, 6.5] as [number, number], margin: 0.4 }

/** J3, JST S2B-PH-SM4-TB: housing, tabs and mated plug [jst-env], placed at its mating face (-10.4, -41.4, 1.6), facing -Y [mcu-if battery_connector]. */
export const J3: Box = { min: [-14.35, -41.4, 1.6], max: [-6.45, -33.8, 7.1] }
/** Clearance from the J3 envelope to the holder. */
export const J3_CLEARANCE = 0.5
/** The plug's wires leave the mating face toward -Y: the relief runs this far past the board's front edge. */
export const J3_WIRE_RUN = 12

/**
 * The assembled board as an obstacle for the adjusters' access lines (board
 * frame): the PCB with everything on it up to the USB shell's top (4.86
 * [mcu-if usb_c]) and the NINA module (3.83), J1 reaching 1.3 past the USB
 * edge, and J3 with its mated plug.
 */
export const BOARD_ENVELOPE: Box[] = [{ min: [BOARD.min[0], BOARD.min[1], 0], max: [BOARD.max[0], 1.3, 5.0] }, J3]

/** NINA-B306 antenna keep-out [mcu-if antenna_keepout], from the board top to the module top (1.6 + 2.23 [nina-ds]). */
export const ANTENNA: Box = { min: [11.75, -27, 1.6], max: [14.95, -19, 3.83] }
/** [nina-sim]: 10 mm to the casing, plastic included. */
export const RF_CLEARANCE = 10
/** The holder and the plate are cut back this much further than RF_CLEARANCE (meshing). */
export const RF_CUT_MARGIN = 0.25

/** Nominal pouch cells, thickness x width x length [sce]. */
export const CELLS = { '301230': [3, 12, 30], '402030': [4, 20, 30], '502535': [5, 25, 35], '603040': [6, 30, 40] } as const
export type CellName = keyof typeof CELLS
/**
 * The battery bay (right half; mirrored on the left with layoutX): a 502535
 * standing on its long edge in the strip between the outer wall and the first
 * key column, its thickness across the strip, its length along Y, in front of
 * the holder. Nothing of the keywell comes lower than 28 mm above the plate
 * there (measured on the reference design). The space it is given adds 1 mm to
 * the thickness (swelling and handling, unverified), 1 mm to the width (its
 * height here) and 2 mm to the length for the lead's exit, as Tarn
 * tools/src/tarn/mcu/battery_space.py pads its cells.
 *
 * The cradle is part of the bottom plate, so the plate holds the cell when it
 * is screwed on: an inner side wall along the keywell side with a slot for the
 * lead, an outer side wall where the case wall is more than a millimetre away,
 * and an end wall at -Y. At +Y the holder's front corner stops the cell; toward
 * the front the case wall curves in and closes the outer side.
 */
export const BATTERY_BAY = {
  cell: '502535' as CellName,
  /** The space for the cell (right half, board frame); z from the plate top. */
  space: { min: [-26.6, -88.6, -SEAT_HEIGHT], max: [-20.6, -51.9, -SEAT_HEIGHT + 26] } as Box,
  cradle: {
    height: 12,
    walls: [
      { min: [-20.6, -90.2, -SEAT_HEIGHT], max: [-19.0, -52.2, -SEAT_HEIGHT + 12] },
      { min: [-28.2, -82.0, -SEAT_HEIGHT], max: [-26.6, -52.2, -SEAT_HEIGHT + 12] },
      { min: [-25.6, -90.2, -SEAT_HEIGHT], max: [-19.0, -88.6, -SEAT_HEIGHT + 12] },
    ] as Box[],
    /** Through the inner side wall, at the +Y end. */
    slot: { min: [-21.0, -58.0, -SEAT_HEIGHT], max: [-18.6, -53.0, -SEAT_HEIGHT + 6.5] } as Box,
  },
}

/**
 * The lead's way from J3's plug to the cradle (board frame): out of the plug
 * toward -Y over the holder's front, then along X in front of the holder to the
 * slot in the cradle's inner side wall at its +Y end, on top of the holder's
 * floor and the plate. On the left half the bay is on the board's +X side, so
 * the lead passes in front of the harness connector J2 below LEAD_TOP; the
 * harness tail must stay above it there.
 */
export function leadPath(side: Side): Box[] {
  const slot = layoutX(side, BATTERY_BAY.cradle.slot)
  const [jx0, jx1] = [J3.min[0] + 1, J3.max[0] - 1]
  const [y0, y1] = [slot.min[1] + 0.5, slot.max[1] - 0.5]
  // Out of the slot (and 1 mm into the bay), then to J3's x, then up to the plug over the holder's cut-down stopper.
  const inner = side == 'right' ? slot.min[0] - 1 : slot.max[0] + 1
  return [
    { min: [Math.min(inner, jx0), y0, LEAD_FLOOR], max: [Math.max(inner, jx1), y1, LEAD_TOP] },
    { min: [jx0, y0, J3_STOPPER_TOP + 0.1], max: [jx1, J3.min[1], J3.min[2] + 3.4] },
  ]
}
/** The holder's front stopper is cut down to this height (board z) in the J3 relief. */
export const J3_STOPPER_TOP = J3.min[2] - J3_CLEARANCE
/** The lead runs on top of the holder's floor (board z 0) and the plate, below this. */
export const LEAD_FLOOR = 0.2
export const LEAD_TOP = 4.2

/** A right-half (layout) box on the given half: mirrored in X on the left, where the board is not. */
export function layoutX(side: Side, b: Box): Box {
  if (side == 'right') return b
  return { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] }
}

/** The battery bay's space on a half (board frame). */
export function batterySpace(side: Side): Box {
  return layoutX(side, BATTERY_BAY.space)
}

/** The cell itself, centred in its space with the lead's 2 mm at the +Y end (toward J3). */
export function cellBox(side: Side): Box {
  const s = batterySpace(side)
  const [t, w, l] = CELLS[BATTERY_BAY.cell]
  const cx = (s.min[0] + s.max[0]) / 2
  return { min: [cx - t / 2, s.min[1], s.min[2]], max: [cx + t / 2, s.min[1] + l, s.min[2] + w] }
}

export function grow(b: Box, d: number): Box {
  return { min: b.min.map(v => v - d) as XYZ, max: b.max.map(v => v + d) as XYZ }
}

/** Euclidean distance between two boxes (0 when they touch or overlap). */
export function boxGap(a: Box, b: Box) {
  return Math.hypot(...[0, 1, 2].map(i => Math.max(a.min[i] - b.max[i], 0, b.min[i] - a.max[i])))
}

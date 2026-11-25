/**
 * The Tarn Choc V2 socket (`choc-v2-tarn`): a switch plate that holds one
 * island of Tarn's flex harness, and the keeper that backs the island's
 * hotswap socket.
 *
 * Frame. Everything here is in the island frame: the switch frame of
 * harness.ts and spec.ts (origin at the centre of the plate top, +Z toward the
 * keycap) turned by switchRotation + 180 degrees about Z, i.e. pose ·
 * Rz(switchRotation + 180). This is the frame Tarn's harness generator draws
 * an island in (KiCad footprint frame, copper-side view, contacts at -y), so
 * the island outline below is tools/src/tarn/coupon.py CHOC_RECT['choc'] as it
 * stands and the socket outline is tools/src/tarn/kicad/footprints/choc.py's
 * courtyard (Tarn coordination repo; numbers read, no code copied).
 *
 * The island is off-centre: it reaches 10.1 mm toward -X and 6.75 toward +X.
 * The socket's footprint is offset to match (FOOTPRINT_RECT), and the socket
 * has two variants: 'Island West' (switchRotation 180, island frame = switch
 * frame) and 'Island East' (switchRotation 0: the socket, switch and island
 * turned 180 degrees). A mirrored left half gets the other variant, so the
 * island sits on the same side of the hand on both halves.
 *
 * Parts of the socket (one solid per variant, generated into
 * target/key-choc-v2-tarn-island-{west,east}.step by src/model_gen/parts.ts):
 * - the plate: a 19.6 x 19.9 frame offset toward the island, 1.2 mm clip
 *   ledge around a 14.05 mm cutout, with a 14.6 mm clip relief below it down
 *   to the housing bottom;
 *   its underside is the ledge the island's stiffener bears on (the clamp);
 * - posts that hang from the plate outside the island: W and P4 on the -Y
 *   side, P3a on the +Y side, each with blind windows in its +Y face for the
 *   keeper's tongues; P1, which stops the island toward +X; and P3b, a block
 *   over the keeper's tab with the hole its snap nub clicks into.
 * The pocket between them is open on all four sides for links.
 *
 * The keeper (a separate printed part, keepers.stl / keeper.stl) is the
 * backstop: a plate under the hotswap socket whose four tongues sit in the
 * windows. One slide toward -Y engages all four; a snap nub stops it sliding
 * back. No screws, no glue, no tools.
 *
 * Assembly (docs/research/cosmos-pipeline.md, "Tarn socket"):
 * 1. Bottom plate off, switches out, case upside down.
 * 2. Push each island into its pocket from below until its stiffener meets the
 *    ledge. Links leave through the open sides.
 * 3. Hold a keeper flat under the island, 0.75 mm toward +Y from its place,
 *    press it in until it meets P3b, and push it toward -Y until the nub
 *    clicks into P3b's hole: the tongues are now in the windows.
 * 4. Bottom plate on; switches in from the top.
 * To take a keeper out, lever the free end of its snap arm down with a small
 * screwdriver in the slot beside it, slide the keeper toward +Y and lower it.
 *
 * Load paths:
 * - Switch insertion pushes the hotswap socket away from the switch. The
 *   socket body bears on the keeper, whose tongues bear on the window floors;
 *   the posts hang from the plate. The solder joints carry nothing.
 * - Switch removal pulls the island toward the switch. Its stiffener meets the
 *   ledge after at most KEEPER_GAP of travel.
 */

import { draw, makeBox, makeCylinder, type Shape3D, type Solid } from 'replicad'

type XY = [number, number]
type XYZ = [number, number, number]
export interface Box3 {
  min: XYZ
  max: XYZ
}
/** An axis-aligned rectangle in the switch frame's XY plane: [xMin, yMin, xMax, yMax]. */
export type Rect = [number, number, number, number]

export const SOCKET_ID = 'choc-v2-tarn'

// ---------------------------------------------------------------------------
// Facts (sources: docs/research/switches.md and flex-pcb.md in the Tarn repo,
// ADR 0009, and the coupon generator for the island outline)

/** Plate top. The Choc flange seats here. */
export const PLATE_TOP = 0
/** Plate (clip ledge) thickness: Kailh's clip gap is 1.35 (+0/-0.10) [K-V2P], 1.65 on the 2019 drawing [K-V2R]; 1.2 suits all (switches.md §1.3, unverified). Cosmos's choc-v2 lip is 1.2 too. */
export const PLATE_THICKNESS = 1.2
/**
 * Switch cutout. Kailh's V2 bottom housing is 13.95 ± 0.05 [K-V2R], so the
 * cutout must be at least 14.0 (switches.md §1.3). 14.05 leaves 0.05 mm on the
 * largest housing; Cosmos's own choc-v2 lip is 13.9.
 */
export const CUTOUT = 14.05
/** Relief under the plate for the clips: 14.50 over the clips [K-V2R], plus 0.05 a side. */
export const CLIP_RELIEF = 14.6
/** Choc V1 and V2 housing bottom below the plate top [K-V2R], [K-V1R]. The island's stiffener sits here, against the switch and the ledge. */
export const HOUSING_BOTTOM = -2.2
/** Half the V2 bottom housing (13.95 [K-V2R]) plus margin: nothing of the socket rises to the housing bottom inside this. */
export const HOUSING_HALF = 7.1

/** ADR 0009: FR4 1.6 stiffener, 0.12 flex, Kailh CPG135001S30 base 1.80 ± 0.1 [K-S30]. */
export const STACK = { stiffener: 1.6, flex: 0.12, socketBase: 1.8 } as const
export const STIFFENER_TOP = HOUSING_BOTTOM
export const FLEX_TOP = STIFFENER_TOP - STACK.stiffener
export const SOCKET_TOP = FLEX_TOP - STACK.flex
export const SOCKET_BOTTOM = SOCKET_TOP - STACK.socketBase

/** The island outline (flex), coupon.py CHOC_RECT['choc']: about 16.85 x 11.68 mm. */
export const ISLAND: Rect = [-10.1, -8.4, 6.75, 3.275]
/**
 * The Kailh CPG135001S30 body outline (choc.py courtyard, from marbastlib;
 * switch frame). Polygon, clockwise. The terminals are the tabs at
 * x < -7.504 and x > 2.3; they lie on the flex.
 */
export const SOCKET_OUTLINE: XY[] = [
  [4.104, -4.975],
  [2.3, -4.975],
  [2.3, -4.425],
  [1.5, -3.625],
  [-0.3, -3.625],
  [-1.577, -3.167],
  [-2.455, -2.133],
  [-2.826, -1.656],
  [-3.4, -1.475],
  [-7.504, -1.475],
  [-7.504, -2.775],
  [-9.104, -2.775],
  [-9.104, -4.725],
  [-7.25, -4.725],
  [-7.25, -5.325],
  [-6.45, -6.125],
  [-3.45, -6.125],
  [-2.45, -7.125],
  [-2.45, -7.475],
  [-1.65, -8.275],
  [1.5, -8.275],
  [2.3, -7.475],
  [2.3, -6.925],
  [4.104, -6.925],
]
/** The two receptacles: the switch contacts, datasheet (0, 5.90) and (5.00, 3.80) turned 180 degrees (switches.md §1.4). */
export const CONTACTS: XY[] = [[0, -5.9], [-5, -3.8]]

/** Gap between the island and the pocket walls. */
export const ISLAND_CLEARANCE = 0.3
/**
 * Gap between the hotswap socket's underside and the keeper when the island
 * rests on the ledge. It covers the stack's tolerance: the RSS of FR4 ±0.16
 * (±10 %), socket base ±0.1 [K-S30] and flex is about ±0.19 (unverified as a
 * whole). With the island on the keeper, the switch pins reach 1.08 mm into
 * the socket base instead of 1.28 (1.40 on a 1.6 mm PCB).
 */
export const KEEPER_GAP = 0.2
export const KEEPER_TOP = SOCKET_BOTTOM - KEEPER_GAP
export const KEEPER_THICKNESS = 2.4
export const KEEPER_BOTTOM = KEEPER_TOP - KEEPER_THICKNESS
/** Tongues on the keeper's -Y edge, in the lower part of its thickness; `slide` is how far the keeper moves to engage them. */
export const TONGUE = { thickness: 1.2, depth: 0.7, play: 0.2, slide: 0.75 } as const
/** Windows in the posts: blind pockets in the +Y face. The floor carries the keeper; the ceiling rises at 45 degrees. */
export const WINDOW = { depth: 0.75, floor: KEEPER_BOTTOM, top: KEEPER_BOTTOM + TONGUE.thickness + TONGUE.play } as const
/** Post material below the window floors: a beam between the piers. */
export const POST_FOOT = 1.5
export const POST_BOTTOM = KEEPER_BOTTOM - POST_FOOT
/**
 * The keeper's snap: an arm along -X in the keeper's lower 0.6 mm (printed on
 * the bed, so it needs no support), with a nub that rises through the keeper
 * and clicks into a hole in P3b. It only stops the keeper sliding back toward
 * +Y; the tongues carry all the load.
 */
export const SNAP = { root: -4.6, tip: -9.9, y: [6.9, 8.0] as XY, gap: 0.3, thickness: 0.6, nub: { at: [-9.2, 7.45] as XY, diameter: 1.6, rise: 0.5 }, hole: { diameter: 2.2, depth: 0.6 } } as const
/** P3b's underside stands this far above the keeper so the keeper slides under it freely. */
export const TAB_CLEARANCE = 0.1

/**
 * Socket footprint in the island frame: [xMin, yMin, xMax, yMax]. It contains
 * the pocket and the posts, so Cosmos's web and walls never reach the island.
 * Toward +X and +Y it leaves a 1.0 and a 2.1 mm plate ring outside the clip
 * relief. Cosmos sees it as socketSize (its size) plus socketOffset (its centre).
 */
export const FOOTPRINT_RECT: Rect = [-10.4, -10.5, 9.2, 9.4]
export const FOOTPRINT: XY = [round(FOOTPRINT_RECT[2] - FOOTPRINT_RECT[0]), round(FOOTPRINT_RECT[3] - FOOTPRINT_RECT[1])]
export const FOOTPRINT_CENTRE: XY = [round((FOOTPRINT_RECT[0] + FOOTPRINT_RECT[2]) / 2), round((FOOTPRINT_RECT[1] + FOOTPRINT_RECT[3]) / 2)]
/** Frame depth (Cosmos socketSize z): the plate and the clip relief. Cosmos builds the web to this depth. */
export const FRAME_DEPTH = -HOUSING_BOTTOM
/** The variants, as Cosmos names them. 'Island East' turns the socket 180 degrees. */
export const VARIANTS = ['Island West', 'Island East'] as const

/** The pocket: the island outline plus its clearance. */
export const POCKET: Rect = [ISLAND[0] - ISLAND_CLEARANCE, ISLAND[1] - ISLAND_CLEARANCE, ISLAND[2] + ISLAND_CLEARANCE, ISLAND[3] + ISLAND_CLEARANCE]

export interface Post {
  rect: Rect
  bottom: number
  /** x ranges of the windows in the post's +Y face. */
  windows: [number, number][]
}
/**
 * The posts that hang from the plate:
 * - W, along the -Y edge from x = -1.5: the main backstop support, under the
 *   hotswap socket's receptacle block (switch contact at (0, -5.9)).
 * - P4, at (-X, -Y), on the other side of the -Y link exit.
 * - P3a, at (-X, +Y): the third support, and the island's +Y stop.
 * - P1, a stub on W at (+X, -Y) that stops the island toward +X.
 * - P3b, behind P3a, over the keeper's tab: carries the snap hole.
 */
const [FX0, FY0, FX1, FY1] = FOOTPRINT_RECT
export const POSTS: Record<'W' | 'P4' | 'P3a' | 'P1' | 'P3b', Post> = {
  W: { rect: [-1.5, FY0, FX1, POCKET[1]], bottom: POST_BOTTOM, windows: [[-0.5, 2.5], [4.0, 6.9]] },
  P4: { rect: [FX0, FY0, -6.0, POCKET[1]], bottom: POST_BOTTOM, windows: [[-9.7, -6.7]] },
  P3a: { rect: [FX0, POCKET[3] + 0.025, -5.4, 5.6], bottom: POST_BOTTOM, windows: [[-9.7, -6.1]] },
  P1: { rect: [POCKET[2], POCKET[1], FX1, -6.5], bottom: POST_BOTTOM, windows: [] },
  P3b: { rect: [FX0, 5.6, -5.4, FY1], bottom: KEEPER_TOP + TAB_CLEARANCE, windows: [] },
}

/**
 * Keeper outline in XY: the plate under the island (kept 0.95 mm clear of P3a
 * where it passes it, so it can go in 0.75 mm toward +Y), a bridge in the +Y
 * link exit, and the tab behind P3a.
 */
export const KEEPER_PARTS: Rect[] = [
  [-10.1, POCKET[1] + 0.2, 6.85, 2.65],
  [-5.2, 2.65, 6.85, 3.4],
  [-5.2, 3.4, -2.8, 8.9],
  [-10.1, 5.8, -5.2, 8.9],
]
/** Tongues (XY), protruding -Y into the windows, 0.2 mm shorter at each end than their window. */
export const KEEPER_TONGUES: Rect[] = [
  ...[...POSTS.W.windows, ...POSTS.P4.windows].map(([a, b]): Rect => [a + 0.2, KEEPER_PARTS[0][1] - TONGUE.depth, b - 0.2, KEEPER_PARTS[0][1]]),
  ...POSTS.P3a.windows.map(([a, b]): Rect => [a + 0.2, KEEPER_PARTS[3][1] - TONGUE.depth, b - 0.2, KEEPER_PARTS[3][1]]),
]
/**
 * Locating rim on the keeper's top face, just -X of the hotswap socket body
 * (whose -X face is at x = -7.504 for y in [-2.775, -1.475]): it stops the
 * island toward -X. W and P4 stop it toward -Y, P3 toward +Y and P1 toward +X,
 * each with ISLAND_CLEARANCE (the rim with 0.25 mm).
 */
export const KEEPER_RIM = { rect: [-8.45, -2.65, -7.75, -1.6] as Rect, height: 0.6 }

/** Cosmos partBottom depth: the floor must stay below the posts. */
export const PART_BOTTOM_DEPTH = round(-POST_BOTTOM + 0.5)

/** Design loads. */
export const LOADS = {
  /** Kailh CPG135001S30: mating force 3.0 kgf max [K-S30] (flex-pcb.md §2.7). */
  insertionN: 30,
  /**
   * Switch removal: the socket's unmating force is only given as a minimum
   * (200 gf [K-S30]). 10 N (about 1 kgf, 5x that minimum) is our sizing value
   * (unverified as a maximum).
   */
  removalN: 10,
} as const

function round(x: number, digits = 6) {
  const f = 10 ** digits
  return Math.round(x * f) / f || 0
}

// ---------------------------------------------------------------------------
// Derived facts for the spec, the checks and the tests

/** A prism in the switch frame: a polygon in XY between two heights. */
export interface Prism {
  name: string
  outline: XY[]
  zMin: number
  zMax: number
}

const rectOutline = ([x0, y0, x1, y1]: Rect): XY[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/** SOD-123 with its leads: 3.85 x 1.8 x 1.35 max (Diodes Inc. SOD-123 outline, unverified for the part JLC fits), at coupon.py CHOC_DIODE (3.45, -0.5) turned 90 degrees. */
export const DIODE: { rect: Rect; height: number } = { rect: [3.45 - 0.9, -0.5 - 1.925, 3.45 + 0.9, -0.5 + 1.925], height: 1.35 }

/**
 * The island with the ADR 0009 stack, as the checks see it: stiffener and flex
 * over the whole outline (the real stiffener is smaller), the hotswap socket
 * body, and the diode. Everything else on the copper side is copper.
 */
export function islandEnvelope(): Prism[] {
  return [
    { name: 'stiffener', outline: rectOutline(ISLAND), zMin: FLEX_TOP, zMax: STIFFENER_TOP },
    { name: 'flex', outline: rectOutline(ISLAND), zMin: SOCKET_TOP, zMax: FLEX_TOP },
    { name: 'hotswap socket', outline: SOCKET_OUTLINE, zMin: SOCKET_BOTTOM, zMax: SOCKET_TOP },
    { name: 'diode', outline: rectOutline(DIODE.rect), zMin: SOCKET_TOP - DIODE.height, zMax: SOCKET_TOP },
  ]
}

export function bounds(pts: XY[]): Rect {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export type EdgeSide = '-x' | '+x' | '-y' | '+y'
export interface LinkExit {
  /** Widest stretch of the island's edge with nothing beside it (x for the ±y sides, y for the ±x sides). */
  from: number
  to: number
  width: number
}
/**
 * Where links can leave the island on each side: the widest stretch of the
 * island's edge with no post between it and the footprint edge. The pocket is
 * open below, so a link can also turn down right after it leaves.
 */
export function linkExits(): Record<EdgeSide, LinkExit> {
  const posts = Object.values(POSTS).map(p => p.rect)
  const [x0, y0, x1, y1] = ISLAND
  const free = (lo: number, hi: number, blocked: [number, number][]): LinkExit => {
    let best = { from: lo, to: lo, width: 0 }
    let start = lo
    for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0]).concat([[hi, hi]])) {
      const end = Math.min(Math.max(a, lo), hi)
      if (end - start > best.width) best = { from: start, to: end, width: round(end - start) }
      start = Math.max(start, Math.min(b, hi))
    }
    return best
  }
  return {
    '-y': free(x0, x1, posts.filter(r => r[3] <= y0 && r[1] < y0).map(r => [r[0], r[2]])),
    '+y': free(x0, x1, posts.filter(r => r[1] >= y1 && r[3] > y1).map(r => [r[0], r[2]])),
    '-x': free(y0, y1, posts.filter(r => r[2] <= x0 && r[0] < x0).map(r => [r[1], r[3]])),
    '+x': free(y0, y1, posts.filter(r => r[0] >= x1 && r[2] > x1).map(r => [r[1], r[3]])),
  }
}

export interface Retainer {
  kind: string
  bearingZ: number
  region: Box3
  designLoadN: number
  part: string
}

/** Degrees about +Z from the island frame to a key's switch frame (0 for 'Island West', 180 for 'Island East'). */
export function islandTurn(switchRotation: number) {
  return (((switchRotation + 180) % 360) + 360) % 360
}

/** An island-frame box in a key's switch frame. Only quarter turns of 0 and 180 occur. */
export function boxToSwitchFrame(b: Box3, switchRotation: number): Box3 {
  const turn = islandTurn(switchRotation)
  if (turn == 0) return b
  if (turn == 180) return { min: [round(-b.max[0]), round(-b.max[1]), b.min[2]], max: [round(-b.min[0]), round(-b.min[1]), b.max[2]] }
  throw new Error(`no Tarn socket is turned ${turn} degrees`)
}

/** Spec retainers (tarnSpec 0.2 `backstop` and `clamp`) for a choc-v2-tarn key, in its switch frame. */
export function retainers(switchRotation: number): { backstop: Retainer; clamp: Retainer } {
  return {
    backstop: { kind: 'keeper', bearingZ: KEEPER_TOP, region: boxToSwitchFrame(keeperBounds(), switchRotation), designLoadN: LOADS.insertionN, part: 'keepersStl' },
    clamp: {
      kind: 'ledge',
      bearingZ: HOUSING_BOTTOM,
      region: boxToSwitchFrame({ min: [FX0, FY0, HOUSING_BOTTOM], max: [FX1, FY1, -PLATE_THICKNESS] }, switchRotation),
      designLoadN: LOADS.removalN,
      part: 'caseStl',
    },
  }
}

export function keeperBounds(): Box3 {
  const all = [...KEEPER_PARTS, ...KEEPER_TONGUES]
  return {
    min: [Math.min(...all.map(r => r[0])), Math.min(...all.map(r => r[1])), KEEPER_BOTTOM],
    max: [Math.max(...all.map(r => r[2])), Math.max(...all.map(r => r[3])), round(KEEPER_TOP + Math.max(KEEPER_RIM.height, SNAP.nub.rise))],
  }
}

/** The part of the ledge directly over the island: the plate ring outside the clip relief, inside the island outline. */
export function ledgeOverIsland(): Rect[] {
  const r = CLIP_RELIEF / 2
  const [x0, y0, x1, y1] = ISLAND
  return [
    [x0, y0, -r, y1], // -X strip
    [-r, y0, x1, -r], // -Y strip
  ].filter(q => q[2] > q[0] && q[3] > q[1]) as Rect[]
}

// ---------------------------------------------------------------------------
// Solids (replicad / OpenCascade)

const box = (r: Rect, z0: number, z1: number) => makeBox([r[0], r[1], z0], [r[2], r[3], z1])

/** A prism along X from x0 to x1 over a polygon in (y, z). */
function prismX(profile: XY[], x0: number, x1: number): Solid {
  let pen = draw(profile[0])
  for (const p of profile.slice(1)) pen = pen.lineTo(p)
  return pen.close().sketchOnPlane('YZ', x0).extrude(x1 - x0) as Solid
}

/**
 * A window cut into a post's +Y face at y = face, over x0..x1: a flat floor
 * at the keeper's underside, a flat back, and a ceiling that rises at 45
 * degrees to the face, so it prints without support at key tilts up to 45
 * degrees.
 */
function windowCut(face: number, x0: number, x1: number): Solid {
  const back = face - WINDOW.depth
  const outside = face + 0.5 // past the face so the cut is clean
  return prismX([[back, WINDOW.floor], [outside, WINDOW.floor], [outside, WINDOW.top + WINDOW.depth + 0.5], [face, WINDOW.top + WINDOW.depth], [back, WINDOW.top]], x0, x1)
}

/** The socket: plate with the switch cutout and clip relief, and the posts. */
export function socketSolid(): Shape3D {
  let shape: Shape3D = box(FOOTPRINT_RECT, HOUSING_BOTTOM, PLATE_TOP)
    .cut(box([-CUTOUT / 2, -CUTOUT / 2, CUTOUT / 2, CUTOUT / 2], HOUSING_BOTTOM - 1, PLATE_TOP + 1))
    .cut(box([-CLIP_RELIEF / 2, -CLIP_RELIEF / 2, CLIP_RELIEF / 2, CLIP_RELIEF / 2], HOUSING_BOTTOM - 1, -PLATE_THICKNESS))
  for (const post of Object.values(POSTS)) {
    // Under the switch housing the post stops 0.2 mm short of the housing bottom, so it can never lift the switch.
    const [x0, y0, x1, y1] = post.rect
    let solid: Shape3D = box(post.rect, post.bottom, HOUSING_BOTTOM - 0.2)
    const outside: Rect[] = [[x0, y0, Math.min(x1, -HOUSING_HALF), y1], [Math.max(x0, HOUSING_HALF), y0, x1, y1], [x0, y0, x1, Math.min(y1, -HOUSING_HALF)], [x0, Math.max(y0, HOUSING_HALF), x1, y1]]
    for (const r of outside) if (r[2] > r[0] && r[3] > r[1]) solid = solid.fuse(box(r, HOUSING_BOTTOM - 0.3, HOUSING_BOTTOM))
    for (const [a, b] of post.windows) solid = solid.cut(windowCut(y1, a, b))
    shape = shape.fuse(solid)
  }
  const [hx, hy] = SNAP.nub.at
  const holeBottom = POSTS.P3b.bottom
  shape = shape.cut(makeCylinder(SNAP.hole.diameter / 2, SNAP.hole.depth + 0.5, [hx, hy, holeBottom - 0.5], [0, 0, 1]))
  return shape.simplify()
}

/**
 * The keeper, in its installed place (switch frame). Without the nub it is
 * the keeper as it slides in, with the snap arm pressed down by P3b.
 */
export function keeperSolid(withNub = true): Shape3D {
  let shape: Shape3D = box(KEEPER_PARTS[0], KEEPER_BOTTOM, KEEPER_TOP)
  for (const r of KEEPER_PARTS.slice(1)) shape = shape.fuse(box(r, KEEPER_BOTTOM, KEEPER_TOP))
  for (const r of KEEPER_TONGUES) shape = shape.fuse(box(r, KEEPER_BOTTOM, KEEPER_BOTTOM + TONGUE.thickness))
  shape = shape.fuse(box(KEEPER_RIM.rect, KEEPER_TOP - 0.01, KEEPER_TOP + KEEPER_RIM.height))
  // The snap: a U-shaped slot through the keeper around the arm, which keeps only its lower SNAP.thickness.
  const [y0, y1] = SNAP.y
  shape = shape.cut(box([SNAP.tip - 0.5, y0 - SNAP.gap, SNAP.root, y1 + SNAP.gap], KEEPER_BOTTOM - 1, KEEPER_TOP + 1))
  shape = shape.fuse(box([SNAP.tip, y0, SNAP.root + 0.05, y1], KEEPER_BOTTOM, KEEPER_BOTTOM + SNAP.thickness))
  const [nx, ny] = SNAP.nub.at
  const nubTop = withNub ? KEEPER_TOP + SNAP.nub.rise : KEEPER_TOP
  shape = shape.fuse(makeCylinder(SNAP.nub.diameter / 2, nubTop - KEEPER_BOTTOM - SNAP.thickness + 0.01, [nx, ny, KEEPER_BOTTOM + SNAP.thickness - 0.01], [0, 0, 1]))
  return shape.simplify()
}

/** The keeper for printing: underside on the bed (z = 0), the rim on top. */
export function keeperPrintSolid(): Shape3D {
  return keeperSolid().translate([0, 0, -KEEPER_BOTTOM])
}

/** The island envelope as solids (for renders and the tests). */
export function islandSolids(): { name: string; shape: Shape3D }[] {
  return islandEnvelope().map(p => {
    let pen = draw(p.outline[0])
    for (const q of p.outline.slice(1)) pen = pen.lineTo(q)
    return { name: p.name, shape: pen.close().sketchOnPlane('XY', p.zMin).extrude(p.zMax - p.zMin) as Shape3D }
  })
}

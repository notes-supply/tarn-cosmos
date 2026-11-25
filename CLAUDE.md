# Cosmos Keyboards — Agent Notes

Web-based generator for ergonomic mechanical keyboards. SvelteKit + TypeScript on top of a heavy CAD/3D pipeline (Three.js + Threlte for rendering, replicad/OpenCascade + Manifold for solids, OpenSCAD for keycaps, MediaPipe for hand scanning).

The user-facing app lives at `/beta` (`src/routes/beta`). Most of the interesting logic is in `src/lib/worker/`, which runs in a Web Worker bridged via `comlink`.

## Toolchain

- **Bun is preferred, Node is the fallback.** The `Makefile` detects `bun` and uses it; otherwise it uses `node` with a custom ESM loader (`src/model_gen/register_loader.js`). When in doubt, use Bun — Node mode is harder to debug.
- **Python venv** is used only for docs (`mkdocs`). Created by `make venv`.
- **`.nvmrc`** pins Node v21+. Use that if running without Bun.

## Build flow

```bash
make quickstart        # one-time: install deps, compile protobufs, generate parts/keycaps geometry
make dev               # start vite dev server → http://localhost:5173/beta
npm run check          # svelte-check + tsc — the closest thing to a CI signal locally
npm test               # runs `bun test` against *.test.ts files
make build             # regenerates target/proto/*.ts and target/editorDeclarations.d.ts
```

The default `make` target only regenerates protobufs and editor types. `make quickstart` is heavier — it also runs `parts`, `parts-simple`, `keycaps2`, `keycaps-simple2` which produce GLB/STEP files in `target/`.

## Layout

| Path                                      | Role                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/beta/`                        | The generator UI (the `/beta` page).                                                                                                                                              |
| `src/routes/scan/`, `scan2/`              | Hand-scanning UI; processing in `src/routes/scan/lib/hand.ts`.                                                                                                                    |
| `src/lib/worker/`                         | Worker-side CAD code. The hot files are `geometry.ts`, `cachedGeometry.ts`, `model.ts`, `config.ts`.                                                                              |
| `src/lib/3d/`                             | Threlte components (rendering).                                                                                                                                                   |
| `src/lib/loaders/`, `src/lib/runner/`     | Asset loading and worker bootstrap.                                                                                                                                               |
| `src/proto/`                              | `.proto` schemas — source of truth for serialized configs.                                                                                                                        |
| `src/model_gen/`                          | Build-time scripts that produce `target/` artifacts (keycaps, switches, microcontrollers, parts). Not run at app runtime.                                                         |
| `target/`                                 | **Generated.** Don't hand-edit. Includes `target/proto/*.ts` (compiled protos), GLB/STEP assets, editor type declarations.                                                        |
| `pro/`                                    | Pro-only features. **Gitignored — usually not present in this clone.** Code in `src/lib/worker/pro-patch/` references it conditionally; don't try to "fix" missing imports there. |
| `docs/docs/`                              | mkdocs source for the public docs site.                                                                                                                                           |
| `target/PseudoProfiles/`, `target/KeyV2/` | Cloned third-party repos (keycap profiles).                                                                                                                                       |

## Rendering pipeline (the part you'll edit most)

Three files, in order:

1. **`src/lib/worker/geometry.ts`** (≈2,500 lines) — pure geometry: where every key, web, and screw goes in 3D space. No solid modeling.
2. **`src/lib/worker/cachedGeometry.ts`** — memoized higher-level wrapper over `geometry.ts`.
3. **`src/lib/worker/model.ts`** (≈1,200 lines) — turns geometry into actual solids via replicad/OpenCascade.

If a change affects how the keyboard _looks_, it almost always lands in one of these three. The split is intentional: `geometry.ts` should stay free of CAD operations.

## Config and serialization

- The schema lives in `src/proto/cosmos.proto` (and the older `cuttleform.proto`, `manuform.proto`, `lightcycle.proto`). After editing a `.proto`, run `make build` to regenerate `target/proto/*.ts`.
- TypeScript-side model: `src/lib/worker/config.ts` and `config.cosmos.ts`. Serialization helpers in `config.serialize.ts`.
- Editor autocompletion types are generated from `config.ts` into `target/editorDeclarations.d.ts` by `src/model_gen/genEditorTypes.ts`.

## Tests

The tests use **`bun:test`** (not vitest) and live next to the code as `*.test.ts` (15 files, including the geometry and model manifold checks in `src/lib/worker/` and the firmware generators in `src/routes/beta/lib/firmware/`). Run them with `npm test` (which calls `bun test`). `src/lib/tarn/solids.test.ts`, `socket.test.ts` and `mcu.test.ts` load OpenCascade and build case halves, so the suite takes about 80 s.

`npm run check` (svelte-check + tsc) only type-checks what the root `tsconfig.json` includes plus what those files import, so add new standalone entry points to its `include` list.

## Tarn headless export

`src/scripts/tarn-export.ts` exports a design without a browser: `spec.json` (Tarn spec 0.3: key, microcontroller, connector and screw poses, per key the switch rotation, the harness seat and, at Tarn sockets, the island placement, and per half the reserved regions and battery), case STEP per half (separate named solids) and STL (fused into one manifold with Manifold), switch and keycap STLs, fixed-view PNG renders, Cosmos's own design checks and the harness-stack check. Run `bun src/scripts/tarn-export.ts '<cosmos url or hash>' <outdir>` (add `--spec-only` to skip the CAD kernel). The code is in `src/lib/tarn/`; frame conventions are documented at the top of `src/lib/tarn/spec.ts`, and the switch datasheet frame and harness facts at the top of `src/lib/tarn/harness.ts`. `src/lib/tarn/seat.ts` measures the room under each switch against the fused case and checks the Tarn keepers. `src/scripts/tarn-set-socket.ts` prints a design URL with every switch socket replaced, e.g. to make the Choc V2 version of a layout.

## Tarn socket (`choc-v2-tarn`)

`src/lib/tarn/socket.ts` is the single source of the Tarn Choc V2 socket: the plate, the printed spacer under the switch housing (Tarn ADR 0011: it stands in for a PCB, with a PCB's holes; its underside is the island's reference surface and clamp), the posts that hold the flex-harness island (steel 0.3 + flex 0.12), the keeper (a separate printed part under the island), the adjuster (a printed thumbscrew in the keeper, set before any switch goes in, that holds the island against the spacer), the island envelope, the pin engagement, the spec `backstop`/`clamp` and the spec 0.3 `island` fields. Its geometry is in the socket frame, pose · Rz(switchRotation + 180); the spec 0.3 island frame is pose · Rz(switchRotation) · T(0, 0, −3.4), the spacer's underside. The adjuster's thread is Manifold (a twisted extrusion), so the keeper and adjuster STLs are Manifold meshes and there is no keeper STEP. `src/model_gen/parts.ts` writes both variant STEPs (`Island West`, `Island East` = turned 180°) on every `make parts`. The `choc-v2-tarn` entry in `socketsParts.ts` repeats its footprint numbers (`socket.test.ts` checks they match). Two Cosmos changes support it: `socketOffset` (a footprint not centred on the switch, applied in `keyCriticalPoints`; flipped for `CuttleBaseKey.mirrored` left-half keys) and `mirrorCluster` swapping the Tarn variant, so a mirrored half keeps the island on the same side of the hand. `strength.ts` is the backstop's hand calculation; `closeup.ts` renders one socket in section. `src/scripts/tarn-reference-design.ts` prints the Tarn reference design link and lists every change from Cosmos's default layout.

`make parts` only rebuilds a generated file when it is missing (outside Vercel the git-change test is always taken), except the Tarn socket, which is always rebuilt.

## Tarn MCU board (`lemon-wireless` outline)

`src/lib/tarn/mcu.ts` holds the facts of Tarn's MCU board (tarn-mcu-v1, numbers from the Tarn repo's `hardware/mcu/tarn-mcu-v1/interface.json`) and the case features it needs: the J3 relief and the antenna cut in the holder, the antenna hole and the battery cradle in the bottom plate (`mcuCase.ts`, applied in `buildCaseParts` in the board frame, i.e. the spec's microcontroller pose), and the battery bay and lead in the spec's `reserved`. The board is not mirrored on the left half while the case is, so board features keep their side and case-layout features (the bay) are mirrored (`layoutX`). Three Cosmos changes support it: `BOARD_PROPERTIES[...].keepClear` regions (the antenna, which follows the board, and the battery bay, which follows the layout) that no screw boss may come near (`clearOfBoardKeepouts`, used for both the holder's screws and the wall screws in `cachedGeometry.ts`); `PART_INFO[...].accessFromBelow`, which keeps screw bosses out from under Tarn sockets so the keepers can go in; and the reference design's USB opening and `verticalClearance`. `mcu.test.ts` checks them on the reference design.

`fuseShapes` welds the rare edge where two parts of a union only touch (`weldPinchedEdges`, a 0.02 mm rod), which `separatePinches` cannot part; `export.json` reports `weldedEdges`. Cosmos's screw bosses are trimmed flush to the wall's inner surface, so a boss only touches its wall and can come out of the fused STL as a separate solid; the export warns when a fused case has more than one component. OpenCascade is loaded once per process (`setup` in `src/model_gen/node-model.ts`), since Cosmos's part cache holds shapes of the instance that made them.

## Formatting

`dprint` is configured in `dprint.json` and runs on commit via `simple-git-hooks` + `lint-staged`. The Claude `PostToolUse` hook in `.claude/settings.json` formats edited files automatically — match this if you script around it.

Quote style: **single quotes, no semicolons** (TS) — see `dprint.json`.

## Things that will trip you up

- `src/lib/opencv.js` and `src/lib/opencv-contrib.js` are **generated by Vite plugins** in `vite.config.ts`. Don't edit them.
- `target/` and `pro/` look like source but are not.
- The Vite dev server proxies `/docs`, `/blog`, etc. to `localhost:8000` (mkdocs). Those routes look broken until you also start `make docs`.
- `src/routes/lemon` is gitignored — references to it from other files are intentional.
- Imports of `pro-patch/*` modules are conditional and may be stubbed in OSS clones.
- The `tsconfig.json` only includes `src/routes/**/*` directly; the rest is pulled in by SvelteKit's generated `.svelte-kit/tsconfig.json`. So `tsc` invoked outside SvelteKit's wrapper will look like nothing is type-checked — use `npm run check` instead.

## Conventions

- Don't add new top-level dependencies casually — the build is already heavy. Prefer reusing what's there (`replicad`, `manifold-3d`, `three`, `comlink`).
- Don't write to `target/` directly. If you need a new generated artifact, add a script under `src/model_gen/` and a target in the `Makefile`.
- Worker code (`src/lib/worker/`) cannot use DOM APIs. Keep main-thread vs. worker code separate.

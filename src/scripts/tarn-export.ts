#!/usr/bin/env bun
/**
 * Headless export of a Cosmos design for Tarn.
 *
 *   bun src/scripts/tarn-export.ts <design> <outdir> [options]
 *
 * <design> is a Cosmos URL (https://ryanis.cool/cosmos/beta#cm:...), its hash
 * part (cm:..., with or without '#'), or a file containing either.
 *
 * Writes <outdir>/spec.json (tarnSpec 0.1) and, per half, <outdir>/<side>/:
 *   case.step, case.stl      walls + web + switch holders + screw attachments
 *   plate.step, plate.stl    bottom plate
 *   holder.step, holder.stl  microcontroller holder (when the design has one)
 *   assembly.step            every case part as a named assembly (what Cosmos's STEP download holds)
 *   switches.stl, keycaps.stl  Cosmos's switch and keycap models at rest, in position
 *   render-{top,front,iso}.png
 * plus <outdir>/export.json with timings, warnings and Cosmos's own design checks.
 *
 * Exit status: 0 on success, 1 on failure, 2 on bad arguments, 3 when the
 * outputs were written but Cosmos reports errors (e.g. colliding keycaps).
 *
 * Options:
 *   --spec-only            only write spec.json (no CAD kernel needed)
 *   --no-renders           skip the PNG renders
 *   --tolerance <mm>       STL chordal tolerance (default 0.01, as Cosmos's STL download)
 *   --angular <deg>        STL angular tolerance (default 1, as Cosmos's STL download)
 *   --side left|right      only export solids for one half (the spec always has both)
 */

import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

interface Options {
  design: string
  outDir: string
  specOnly: boolean
  renders: boolean
  tolerance: number
  angular: number
  sides: ('left' | 'right')[]
}

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`)
  console.error('usage: bun src/scripts/tarn-export.ts <design-url|hash|file> <outdir> [--spec-only] [--no-renders] [--tolerance mm] [--angular deg] [--side left|right]')
  process.exit(2)
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = []
  const opts = { specOnly: false, renders: true, tolerance: 0.01, angular: 1, sides: ['left', 'right'] as Options['sides'] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      if (i + 1 >= argv.length) usage(`${a} needs a value`)
      return argv[++i]
    }
    if (a == '--spec-only') opts.specOnly = true
    else if (a == '--no-renders') opts.renders = false
    else if (a == '--tolerance') opts.tolerance = Number(value())
    else if (a == '--angular') opts.angular = Number(value())
    else if (a == '--side') {
      const s = value()
      if (s != 'left' && s != 'right') usage('--side must be left or right')
      opts.sides = [s]
    } else if (a == '-h' || a == '--help') usage()
    else if (a.startsWith('--')) usage(`unknown option ${a}`)
    else positional.push(a)
  }
  if (positional.length != 2) usage('expected a design and an output directory')
  if (!(opts.tolerance > 0) || !(opts.angular > 0)) usage('tolerances must be positive numbers')
  let design = positional[0]
  if (existsSync(design) && statSync(design).isFile()) design = readFileSync(design, 'utf-8').trim()
  return { design, outDir: resolve(positional[1]), ...opts }
}

function gitCommit(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf-8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO, encoding: 'utf-8' }).trim() != ''
    return dirty ? sha + '-dirty' : sha
  } catch {
    return null
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (resolve(process.cwd()) != REPO) {
    // Bun takes the TypeScript settings (Cosmos needs experimentalDecorators) and Cosmos's
    // loaders take asset paths (target/, src/assets/) from the working directory, so run
    // from the repository root.
    const flags = process.argv.slice(2).filter((a, i, all) => a.startsWith('--') || (i > 0 && ['--tolerance', '--angular', '--side'].includes(all[i - 1])))
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), opts.design, opts.outDir, ...flags], { cwd: REPO, stdio: 'inherit' })
    process.exit(child.status ?? 1)
  }
  const t0 = performance.now()
  const timings: Record<string, any> = {}
  const warnings: string[] = []

  const { buildSpec, keyIds } = await import('$lib/tarn/spec')
  const { spec, cosmos, contexts } = buildSpec(opts.design, gitCommit())
  timings.specMs = Math.round(performance.now() - t0)
  mkdirSync(opts.outDir, { recursive: true })
  const specPath = join(opts.outDir, 'spec.json')
  const writeSpec = () => writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n')
  writeSpec()
  for (const h of spec.halves) console.log(`${h.side}: ${h.keys.length} keys, ${h.screws.length} screws, microcontroller ${h.microcontroller?.type ?? 'none'}`)
  console.log(`wrote ${specPath} (${timings.specMs} ms)`)

  // Cosmos's own error and warning checks (what the app shows in red/yellow).
  const tChecks = performance.now()
  const { cosmosChecks } = await import('$lib/tarn/checks')
  const checks = Object.fromEntries(contexts.map(ctx => [ctx.side, cosmosChecks(ctx, keyIds(cosmos, ctx.conf, ctx.side))]))
  timings.cosmosChecksMs = Math.round(performance.now() - tChecks)
  for (const [side, results] of Object.entries(checks)) {
    const errors = results.filter(r => r.severity == 'error').length
    console.log(`${side}: Cosmos checks: ${errors} errors, ${results.length - errors} warnings`)
    for (const r of results) console.log(`  ${r.severity}: ${r.message}`)
  }

  if (!opts.specOnly) {
    const tSetup = performance.now()
    const { setup } = await import('../model_gen/node-model')
    await setup()
    timings.openCascadeSetupMs = Math.round(performance.now() - tSetup)
    const solids = await import('$lib/tarn/solids')
    const { render, VIEWS } = await import('$lib/tarn/render')
    const meshOpts = { tolerance: opts.tolerance, angularTolerance: opts.angular }

    for (const ctx of contexts) {
      if (!opts.sides.includes(ctx.side)) continue
      const half = spec.halves.find(h => h.side == ctx.side)!
      const dir = join(opts.outDir, ctx.side)
      mkdirSync(dir, { recursive: true })
      const t: Record<string, number> = {}
      timings[ctx.side] = t
      const tHalf = performance.now()
      const out = (key: string, file: string, data: Uint8Array) => {
        writeFileSync(join(dir, file), data)
        half.outputs[key] = relative(opts.outDir, join(dir, file))
      }
      const step = (data: Uint8Array) => stampSTEP(data, opts.design)
      const timed = async <T>(label: string, f: () => T | Promise<T>) => {
        const s = performance.now()
        const r = await f()
        t[label] = Math.round(performance.now() - s)
        return r
      }

      const parts = await solids.buildCaseParts(ctx, t)
      const all = [...parts.body, ...(parts.plate ? [{ name: 'Bottom Plate', shape: parts.plate }] : []), ...(parts.holder ? [{ name: 'Microcontroller Holder', shape: parts.holder }] : [])]
      await timed('stepFiles', async () => {
        out('assemblyStep', 'assembly.step', step(await solids.stepFile(all)))
        out('caseStep', 'case.step', step(await solids.stepFile(parts.body)))
        if (parts.plate) out('plateStep', 'plate.step', step(await solids.stepFile([{ name: 'Bottom Plate', shape: parts.plate }])))
        if (parts.holder) out('holderStep', 'holder.step', step(await solids.stepFile([{ name: 'Microcontroller Holder', shape: parts.holder }])))
      })

      const meshes = await timed('meshing', () => ({
        body: solids.mergeMeshes(parts.body.map(p => solids.shapeMesh(p.shape, meshOpts))),
        plate: parts.plate ? solids.shapeMesh(parts.plate, meshOpts) : null,
        holder: parts.holder ? solids.shapeMesh(parts.holder, meshOpts) : null,
      }))
      const placed = await timed('switchesAndKeycaps', () => solids.switchAndKeycapMeshes(ctx))
      warnings.push(...placed.missing.map(m => `${ctx.side}: no ${m}`))
      await timed('stlFiles', () => {
        out('caseStl', 'case.stl', solids.binarySTL(meshes.body))
        if (meshes.plate) out('plateStl', 'plate.stl', solids.binarySTL(meshes.plate))
        if (meshes.holder) out('holderStl', 'holder.stl', solids.binarySTL(meshes.holder))
        if (placed.switches.indices.length) out('switchesStl', 'switches.stl', solids.binarySTL(placed.switches))
        if (placed.keycaps.indices.length) out('keycapsStl', 'keycaps.stl', solids.binarySTL(placed.keycaps))
      })
      for (const [name, m] of Object.entries({ case: meshes.body, plate: meshes.plate, holder: meshes.holder })) {
        if (m && solids.signedVolume(m) <= 0) warnings.push(`${ctx.side}: ${name} mesh has non-positive signed volume (inside-out triangles?)`)
      }

      if (opts.renders) {
        await timed('renders', () => {
          const items = [
            { mesh: meshes.body, color: [150, 170, 200] as [number, number, number] },
            ...(meshes.plate ? [{ mesh: meshes.plate, color: [110, 120, 140] as [number, number, number] }] : []),
            ...(meshes.holder ? [{ mesh: meshes.holder, color: [120, 180, 120] as [number, number, number] }] : []),
            { mesh: placed.switches, color: [90, 90, 100] as [number, number, number] },
            { mesh: placed.keycaps, color: [235, 230, 220] as [number, number, number] },
          ]
          const iso = ctx.side == 'left' ? VIEWS.isoLeft : VIEWS.isoRight
          out('renderTop', 'render-top.png', render(items, VIEWS.top))
          out('renderFront', 'render-front.png', render(items, VIEWS.front))
          out('renderIso', 'render-iso.png', render(items, iso))
        })
      }
      t.totalMs = Math.round(performance.now() - tHalf)
      console.log(`${ctx.side}: solids written to ${dir} (${(t.totalMs / 1000).toFixed(1)} s)`)
      writeSpec()
    }
  }

  timings.totalMs = Math.round(performance.now() - t0)
  writeFileSync(
    join(opts.outDir, 'export.json'),
    JSON.stringify({ design: opts.design, commit: spec.source.commit, options: { ...opts, design: undefined, outDir: undefined }, timings, warnings, cosmosChecks: checks }, null, 2) + '\n',
  )
  for (const w of warnings) console.warn(`warning: ${w}`)
  console.log(`done in ${(timings.totalMs / 1000).toFixed(1)} s`)
  if (Object.values(checks).some(results => results.some(r => r.severity == 'error'))) {
    console.error('Cosmos reports errors for this design (see cosmosChecks in export.json); the outputs were still written.')
    process.exitCode = 3
  }
}

/** Put the design reference into the STEP header, as Cosmos's download dialog does. */
function stampSTEP(data: Uint8Array, design: string): Uint8Array {
  const text = new TextDecoder().decode(data)
  const replaced = text
    .replace("FILE_DESCRIPTION(('Open CASCADE Model')", "FILE_DESCRIPTION(('Cosmos Model via tarn-cosmos')")
    .replace("FILE_NAME('Open CASCADE Shape Model'", `FILE_NAME('${design.replace(/'/g, "''")}'`)
  return new TextEncoder().encode(replaced)
}

main().catch(e => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})

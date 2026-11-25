#!/usr/bin/env bun
/**
 * Headless export of a Cosmos design for Tarn.
 *
 *   bun src/scripts/tarn-export.ts <design> <outdir> [options]
 *
 * <design> is a Cosmos URL (https://ryanis.cool/cosmos/beta#cm:...), its hash
 * part (cm:..., with or without '#'), or a file containing either.
 *
 * Writes <outdir>/spec.json (tarnSpec 0.2) and, per half, <outdir>/<side>/:
 *   case.step                walls + web + switch holders + screw attachments, as separate named solids
 *   case.stl                 the same parts fused into one manifold solid
 *   plate.step, plate.stl    bottom plate
 *   holder.step, holder.stl  microcontroller holder (when the design has one)
 *   assembly.step            every case part as a named assembly (what Cosmos's STEP download holds)
 *   switches.stl, keycaps.stl  Cosmos's switch and keycap models at rest, in position
 *   render-{top,front,iso}.png
 * plus <outdir>/export.json with timings, warnings, Cosmos's own design checks,
 * the fused-solid statistics, the harness seat check and the retention report.
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

  // Spec 0.2 declares a socket backstop and an island clamp per key (ADR 0006 item 7). This
  // exporter does not build them yet, so report every switch key that lacks them.
  const switchKeys = spec.halves.flatMap(h => h.keys.filter(k => k.switch != 'other'))
  const retention = Object.fromEntries((['backstop', 'clamp'] as const).map(kind => {
    const missing = switchKeys.filter(k => !k[kind]).map(k => k.id)
    return [kind, { declared: switchKeys.length - missing.length, missing }]
  }))
  for (const [kind, r] of Object.entries(retention)) {
    if (r.missing.length) warnings.push(`${kind}: missing on ${r.missing.length} of ${switchKeys.length} switch keys (ADR 0006 item 7; not built yet)`)
  }
  const unrotated = switchKeys.filter(k => k.switchRotation == null).map(k => k.id)
  if (unrotated.length) warnings.push(`switchRotation unknown for ${unrotated.length} keys (switch model orientation not measured): ${unrotated.slice(0, 5).join(', ')}`)
  const fused: Record<string, any> = {}
  const harnessSeat: Record<string, any> = {}
  const rotationCheck: Record<string, { checked: number; landed: number; worstOffsetMm: number; misses: string[] }> = {}

  if (!opts.specOnly) {
    const tSetup = performance.now()
    const { setup } = await import('../model_gen/node-model')
    await setup()
    timings.openCascadeSetupMs = Math.round(performance.now() - tSetup)
    const solids = await import('$lib/tarn/solids')
    const { measureSeats, poseMatrix } = await import('$lib/tarn/seat')
    const { matchContacts, switchFacts } = await import('$lib/tarn/harness')
    const { isSpecKey } = await import('$lib/tarn/spec')
    const { render, VIEWS } = await import('$lib/tarn/render')
    const meshOpts = { tolerance: opts.tolerance, angularTolerance: opts.angular }
    const mf = await solids.manifoldKernel()

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

      // Each part's solids fused into one manifold (Manifold union); the STEP files keep them apart.
      const fuse = await timed('fuse', () => ({
        body: solids.fuseShapes(mf, parts.body.map(p => p.shape), meshOpts),
        plate: parts.plate ? solids.fuseShapes(mf, [parts.plate], meshOpts) : null,
        holder: parts.holder ? solids.fuseShapes(mf, [parts.holder], meshOpts) : null,
      }))
      fused[ctx.side] = Object.fromEntries(
        Object.entries({ case: fuse.body, plate: fuse.plate, holder: fuse.holder }).filter(([, f]) => f).map(([name, f]) => [name, {
          solids: f!.solids,
          components: f!.components,
          volumeMm3: Math.round(f!.volume * 1000) / 1000,
          genus: f!.genus,
          voidsFilled: f!.voidsFilled,
          voidVolumeMm3: Math.round(f!.voidVolume * 1e6) / 1e6,
          ms: f!.ms,
        }]),
      )
      for (const [name, f] of Object.entries(fused[ctx.side]) as [string, any][]) {
        if (f.components != 1) warnings.push(`${ctx.side}: fused ${name} has ${f.components} components, not 1`)
      }
      const meshes = { body: fuse.body.mesh, plate: fuse.plate?.mesh ?? null, holder: fuse.holder?.mesh ?? null }

      // Harness seats: the clear box under every switch, and the planned stack against the case.
      const obstacles = mf.Manifold.union([fuse.body.manifold, ...(fuse.plate ? [fuse.plate.manifold] : []), ...(fuse.holder ? [fuse.holder.manifold] : [])])
      const seats = await timed('harnessSeat', () => measureSeats(mf, ctx, half, obstacles))
      obstacles.delete()
      for (const f of [fuse.body, fuse.plate, fuse.holder]) f?.manifold.delete()
      harnessSeat[ctx.side] = seats
      for (const [t, n] of Object.entries(seats.fits)) {
        const onPlate = seats.fitsWithStiffenerOnPlate[t]
        console.log(`${ctx.side}: harness stack with a ${t} mm stiffener fits under ${n} of ${seats.keys.length} switches (${onPlate} with the stiffener cut back to the plate)`)
        if (n < seats.keys.length) warnings.push(`${ctx.side}: the planned harness stack (${t} mm stiffener) does not fit under ${seats.keys.length - n} switches (harnessSeat in export.json)`)
      }

      const placed = await timed('switchesAndKeycaps', () => solids.switchAndKeycapMeshes(ctx))
      warnings.push(...placed.missing.map(m => `${ctx.side}: no ${m}`))

      // switchRotation self-check: the datasheet contacts, turned by switchRotation, land on the pins of the switch model written to switches.stl.
      rotationCheck[ctx.side] = await timed('switchRotationCheck', async () => {
        const confIndex = ctx.conf.keys.flatMap((k, i) => (isSpecKey(k) ? [i] : []))
        const result = { checked: 0, landed: 0, worstOffsetMm: 0, misses: [] as string[] }
        for (const [n, key] of half.keys.entries()) {
          const facts = switchFacts(key.switch)
          if (!facts || key.switchRotation == null) continue
          const mesh = await solids.switchMesh(ctx, confIndex[n]).catch(() => null)
          if (!mesh) continue
          const matches = matchContacts(solids.inFrame(mesh, poseMatrix(key.pose)), facts, key.switchRotation)
          result.checked++
          if (matches.every(m => m.lands)) result.landed++
          else result.misses.push(key.id)
          for (const m of matches) result.worstOffsetMm = Math.max(result.worstOffsetMm, Math.round((m.found?.offsetMm ?? Infinity) * 1000) / 1000)
        }
        return result
      })
      if (rotationCheck[ctx.side].misses.length) {
        warnings.push(`${ctx.side}: switchRotation does not put the datasheet contacts on the switch model's pins for ${rotationCheck[ctx.side].misses.join(', ')}`)
      }
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
    JSON.stringify(
      {
        design: opts.design,
        commit: spec.source.commit,
        options: { ...opts, design: undefined, outDir: undefined },
        timings,
        warnings,
        cosmosChecks: checks,
        fused,
        switchRotationCheck: rotationCheck,
        harnessSeat,
        retention,
      },
      null,
      2,
    ) + '\n',
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

/**
 * Cosmos's own design checks, run headless: the configuration checks and the
 * keycap, part and socket intersection checks the Cosmos app shows as errors
 * and warnings (same steps as `intersections` in src/lib/worker/api.ts).
 */

import { ITriangle, TriType } from '$lib/loaders/simplekeys'
import { checkConfig, type ConfError, isWarningError, keycapIntersections, partIntersections, socketIntersections } from '$lib/worker/check'
import type { HalfContext } from './spec'

export interface CosmosCheckResult {
  severity: 'error' | 'warning'
  type: ConfError['type']
  message: string
  keys?: string[]
}

export function cosmosChecks(ctx: HalfContext, ids: string[]): CosmosCheckResult[] {
  const { conf, geo, side } = ctx
  const errors: ConfError[] = [...checkConfig(conf, geo, true, side)]
  if (!errors.length) {
    try {
      const trsfs = geo.keyHolesTrsfs
      const { botReinf, topReinf } = geo.reinforcedTriangles
      const toTriangles = (r: typeof botReinf) =>
        r.triangles.map(([a, b, c]) => new ITriangle(r.allPts[a].origin(), r.allPts[b].origin(), r.allPts[c].origin(), TriType.WEB, -1))
      const web = [...toTriangles(topReinf), ...toTriangles(botReinf)]
      errors.push(...keycapIntersections(conf, trsfs, web, side))
      errors.push(...partIntersections(conf, trsfs, side))
      errors.push(...socketIntersections(conf, trsfs, geo.allKeyCriticalPoints, web, side))
    } catch (e) {
      errors.push({ type: 'exception', when: 'checking intersections', error: e as Error, side })
    }
  }
  const name = (i: number) => (i >= 0 ? ids[i] ?? `key ${i}` : 'case wall/web')
  return errors.map(e => {
    const severity = isWarningError(e) ? 'warning' : 'error'
    switch (e.type) {
      case 'intersection':
        return { severity, type: e.type, message: `${e.what} intersection: ${name(e.i)} with ${name(e.j)}`, keys: [e.i, e.j].filter(i => i >= 0).map(name) }
      case 'samePosition':
        return { severity, type: e.type, message: `${name(e.i)} and ${name(e.j)} are in the same place`, keys: [name(e.i), name(e.j)] }
      case 'wallBounds':
        return { severity, type: e.type, message: `${name(e.i)} sticks out of the walls`, keys: [name(e.i)] }
      case 'exception':
        return { severity, type: e.type, message: `exception while ${e.when}: ${e.error?.message}` }
      default:
        return { severity, type: e.type, message: JSON.stringify(e, (k, v) => (k == 'key' || k == 'side' ? undefined : v)) }
    }
  })
}

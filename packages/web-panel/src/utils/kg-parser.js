/**
 * kg-parser.js — Pure parsing helpers for `cc kg` CLI output.
 *
 * All commands ship `--json`, so the JSON path is the happy path.
 * Text fallbacks are intentionally minimal — they exist only to keep
 * the page from going blank when a future CLI change drops a flag.
 */

function tryParseJson(output) {
  if (!output) return null
  const trimmed = output.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/(\[[\s\S]*\]|\{[\s\S]*\})/)
    if (!match) return null
    try { return JSON.parse(match[1]) } catch { return null }
  }
}

function normalizeEntity(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || raw.entity_id || ''
  if (!id) return null
  const tags = Array.isArray(raw.tags)
    ? raw.tags
    : typeof raw.tags === 'string' && raw.tags.length > 0
      ? raw.tags.split(',').map(t => t.trim()).filter(Boolean)
      : []
  return {
    key: id,
    id,
    name: raw.name || '',
    type: raw.type || '',
    tags,
    properties: raw.properties && typeof raw.properties === 'object' ? raw.properties : null,
    createdAt: raw.created_at || raw.createdAt || '',
    updatedAt: raw.updated_at || raw.updatedAt || '',
    _idx: idx,
  }
}

function normalizeRelation(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || raw.relation_id || ''
  if (!id) return null
  const sourceId = raw.sourceId || raw.source_id || ''
  const targetId = raw.targetId || raw.target_id || ''
  if (!sourceId || !targetId) return null
  const weight = typeof raw.weight === 'number'
    ? raw.weight
    : typeof raw.weight === 'string'
      ? parseFloat(raw.weight)
      : 1.0
  return {
    key: id,
    id,
    sourceId,
    targetId,
    relationType: raw.relationType || raw.relation_type || '',
    weight: Number.isFinite(weight) ? weight : 1.0,
    properties: raw.properties && typeof raw.properties === 'object' ? raw.properties : null,
    createdAt: raw.created_at || raw.createdAt || '',
    _idx: idx,
  }
}

/**
 * Parse output of `cc kg list --json`. Returns an array of normalized entities.
 */
export function parseEntities(output) {
  const parsed = tryParseJson(output)
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeEntity).filter(Boolean)
  }
  if (parsed && Array.isArray(parsed.entities)) {
    return parsed.entities.map(normalizeEntity).filter(Boolean)
  }
  return []
}

/**
 * Parse output of `cc kg relations --json`. Returns an array of normalized relations.
 */
export function parseRelations(output) {
  const parsed = tryParseJson(output)
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeRelation).filter(Boolean)
  }
  if (parsed && Array.isArray(parsed.relations)) {
    return parsed.relations.map(normalizeRelation).filter(Boolean)
  }
  return []
}

/**
 * Parse output of `cc kg stats --json`. Returns a normalized stats object
 * (zero-filled when the underlying graph is empty).
 */
export function parseStats(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      entityCount: 0,
      relationCount: 0,
      avgDegree: 0,
      density: 0,
      typeDistribution: {},
      relationTypeDistribution: {},
    }
  }
  const numOrZero = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return {
    entityCount: numOrZero(parsed.entityCount ?? parsed.entity_count),
    relationCount: numOrZero(parsed.relationCount ?? parsed.relation_count),
    avgDegree: numOrZero(parsed.avgDegree ?? parsed.avg_degree),
    density: numOrZero(parsed.density),
    typeDistribution: parsed.typeDistribution || parsed.type_distribution || {},
    relationTypeDistribution: parsed.relationTypeDistribution || parsed.relation_type_distribution || {},
  }
}

/**
 * Parse output of `cc kg reason <start-id> --json`. Returns an array of
 * { depth, entity } reach records.
 */
export function parseReason(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((r, idx) => {
      if (!r || typeof r !== 'object' || !r.entity) return null
      const entity = normalizeEntity(r.entity, idx)
      if (!entity) return null
      return {
        key: `${entity.id}-${idx}`,
        depth: typeof r.depth === 'number' ? r.depth : 0,
        entity,
      }
    })
    .filter(Boolean)
}

/**
 * Parse output of `cc kg entity-types --json`. Returns an array of
 * { name, description } entries (used as a select dropdown source).
 */
export function parseEntityTypes(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed
    .map(t => {
      if (!t || typeof t !== 'object' || !t.name) return null
      return { name: String(t.name), description: String(t.description || '') }
    })
    .filter(Boolean)
}

/**
 * Build ECharts force-directed graph data from entities and relations.
 * Returns { nodes, links, categories } where categories index maps to entity types.
 */
export function buildGraphData(entities, relations) {
  const typeIndex = new Map()
  const categories = []

  for (const e of entities) {
    if (!typeIndex.has(e.type)) {
      typeIndex.set(e.type, categories.length)
      categories.push({ name: e.type || 'unknown' })
    }
  }

  const nodes = entities.map(e => ({
    id: e.id,
    name: e.name || e.id.slice(0, 8),
    category: typeIndex.get(e.type) ?? 0,
    value: 1,
    symbolSize: 24,
  }))

  const idSet = new Set(entities.map(e => e.id))
  const links = []
  for (const r of relations) {
    if (!idSet.has(r.sourceId) || !idSet.has(r.targetId)) continue
    links.push({
      source: r.sourceId,
      target: r.targetId,
      value: r.relationType,
      lineStyle: { width: Math.max(1, Math.min(6, r.weight * 2)) },
    })
  }

  return { nodes, links, categories }
}

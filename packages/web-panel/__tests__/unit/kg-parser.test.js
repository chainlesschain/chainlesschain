/**
 * Unit tests for src/utils/kg-parser.js
 *
 * Run: npx vitest run __tests__/unit/kg-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseEntities,
  parseRelations,
  parseStats,
  parseReason,
  parseEntityTypes,
  buildGraphData,
} from '../../src/utils/kg-parser.js'

// ─── parseEntities ────────────────────────────────────────────────────────────

describe('parseEntities', () => {
  it('returns empty array for empty input', () => {
    expect(parseEntities('')).toEqual([])
  })

  it('returns empty array for non-JSON garbage', () => {
    expect(parseEntities('error: db locked')).toEqual([])
  })

  it('parses a JSON array of entities', () => {
    const json = JSON.stringify([
      { id: 'e1', name: 'Alice', type: 'Person', tags: ['friend'], properties: { age: 30 } },
      { id: 'e2', name: 'OpenAI', type: 'Organization' },
    ])
    const list = parseEntities(json)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('e1')
    expect(list[0].name).toBe('Alice')
    expect(list[0].type).toBe('Person')
    expect(list[0].tags).toEqual(['friend'])
    expect(list[0].properties).toEqual({ age: 30 })
    expect(list[1].properties).toBeNull()
  })

  it('coerces a comma-separated tag string into an array', () => {
    const json = JSON.stringify([{ id: 'e1', name: 'A', type: 'X', tags: 'a, b, c' }])
    const [item] = parseEntities(json)
    expect(item.tags).toEqual(['a', 'b', 'c'])
  })

  it('handles a wrapper object with `entities` field', () => {
    const json = JSON.stringify({ entities: [{ id: 'e1', name: 'A', type: 'X' }] })
    const list = parseEntities(json)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('e1')
  })

  it('skips entries without an id', () => {
    const json = JSON.stringify([{ name: 'orphan' }, { id: 'ok', name: 'A', type: 'X' }])
    const list = parseEntities(json)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('ok')
  })

  it('extracts JSON embedded in surrounding text', () => {
    const out = `Loaded:\n[{"id":"x","name":"X","type":"Y"}]\nDone.`
    const list = parseEntities(out)
    expect(list).toHaveLength(1)
  })
})

// ─── parseRelations ───────────────────────────────────────────────────────────

describe('parseRelations', () => {
  it('returns empty array for empty input', () => {
    expect(parseRelations('')).toEqual([])
  })

  it('parses relations with weight as number', () => {
    const json = JSON.stringify([
      { id: 'r1', sourceId: 'a', targetId: 'b', relationType: 'knows', weight: 0.8 },
    ])
    const [rel] = parseRelations(json)
    expect(rel.id).toBe('r1')
    expect(rel.sourceId).toBe('a')
    expect(rel.targetId).toBe('b')
    expect(rel.relationType).toBe('knows')
    expect(rel.weight).toBe(0.8)
  })

  it('handles snake_case fields', () => {
    const json = JSON.stringify([
      { id: 'r1', source_id: 'a', target_id: 'b', relation_type: 'has', weight: '1.5' },
    ])
    const [rel] = parseRelations(json)
    expect(rel.sourceId).toBe('a')
    expect(rel.targetId).toBe('b')
    expect(rel.relationType).toBe('has')
    expect(rel.weight).toBe(1.5)
  })

  it('defaults weight to 1.0 when missing or invalid', () => {
    const json = JSON.stringify([
      { id: 'r1', sourceId: 'a', targetId: 'b', relationType: 't' },
      { id: 'r2', sourceId: 'a', targetId: 'b', relationType: 't', weight: 'NaN' },
    ])
    const list = parseRelations(json)
    expect(list[0].weight).toBe(1.0)
    expect(list[1].weight).toBe(1.0)
  })

  it('skips relations missing src/target', () => {
    const json = JSON.stringify([
      { id: 'r1', sourceId: 'a', relationType: 't' },
      { id: 'r2', sourceId: 'a', targetId: 'b', relationType: 't' },
    ])
    expect(parseRelations(json)).toHaveLength(1)
  })
})

// ─── parseStats ───────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns zero-filled object for empty input', () => {
    const s = parseStats('')
    expect(s.entityCount).toBe(0)
    expect(s.relationCount).toBe(0)
    expect(s.avgDegree).toBe(0)
    expect(s.density).toBe(0)
    expect(s.typeDistribution).toEqual({})
    expect(s.relationTypeDistribution).toEqual({})
  })

  it('parses full stats JSON', () => {
    const json = JSON.stringify({
      entityCount: 5,
      relationCount: 3,
      avgDegree: 1.2,
      density: 0.15,
      typeDistribution: { Person: 2, Project: 3 },
      relationTypeDistribution: { knows: 2, owns: 1 },
    })
    const s = parseStats(json)
    expect(s.entityCount).toBe(5)
    expect(s.relationCount).toBe(3)
    expect(s.avgDegree).toBe(1.2)
    expect(s.density).toBe(0.15)
    expect(s.typeDistribution.Person).toBe(2)
    expect(s.relationTypeDistribution.knows).toBe(2)
  })

  it('handles snake_case fields', () => {
    const json = JSON.stringify({
      entity_count: 4,
      relation_count: 2,
      avg_degree: 1,
      density: 0.5,
      type_distribution: { X: 4 },
      relation_type_distribution: { y: 2 },
    })
    const s = parseStats(json)
    expect(s.entityCount).toBe(4)
    expect(s.typeDistribution.X).toBe(4)
  })

  it('returns zero-filled when JSON is an array', () => {
    expect(parseStats('[1,2,3]').entityCount).toBe(0)
  })
})

// ─── parseReason ──────────────────────────────────────────────────────────────

describe('parseReason', () => {
  it('returns empty array for empty input', () => {
    expect(parseReason('')).toEqual([])
  })

  it('parses BFS reach records', () => {
    const json = JSON.stringify([
      { depth: 1, entity: { id: 'b', name: 'Bob', type: 'Person' } },
      { depth: 2, entity: { id: 'c', name: 'Carol', type: 'Person' } },
    ])
    const list = parseReason(json)
    expect(list).toHaveLength(2)
    expect(list[0].depth).toBe(1)
    expect(list[0].entity.id).toBe('b')
    expect(list[0].entity.name).toBe('Bob')
  })

  it('skips entries without entity', () => {
    const json = JSON.stringify([
      { depth: 1 },
      { depth: 2, entity: { id: 'c', name: 'C', type: 'X' } },
    ])
    expect(parseReason(json)).toHaveLength(1)
  })
})

// ─── parseEntityTypes ─────────────────────────────────────────────────────────

describe('parseEntityTypes', () => {
  it('returns empty array for empty input', () => {
    expect(parseEntityTypes('')).toEqual([])
  })

  it('parses entity type catalog', () => {
    const json = JSON.stringify([
      { name: 'Person', description: '人物' },
      { name: 'Organization', description: '组织' },
    ])
    const list = parseEntityTypes(json)
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({ name: 'Person', description: '人物' })
  })

  it('skips entries without a name', () => {
    const json = JSON.stringify([{ description: 'orphan' }, { name: 'OK' }])
    const list = parseEntityTypes(json)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('OK')
  })
})

// ─── buildGraphData ───────────────────────────────────────────────────────────

describe('buildGraphData', () => {
  it('returns empty graph for empty inputs', () => {
    const g = buildGraphData([], [])
    expect(g.nodes).toEqual([])
    expect(g.links).toEqual([])
    expect(g.categories).toEqual([])
  })

  it('builds nodes with category index per entity type', () => {
    const entities = [
      { id: 'a', name: 'A', type: 'Person' },
      { id: 'b', name: 'B', type: 'Person' },
      { id: 'c', name: 'C', type: 'Project' },
    ]
    const g = buildGraphData(entities, [])
    expect(g.categories).toEqual([{ name: 'Person' }, { name: 'Project' }])
    expect(g.nodes[0].category).toBe(0)
    expect(g.nodes[1].category).toBe(0)
    expect(g.nodes[2].category).toBe(1)
  })

  it('uses entity name as label when available, falls back to id slice', () => {
    const entities = [
      { id: 'long-id-12345', name: 'Alice', type: 'P' },
      { id: 'no-name-uuid', name: '', type: 'P' },
    ]
    const g = buildGraphData(entities, [])
    expect(g.nodes[0].name).toBe('Alice')
    expect(g.nodes[1].name).toBe('no-name-')
  })

  it('drops links whose endpoints are not in the entity set', () => {
    const entities = [{ id: 'a', name: 'A', type: 'P' }]
    const relations = [
      { id: 'r1', sourceId: 'a', targetId: 'ghost', relationType: 'knows', weight: 1 },
      { id: 'r2', sourceId: 'a', targetId: 'a', relationType: 'self', weight: 1 },
    ]
    const g = buildGraphData(entities, relations)
    expect(g.links).toHaveLength(1)
    expect(g.links[0].source).toBe('a')
    expect(g.links[0].target).toBe('a')
  })

  it('clamps relation weight into [1,6] for line width', () => {
    const entities = [
      { id: 'a', name: 'A', type: 'P' },
      { id: 'b', name: 'B', type: 'P' },
    ]
    const relations = [
      { id: 'r1', sourceId: 'a', targetId: 'b', relationType: 't', weight: 0.1 },
      { id: 'r2', sourceId: 'a', targetId: 'b', relationType: 't', weight: 100 },
    ]
    const g = buildGraphData(entities, relations)
    expect(g.links[0].lineStyle.width).toBeGreaterThanOrEqual(1)
    expect(g.links[1].lineStyle.width).toBeLessThanOrEqual(6)
  })
})

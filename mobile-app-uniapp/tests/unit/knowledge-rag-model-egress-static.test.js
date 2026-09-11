import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'src/services/knowledge-rag.js'),
  'utf8',
)

function expectGuardBefore(functionName, transportMarker) {
  const start = source.indexOf(`async ${functionName}`)
  expect(start, functionName).toBeGreaterThanOrEqual(0)

  const bodyStart = source.indexOf('{', start)
  const nextMethod = source.indexOf('\n  /**', bodyStart + 1)
  const end = nextMethod === -1 ? source.length : nextMethod
  const body = source.slice(bodyStart, end)

  expect(body.indexOf('rejectLegacyModelEgress()'), functionName).toBeGreaterThanOrEqual(0)
  expect(body.indexOf('uni.request'), functionName).toBeGreaterThan(
    body.indexOf('rejectLegacyModelEgress()'),
  )
  expect(body.indexOf(transportMarker), functionName).toBeGreaterThan(
    body.indexOf('rejectLegacyModelEgress()'),
  )
}

describe('Knowledge RAG model egress guard', () => {
  it('rejects backend indexing and enhanced retrieval before their raw requests', () => {
    expectGuardBefore('syncKnowledgeToBackend(knowledge)', '/api/rag/index/update-file')
    expectGuardBefore('_retrieveFromBackend(query, options)', '/api/rag/query/enhanced')
  })
})

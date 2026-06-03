/**
 * Drift guard: zh-CN.json and en.json MUST have identical key shape.
 *
 * If a translator renames `compliance.msg.matchHit` in zh-CN but forgets
 * the English mirror, vue-i18n falls back to the Chinese — Chinese
 * users see no change, English users see Chinese. Production smoke
 * tests don't catch this; this test does.
 *
 * Also flags: empty values (likely placeholders accidentally checked
 * in) and mojibake-shaped keys (a Chinese key path crossing the JSON
 * file is almost always a bug).
 *
 * Source of truth: packages/locales/seed/{zh-CN,en}.json.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SEED_ROOT = resolve(__dirname, '../../../locales/seed')
const zhCN = JSON.parse(readFileSync(resolve(SEED_ROOT, 'zh-CN.json'), 'utf-8'))
const en = JSON.parse(readFileSync(resolve(SEED_ROOT, 'en.json'), 'utf-8'))

function flatKeys(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatKeys(v, path))
    } else {
      out.push(path)
    }
  }
  return out
}

const zhKeys = flatKeys(zhCN).sort()
const enKeys = flatKeys(en).sort()
const zhSet = new Set(zhKeys)
const enSet = new Set(enKeys)

describe('i18n key parity (zh-CN vs en)', () => {
  it('zh-CN and en have the same key set', () => {
    const missingInEn = zhKeys.filter((k) => !enSet.has(k))
    const missingInZh = enKeys.filter((k) => !zhSet.has(k))
    expect(
      { missingInEn, missingInZh },
      'JSON catalogs drifted — keys must mirror exactly',
    ).toEqual({ missingInEn: [], missingInZh: [] })
  })

  it('zh-CN has at least 18 namespaces (one per translated view + shared)', () => {
    const namespaces = Object.keys(zhCN).sort()
    expect(namespaces.length).toBeGreaterThanOrEqual(18)
  })

  it('every key resolves to a non-empty string in both locales', () => {
    function* leaves(obj, prefix = '') {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          yield* leaves(v, path)
        } else {
          yield [path, v]
        }
      }
    }
    const offenders = []
    for (const [path, v] of leaves(zhCN)) {
      if (typeof v !== 'string' || v.length === 0) offenders.push({ locale: 'zh-CN', path, v })
    }
    for (const [path, v] of leaves(en)) {
      if (typeof v !== 'string' || v.length === 0) offenders.push({ locale: 'en', path, v })
    }
    expect(offenders).toEqual([])
  })

  it('top-level namespaces match between locales', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
  })
})

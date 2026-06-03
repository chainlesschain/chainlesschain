/**
 * Guard rail: no stray locale catalogs inside web-panel/src/.
 *
 * The single source of truth for i18n strings is packages/locales/seed/
 * (M1 of the i18n migration). If a future contributor adds
 * src/locales/zh-CN.json (or any *.json under a directory ending in
 * /locales/), this test fails — surfacing the drift before the catalog
 * forks again.
 *
 * The README in @chainlesschain/locales promises this enforcement;
 * this is the enforcement.
 */

import { describe, it, expect } from 'vitest'
import { glob } from 'glob'
import { resolve } from 'node:path'

const SRC_ROOT = resolve(__dirname, '../../src')

describe('no stray locale catalogs', () => {
  it('does not contain any *.json under a /locales/ directory', async () => {
    const matches = await glob('**/locales/*.json', { cwd: SRC_ROOT })
    expect(
      matches,
      `Found locale JSON files under web-panel/src/. Move them into ` +
        `packages/locales/seed/ — see the @chainlesschain/locales README.`,
    ).toEqual([])
  })

  it('does not contain a top-level src/locales directory', async () => {
    const dirs = await glob('locales', { cwd: SRC_ROOT })
    expect(
      dirs,
      `web-panel/src/locales/ should not exist — the catalog lives in ` +
        `packages/locales/seed/.`,
    ).toEqual([])
  })
})

#!/usr/bin/env node
/**
 * i18n extraction report (M2 of the i18n migration plan).
 *
 * Wraps vue-i18n-extract's createI18NReport(): scans consumer source
 * trees for $t('...') / t('...') / i18n.global.t(...) call sites,
 * compares them to the seed JSONs in this package, and prints:
 *
 *   - Missing keys: referenced in code but absent from the catalog
 *     (these break the UI — fallback to the key string itself).
 *   - Unused keys: present in the catalog but never referenced
 *     (dead translations bloating the bundle).
 *   - Maybe-dynamic keys: built from variables (`t(\`pipeline.${x}\`)`)
 *     where the static analyzer can't fully resolve — these are
 *     advisory; they may or may not be used.
 *
 * Exit codes:
 *   0 — no missing keys (catalog covers all referenced strings)
 *   1 — at least one missing key (catalog drifted)
 *
 * Run from anywhere:
 *   npm --prefix packages/locales run extract
 *   # or:
 *   node packages/locales/scripts/extract.js
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import VueI18NExtract from 'vue-i18n-extract'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..')

// Consumer trees — extend this list when a new front-end adopts the
// shared catalog. Each entry is a glob relative to the repo root.
const CONSUMERS = [
  { name: 'web-panel', vueGlob: 'packages/web-panel/src/**/*.{js,vue}' },
  // desktop-app-vue is not yet wired to @chainlesschain/locales; the
  // entry will go live once src/main.js / renderer wires `useLocale()`.
  // { name: 'desktop-app-vue', vueGlob: 'desktop-app-vue/src/renderer/**/*.{ts,vue}' },
]

async function main() {
  const reports = []
  let totalMissing = 0

  for (const c of CONSUMERS) {
    const absGlob = resolve(REPO_ROOT, c.vueGlob)
    const report = await VueI18NExtract.createI18NReport({
      vueFiles: absGlob,
      languageFiles: resolve(PACKAGE_ROOT, 'seed/*.json'),
      output: false,
    })
    reports.push({ consumer: c.name, ...report })
    totalMissing += report.missingKeys.length
  }

  for (const r of reports) {
    printReport(r)
  }

  printSummary(reports)
  process.exit(totalMissing > 0 ? 1 : 0)
}

function printReport({ consumer, missingKeys, unusedKeys, maybeDynamicKeys }) {
  console.log(`\n=== ${consumer} ===`)

  if (missingKeys.length) {
    console.log(`\n[MISSING] keys referenced in code but not in seed (${missingKeys.length}):`)
    for (const k of missingKeys) {
      console.log(`  - ${k.path}  (${k.file}${k.line ? ':' + k.line : ''})`)
    }
  } else {
    console.log('  no missing keys')
  }

  if (unusedKeys.length) {
    console.log(`\n[UNUSED] keys in seed but never referenced (${unusedKeys.length}):`)
    for (const k of unusedKeys) {
      console.log(`  - ${k.path}  (locale=${k.language || '?'})`)
    }
  }

  if (maybeDynamicKeys.length) {
    console.log(`\n[DYNAMIC] keys assembled from variables — review manually (${maybeDynamicKeys.length}):`)
    for (const k of maybeDynamicKeys.slice(0, 20)) {
      console.log(`  - ${k.path}  (${k.file}${k.line ? ':' + k.line : ''})`)
    }
    if (maybeDynamicKeys.length > 20) {
      console.log(`  …and ${maybeDynamicKeys.length - 20} more`)
    }
  }
}

function printSummary(reports) {
  const totalMissing = reports.reduce((s, r) => s + r.missingKeys.length, 0)
  const totalUnused = reports.reduce((s, r) => s + r.unusedKeys.length, 0)
  console.log('\n=== summary ===')
  console.log(`  consumers scanned: ${reports.length}`)
  console.log(`  total missing keys: ${totalMissing}`)
  console.log(`  total unused keys: ${totalUnused}`)
  if (totalMissing > 0) {
    console.log('\n  ✖ exit 1 — add missing keys to packages/locales/seed/*.json')
  } else {
    console.log('\n  ✓ catalog covers all referenced keys')
  }
}

if (!existsSync(resolve(PACKAGE_ROOT, 'seed/zh-CN.json'))) {
  console.error('seed/zh-CN.json not found; run from packages/locales/')
  process.exit(2)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})

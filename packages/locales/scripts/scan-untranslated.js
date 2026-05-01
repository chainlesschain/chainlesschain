#!/usr/bin/env node
/**
 * Untranslated-string scanner (M2 supplement).
 *
 * vue-i18n-extract finds drift between $t(key) calls and the JSON
 * catalog, but it CAN'T tell you about strings that aren't behind a
 * $t() call at all. This script walks consumer .vue templates and
 * surfaces raw CJK text inside template positions, grouped by file,
 * so you can see at a glance which views still ship hardcoded
 * Chinese ready to be lifted into the catalog.
 *
 * Heuristic, not exhaustive:
 *   - Scans only the <template> block of each .vue (script-block CJK
 *     is usually log/console messages, not user-facing).
 *   - Skips strings already inside `$t('...')` / `t('...')` /
 *     `i18n.global.t(...)`.
 *   - Skips HTML comments.
 *   - Skips known noise: a-icon names, attribute-name positions,
 *     style blocks.
 *
 * The output is informational — no exit-code gate. Use it to plan M3
 * extraction work; pair with `git log -p` on a touched view to scope
 * the lift.
 *
 * Run:
 *   npm --prefix packages/locales run scan-untranslated
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'
import { readFileSync } from 'node:fs'
import { glob } from 'glob'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../../..')

const CONSUMERS = [
  { name: 'web-panel', glob: 'packages/web-panel/src/**/*.vue' },
]

const CJK_RE = /[一-鿿㐀-䶿]+/g

// Anything inside one of these wrappers is already translated — strip
// the call (and its argument) before counting CJK chars.
const TRANSLATION_CALL_RES = [
  /\$t\(\s*['"`][^'"`]*['"`]\s*(?:,\s*\{[^}]*\})?\s*\)/g,
  /(?<![a-zA-Z_])t\(\s*['"`][^'"`]*['"`]\s*(?:,\s*\{[^}]*\})?\s*\)/g,
  /i18n\.global\.t\(\s*['"`][^'"`]*['"`]\s*(?:,\s*\{[^}]*\})?\s*\)/g,
]

function extractTemplate(src) {
  const m = src.match(/<template>([\s\S]*)<\/template>/)
  return m ? m[1] : ''
}

function stripNoise(template) {
  let s = template
  // Drop HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // Drop already-translated calls
  for (const re of TRANSLATION_CALL_RES) s = s.replace(re, '')
  return s
}

function collectCJKLines(src) {
  const tpl = extractTemplate(src)
  const cleaned = stripNoise(tpl)
  const lines = cleaned.split('\n')
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    const matches = lines[i].match(CJK_RE)
    if (matches) {
      for (const text of matches) {
        if (text.trim().length === 0) continue
        hits.push({ line: i + 1, text })
      }
    }
  }
  return hits
}

async function main() {
  const summary = []

  for (const c of CONSUMERS) {
    const files = await glob(c.glob, { cwd: REPO_ROOT, absolute: true })
    const fileHits = []

    for (const abs of files) {
      const src = readFileSync(abs, 'utf-8')
      const hits = collectCJKLines(src)
      if (hits.length) {
        fileHits.push({ file: relative(REPO_ROOT, abs), count: hits.length, hits })
      }
    }

    fileHits.sort((a, b) => b.count - a.count)
    summary.push({ consumer: c.name, fileHits })

    console.log(`\n=== ${c.name} — top 15 files by hardcoded-CJK count ===`)
    for (const f of fileHits.slice(0, 15)) {
      console.log(`  ${String(f.count).padStart(4)}  ${f.file}`)
    }
    const totalFiles = fileHits.length
    const totalHits = fileHits.reduce((s, f) => s + f.count, 0)
    console.log(`  ──`)
    console.log(`  ${totalFiles} files contain CJK text in templates; ${totalHits} occurrences total`)
  }

  console.log('\n=== summary ===')
  for (const s of summary) {
    const total = s.fileHits.reduce((acc, f) => acc + f.count, 0)
    console.log(`  ${s.consumer}: ${s.fileHits.length} files / ${total} occurrences`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

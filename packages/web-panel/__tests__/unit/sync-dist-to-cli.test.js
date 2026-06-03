/**
 * Unit test: scripts/sync-dist-to-cli.js (postbuild hook).
 *
 * The script copies packages/web-panel/dist/ → packages/cli/src/assets/web-panel/.
 * Test runs in a tmp staging dir so we don't touch the real CLI bundle.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  cpSync,
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = resolve(__dirname, '..', '..', 'scripts', 'sync-dist-to-cli.js')

/**
 * Build an isolated staging tree mirroring the real monorepo layout
 * (`packages/web-panel/{dist,scripts}` + `packages/cli/src/assets/web-panel`)
 * and copy the actual sync script into it. The script resolves paths
 * relative to its own location, so this lets us run it in isolation.
 */
function setupStaging({ withIndexHtml = true, withAssets = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sync-dist-test-'))
  const webPanelDir = join(root, 'packages', 'web-panel')
  const cliDir = join(root, 'packages', 'cli', 'src', 'assets', 'web-panel')
  const distDir = join(webPanelDir, 'dist')
  const scriptsDir = join(webPanelDir, 'scripts')

  mkdirSync(distDir, { recursive: true })
  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(cliDir, { recursive: true })

  if (withIndexHtml) {
    writeFileSync(
      join(distDir, 'index.html'),
      `<!DOCTYPE html><html><body><script src="./assets/index-DEADBEEF.js"></script></body></html>`,
      'utf-8',
    )
  }
  if (withAssets) {
    mkdirSync(join(distDir, 'assets'), { recursive: true })
    writeFileSync(join(distDir, 'assets', 'index-DEADBEEF.js'), '/* fresh bundle */', 'utf-8')
    writeFileSync(join(distDir, 'assets', 'vendor-FRESH.js'), '/* fresh vendor */', 'utf-8')
  }

  // Copy the real script in
  cpSync(SCRIPT_PATH, join(scriptsDir, 'sync-dist-to-cli.js'))

  return { root, webPanelDir, cliDir, distDir, scriptsDir }
}

function runScript(scriptsDir) {
  return spawnSync(
    process.execPath,
    [join(scriptsDir, 'sync-dist-to-cli.js')],
    { encoding: 'utf-8', timeout: 10_000 },
  )
}

describe('sync-dist-to-cli postbuild script', () => {
  let staging

  beforeEach(() => {
    staging = setupStaging()
  })

  afterEach(() => {
    rmSync(staging.root, { recursive: true, force: true })
  })

  it('copies dist/index.html + assets/* into cli target', () => {
    const r = runScript(staging.scriptsDir)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('synced')
    expect(r.stdout).toContain('index-DEADBEEF.js')

    const targetIndex = join(staging.cliDir, 'index.html')
    expect(existsSync(targetIndex)).toBe(true)
    expect(readFileSync(targetIndex, 'utf-8')).toContain('index-DEADBEEF.js')

    const targetAssets = join(staging.cliDir, 'assets')
    const files = readdirSync(targetAssets).sort()
    expect(files).toEqual(['index-DEADBEEF.js', 'vendor-FRESH.js'])
  })

  it('wipes pre-existing stale chunks in target/assets/ before copying', () => {
    // Pre-seed the target with stale content
    mkdirSync(join(staging.cliDir, 'assets'), { recursive: true })
    writeFileSync(join(staging.cliDir, 'assets', 'index-STALE.js'), 'old', 'utf-8')
    writeFileSync(join(staging.cliDir, 'assets', 'vendor-STALE.js'), 'old', 'utf-8')

    const r = runScript(staging.scriptsDir)
    expect(r.status, r.stderr).toBe(0)

    const targetAssets = join(staging.cliDir, 'assets')
    const files = readdirSync(targetAssets).sort()
    // Stale files gone, only fresh ones remain
    expect(files).toEqual(['index-DEADBEEF.js', 'vendor-FRESH.js'])
  })

  it('creates the target dir if it does not yet exist', () => {
    rmSync(staging.cliDir, { recursive: true, force: true })
    const r = runScript(staging.scriptsDir)
    expect(r.status, r.stderr).toBe(0)
    expect(existsSync(staging.cliDir)).toBe(true)
    expect(existsSync(join(staging.cliDir, 'index.html'))).toBe(true)
  })

  it('exits with non-zero + clear message when dist/ is missing', () => {
    rmSync(join(staging.distDir, 'index.html'))
    const r = runScript(staging.scriptsDir)
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/dist|build/i)
  })
})

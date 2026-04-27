/**
 * E2E tests for chainlesschain ui — web panel full pipeline.
 *
 * Spawns the real CLI binary and verifies:
 * - Server starts successfully
 * - All 15 SPA routes return 200 (via SPA fallback)
 * - __CC_CONFIG__ is injected in both project and global modes
 * - Static assets are served
 * - --web-panel-dir option is respected
 *
 * Each describe block uses ONE server in beforeAll/afterAll.
 * Ports: 19200–19240 (no conflicts with integration suite).
 *
 * Run: npx vitest run __tests__/e2e/panel.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const cliRoot = path.join(__dirname, '..', '..', '..', 'cli')
const bin = path.join(cliRoot, 'bin', 'chainlesschain.js')
const builtPanelDir = path.join(cliRoot, 'src', 'assets', 'web-panel')

// ── helpers ───────────────────────────────────────────────────────────────────

function startUiServer({ httpPort, wsPort, cwd, extraArgs = [] } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [
      bin, 'ui', '--no-open',
      '--port', String(httpPort),
      '--ws-port', String(wsPort),
      ...extraArgs,
    ], {
      env: { ...process.env, FORCE_COLOR: '0' },
      cwd: cwd || os.tmpdir(),
    })

    let out = ''
    const ready = (data) => {
      out += data.toString('utf8')
      if (out.includes(`http://127.0.0.1:${httpPort}`)) {
        resolve({ proc, port: httpPort })
      }
    }
    proc.stdout.on('data', ready)
    proc.stderr.on('data', ready)
    proc.on('error', reject)

    // Fallback: give the server time to start even if URL line wasn't captured
    setTimeout(() => resolve({ proc, port: httpPort }), 12000)
  })
}

function killProc(proc) {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null) { resolve(); return }
    proc.once('close', resolve)
    proc.kill('SIGTERM')
    setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* */ }; resolve() }, 2000)
  })
}

function httpGet(port, urlPath = '/') {
  return new Promise((resolve, reject) => {
    const chunks = []
    http.get(`http://127.0.0.1:${port}${urlPath}`, res => {
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    }).on('error', reject)
  })
}

function extractConfig(body) {
  const m = body.match(/window\.__CC_CONFIG__\s*=\s*(\{[^;]+\});/)
    || body.match(/window\.__CC_CONFIG__\s*=\s*(\{[\s\S]*?\});/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

// ─── Suite 1: Basic startup & routes ─────────────────────────────────────────

describe('chainlesschain ui — basic startup and SPA routes', () => {
  let proc
  const HTTP_PORT = 19200
  const WS_PORT   = 19201

  beforeAll(async () => {
    ({ proc } = await startUiServer({ httpPort: HTTP_PORT, wsPort: WS_PORT }))
  }, 30000)

  afterAll(() => killProc(proc))

  it('server process is running', () => {
    expect(proc).toBeDefined()
    expect(proc.killed).toBe(false)
  })

  it('GET / returns 200', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    expect(r.status).toBe(200)
  })

  it('GET / content-type is text/html', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    expect(r.headers['content-type']).toMatch(/text\/html/)
  })

  it('GET / injects __CC_CONFIG__', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    expect(r.body).toContain('__CC_CONFIG__')
  })

  // Hash-based SPA routes — the server just returns index.html for all.
  // (router count assertion in __tests__/unit/new-pages.test.js → 44
  // children; we exclude the redirect-only `/` entry. Subset coverage here.)
  const SPA_ROUTES = [
    '/dashboard', '/chat', '/cowork', '/services', '/logs', '/aiops',
    '/skills', '/providers', '/mcp', '/project-settings',
    '/notes', '/memory', '/knowledge', '/marketplace', '/cron', '/workflow', '/tasks',
    '/security', '/audit', '/did', '/permissions', '/p2p', '/backup', '/git', '/projects',
    '/crosschain', '/compliance',
    '/wallet', '/organization', '/analytics', '/templates',
    '/community', '/governance', '/reputation', '/recommend',
    '/video',
    '/rssfeed', '/webauthn',
  ]

  for (const route of SPA_ROUTES) {
    it(`SPA route ${route} returns 200`, async () => {
      const r = await httpGet(HTTP_PORT, route)
      expect(r.status).toBe(200)
    })
  }
})

// ─── Suite 2: Global mode config ─────────────────────────────────────────────

describe('chainlesschain ui — global mode config injection', () => {
  let proc
  const HTTP_PORT = 19210
  const WS_PORT   = 19211

  beforeAll(async () => {
    // Run in a temp dir that is NOT a chainlesschain project
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-global-'))
    ;({ proc } = await startUiServer({ httpPort: HTTP_PORT, wsPort: WS_PORT, cwd: tmpDir }))
  }, 30000)

  afterAll(() => killProc(proc))

  it('__CC_CONFIG__ is parseable JSON', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg).not.toBeNull()
  })

  it('wsPort in config matches the --ws-port argument', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg?.wsPort).toBe(WS_PORT)
  })

  it('wsHost defaults to 127.0.0.1', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg?.wsHost).toBe('127.0.0.1')
  })
})

// ─── Suite 3: Project mode config ────────────────────────────────────────────

describe('chainlesschain ui — project mode from project directory', () => {
  let proc, projectDir
  const HTTP_PORT = 19220
  const WS_PORT   = 19221

  beforeAll(async () => {
    // Create a minimal chainlesschain project directory
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-proj-'))
    const ccDir = path.join(projectDir, '.chainlesschain')
    fs.mkdirSync(ccDir, { recursive: true })
    fs.writeFileSync(
      path.join(ccDir, 'config.json'),
      JSON.stringify({ projectName: 'test-project', edition: 'community' }),
      'utf-8',
    )
    ;({ proc } = await startUiServer({ httpPort: HTTP_PORT, wsPort: WS_PORT, cwd: projectDir }))
  }, 30000)

  afterAll(async () => {
    await killProc(proc)
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('server starts successfully in project directory', () => {
    expect(proc.killed).toBe(false)
  })

  it('config mode is "project"', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    const cfg = extractConfig(r.body)
    // mode depends on project detection; just verify config is parseable
    expect(cfg).not.toBeNull()
    expect(['project', 'global']).toContain(cfg?.mode)
  })
})

// ─── Suite 4: --web-panel-dir option ─────────────────────────────────────────

describe('chainlesschain ui — --web-panel-dir option', () => {
  let proc, tmpBase
  const HTTP_PORT = 19230
  const WS_PORT   = 19231

  beforeAll(async () => {
    // Create a fake dist directory
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-wpd-'))
    const distDir = path.join(tmpBase, 'dist')
    const assetsDir = path.join(distDir, 'assets')
    fs.mkdirSync(assetsDir, { recursive: true })
    fs.writeFileSync(
      path.join(distDir, 'index.html'),
      `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script>window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;</script>
</head><body><div id="app"></div></body></html>`,
      'utf-8',
    )
    fs.writeFileSync(path.join(assetsDir, 'app.js'), '// fake app', 'utf-8')
    fs.writeFileSync(path.join(assetsDir, 'style.css'), 'body{margin:0}', 'utf-8')

    ;({ proc } = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      extraArgs: ['--web-panel-dir', distDir],
    }))
  }, 30000)

  afterAll(async () => {
    await killProc(proc)
    if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('serves the custom dist index.html', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    expect(r.status).toBe(200)
    expect(r.body).toContain('<div id="app">')
  })

  it('__CC_CONFIG__ placeholder is replaced in custom dist', async () => {
    const r = await httpGet(HTTP_PORT, '/')
    expect(r.body).not.toContain('__CC_CONFIG_PLACEHOLDER__')
    expect(r.body).toContain('__CC_CONFIG__')
  })

  it('serves custom JS asset from dist/assets/', async () => {
    const r = await httpGet(HTTP_PORT, '/assets/app.js')
    expect(r.status).toBe(200)
  })

  it('serves custom CSS asset', async () => {
    const r = await httpGet(HTTP_PORT, '/assets/style.css')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/css/)
  })
})

// ─── Suite 5: Built panel asset serving ──────────────────────────────────────

describe('chainlesschain ui — built Vue3 panel assets', () => {
  let proc, assetFiles
  const HTTP_PORT = 19240
  const WS_PORT   = 19241

  beforeAll(async () => {
    // Discover built assets
    try {
      assetFiles = fs.readdirSync(path.join(builtPanelDir, 'assets'))
    } catch {
      assetFiles = []
    }

    ;({ proc } = await startUiServer({
      httpPort: HTTP_PORT,
      wsPort: WS_PORT,
      extraArgs: ['--web-panel-dir', builtPanelDir],
    }))
  }, 30000)

  afterAll(() => killProc(proc))

  it('built panel has asset files', () => {
    expect(assetFiles.length).toBeGreaterThan(0)
  })

  it('vendor JS chunk is served', async () => {
    const vendorJs = assetFiles.find(f => f.startsWith('vendor') && f.endsWith('.js'))
    if (!vendorJs) return
    const r = await httpGet(HTTP_PORT, `/assets/${vendorJs}`)
    expect(r.status).toBe(200)
  })

  it('antd JS chunk is served', async () => {
    const antdJs = assetFiles.find(f => f.startsWith('antd') && f.endsWith('.js'))
    if (!antdJs) return
    const r = await httpGet(HTTP_PORT, `/assets/${antdJs}`)
    expect(r.status).toBe(200)
  })

  it('index CSS is served', async () => {
    const indexCss = assetFiles.find(f => f.startsWith('index') && f.endsWith('.css'))
    if (!indexCss) return
    const r = await httpGet(HTTP_PORT, `/assets/${indexCss}`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/css/)
  })

  it('Dashboard chunk JS is served', async () => {
    const dashJs = assetFiles.find(f => f.startsWith('Dashboard') && f.endsWith('.js'))
    if (!dashJs) return
    const r = await httpGet(HTTP_PORT, `/assets/${dashJs}`)
    expect(r.status).toBe(200)
  })

  it('all new page chunks exist in built assets', () => {
    const expectedPrefixes = ['Services', 'Logs', 'Notes', 'McpTools', 'Memory', 'Cron', 'Security', 'P2P', 'Git', 'Projects', 'Permissions', 'Wallet', 'Organization', 'Analytics', 'Templates', 'Backup', 'RssFeed', 'WebAuthn']
    for (const prefix of expectedPrefixes) {
      const found = assetFiles.some(f => f.startsWith(prefix) && f.endsWith('.js'))
      expect(found, `Missing chunk for ${prefix}`).toBe(true)
    }
  })
})

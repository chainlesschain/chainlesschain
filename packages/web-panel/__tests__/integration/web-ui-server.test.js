/**
 * Integration tests: web-ui-server HTTP serving of the Vue3 panel.
 *
 * Imports the real web-ui-server from packages/cli/src/lib/web-ui-server.js
 * and uses the actual built assets in packages/cli/src/assets/web-panel/.
 *
 * Each describe block starts ONE server in beforeAll/afterAll.
 * Ports: 19100–19140 (avoid collisions with E2E suite).
 *
 * Run: npx vitest run __tests__/integration/web-ui-server.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to CLI package (two directories up from packages/web-panel)
const cliRoot = path.join(__dirname, '..', '..', '..', 'cli')
const serverPath = path.join(cliRoot, 'src', 'lib', 'web-ui-server.js')
const builtPanelDir = path.join(cliRoot, 'src', 'assets', 'web-panel')

// ── helpers ───────────────────────────────────────────────────────────────────

function get(port, urlPath = '/') {
  return new Promise((resolve, reject) => {
    const chunks = []
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
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
  // Try single-line JSON first
  const m = body.match(/window\.__CC_CONFIG__\s*=\s*(\{[^;]+\});/)
    || body.match(/window\.__CC_CONFIG__\s*=\s*(\{[\s\S]*?\});/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

async function importServer() {
  const mod = await import(serverPath)
  return mod
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve))
}

// ─── Suite 1: Global mode serving ────────────────────────────────────────────

describe('web-ui-server — global mode', () => {
  let server
  const PORT = 19100

  beforeAll(async () => {
    const { createWebUIServer } = await importServer()
    server = createWebUIServer({
      wsPort: 19101,
      wsToken: null,
      wsHost: '127.0.0.1',
      projectRoot: null,
      projectName: null,
      mode: 'global',
      staticDir: builtPanelDir,
    })
    await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(PORT, '127.0.0.1', resolve)
    })
  })

  afterAll(() => closeServer(server))

  it('GET / returns 200', async () => {
    const r = await get(PORT, '/')
    expect(r.status).toBe(200)
  })

  it('GET / returns text/html content-type', async () => {
    const r = await get(PORT, '/')
    expect(r.headers['content-type']).toMatch(/text\/html/)
  })

  it('GET / body contains __CC_CONFIG__', async () => {
    const r = await get(PORT, '/')
    expect(r.body).toContain('__CC_CONFIG__')
  })

  it('config.mode is "global"', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg).not.toBeNull()
    expect(cfg.mode).toBe('global')
  })

  it('config.wsPort matches provided value', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg.wsPort).toBe(19101)
  })

  it('config.wsToken is null in global no-auth mode', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg.wsToken).toBeFalsy()
  })

  it('GET / body contains <meta charset="UTF-8">', async () => {
    const r = await get(PORT, '/')
    expect(r.body).toMatch(/<meta charset=["']UTF-8["']/i)
  })

  it('SPA fallback: GET /unknown-path returns 200 with HTML', async () => {
    const r = await get(PORT, '/unknown-page-xyz')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/text\/html/)
  })

  it('SPA fallback body also contains __CC_CONFIG__', async () => {
    const r = await get(PORT, '/dashboard')
    expect(r.body).toContain('__CC_CONFIG__')
  })
})

// ─── Suite 2: Project mode ────────────────────────────────────────────────────

describe('web-ui-server — project mode', () => {
  let server
  const PORT = 19110

  beforeAll(async () => {
    const { createWebUIServer } = await importServer()
    server = createWebUIServer({
      wsPort: 19111,
      wsToken: null,
      wsHost: '127.0.0.1',
      projectRoot: '/home/user/my-project',
      projectName: 'my-project',
      mode: 'project',
      staticDir: builtPanelDir,
    })
    await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(PORT, '127.0.0.1', resolve)
    })
  })

  afterAll(() => closeServer(server))

  it('config.mode is "project"', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg.mode).toBe('project')
  })

  it('config.projectName is injected', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg.projectName).toBe('my-project')
  })

  it('config.projectRoot is injected', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg.projectRoot).toBe('/home/user/my-project')
  })
})

// ─── Suite 3: Auth token ──────────────────────────────────────────────────────

describe('web-ui-server — auth token', () => {
  let server
  const PORT = 19120

  beforeAll(async () => {
    const { createWebUIServer } = await importServer()
    server = createWebUIServer({
      wsPort: 19121,
      wsToken: 'super-secret-token',
      wsHost: '127.0.0.1',
      projectRoot: null,
      projectName: null,
      mode: 'global',
      staticDir: builtPanelDir,
    })
    await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(PORT, '127.0.0.1', resolve)
    })
  })

  afterAll(() => closeServer(server))

  it('config.wsToken is injected when set', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg.wsToken).toBe('super-secret-token')
  })

  it('token is safely embedded (no raw script injection)', async () => {
    const r = await get(PORT, '/')
    // Token should not allow breaking out of the JSON string
    expect(r.body).not.toContain('</script><script>')
  })
})

// ─── Suite 4: Static asset serving ───────────────────────────────────────────

describe('web-ui-server — static asset serving', () => {
  let server, assetFiles
  const PORT = 19130

  beforeAll(async () => {
    const { createWebUIServer } = await importServer()
    server = createWebUIServer({
      wsPort: 19131,
      wsToken: null,
      wsHost: '127.0.0.1',
      projectRoot: null,
      projectName: null,
      mode: 'global',
      staticDir: builtPanelDir,
    })
    await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(PORT, '127.0.0.1', resolve)
    })

    // Discover available asset files
    try {
      assetFiles = fs.readdirSync(path.join(builtPanelDir, 'assets'))
    } catch {
      assetFiles = []
    }
  })

  afterAll(() => closeServer(server))

  it('built panel directory exists', () => {
    expect(fs.existsSync(builtPanelDir)).toBe(true)
  })

  it('index.html exists in built panel', () => {
    expect(fs.existsSync(path.join(builtPanelDir, 'index.html'))).toBe(true)
  })

  it('assets/ directory has files', () => {
    expect(assetFiles.length).toBeGreaterThan(0)
  })

  it('serves a JS asset file with correct content-type', async () => {
    const jsFile = assetFiles.find(f => f.endsWith('.js'))
    if (!jsFile) return // skip if no JS found
    const r = await get(PORT, `/assets/${jsFile}`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/javascript/)
  })

  it('serves a CSS asset file with correct content-type', async () => {
    const cssFile = assetFiles.find(f => f.endsWith('.css'))
    if (!cssFile) return
    const r = await get(PORT, `/assets/${cssFile}`)
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/css/)
  })

  it('non-existent asset path falls back to SPA (HTML, not file)', async () => {
    const r = await get(PORT, '/assets/definitely-not-there-xyz.js')
    // SPA server returns index.html for unmatched paths; 404 is also acceptable
    if (r.status === 200) {
      expect(r.body).toMatch(/<html|<!DOCTYPE/i)
    } else {
      expect(r.status).toBe(404)
    }
  })

  it('path traversal does not leak raw file contents', async () => {
    const r = await get(PORT, '/assets/../../package.json')
    // Must NOT return raw package.json regardless of status code
    expect(r.body).not.toContain('"name": "@chainlesschain')
    if (r.status === 200) {
      // SPA fallback — verify it's HTML, not the actual file
      expect(r.body).toMatch(/<html|<!DOCTYPE/i)
    } else {
      expect([403, 404]).toContain(r.status)
    }
  })
})

// ─── Suite 5: XSS safety ─────────────────────────────────────────────────────

describe('web-ui-server — XSS safety in config injection', () => {
  let server
  const PORT = 19140

  beforeAll(async () => {
    const { createWebUIServer } = await importServer()
    server = createWebUIServer({
      wsPort: 19141,
      wsToken: null,
      wsHost: '127.0.0.1',
      projectRoot: '/project/<script>alert(1)</script>',
      projectName: 'test & "project"',
      mode: 'project',
      staticDir: builtPanelDir,
    })
    await new Promise((resolve, reject) => {
      server.on('error', reject)
      server.listen(PORT, '127.0.0.1', resolve)
    })
  })

  afterAll(() => closeServer(server))

  it('< and > in config values are escaped as unicode', async () => {
    const r = await get(PORT, '/')
    expect(r.body).not.toContain('<script>alert(1)</script>')
  })

  it('config can still be parsed from escaped JSON', async () => {
    const r = await get(PORT, '/')
    const cfg = extractConfig(r.body)
    expect(cfg).not.toBeNull()
    expect(cfg.mode).toBe('project')
  })
})

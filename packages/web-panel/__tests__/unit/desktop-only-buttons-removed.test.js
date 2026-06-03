/**
 * Regression test: disabled "桌面应用专属" / "(CLI 端)" placeholder buttons
 * have been removed from the web panel.
 *
 * Background — three views (Compliance, DID, KnowledgeGraph) used to ship
 * disabled <a-button> / <a-menu-item> placeholders for features that only
 * exist in the desktop app or the CLI. They were noise: no @click, no path
 * to ever wire up here. They were removed; this test prevents regressions.
 *
 * Source-level scan (not a mount) — fast, no ws/echarts setup needed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function readSrc(rel) {
  return readFileSync(resolve(__dirname, '../../src', rel), 'utf-8')
}

describe('desktop-only / CLI-only placeholder buttons removed', () => {
  describe('Compliance.vue', () => {
    const src = readSrc('views/Compliance.vue')

    it('does not ship the disabled "导入 STIX bundle" menu item', () => {
      // Empty-state copy on line ~140 legitimately mentions
      // "需通过 CLI 导入 STIX bundle: cc compliance threat-intel import …"
      // — that is a help string, not a placeholder button. Match the
      // menu-item shape instead.
      expect(src).not.toMatch(/key="import"\s+disabled/)
      expect(src).not.toMatch(/\(CLI 端\)/)
      expect(src).not.toMatch(/<a-menu-item[^>]*disabled[^>]*>\s*<CloudUploadOutlined/)
    })

    it('does not import unused CloudUploadOutlined icon', () => {
      expect(src).not.toMatch(/CloudUploadOutlined/)
    })

    it('preserves the empty-state CLI hint (cc compliance threat-intel import)', () => {
      // The empty-state copy still tells users where to import via CLI.
      expect(src).toMatch(/cc compliance threat-intel import/)
    })
  })

  describe('DID.vue', () => {
    const src = readSrc('views/DID.vue')

    it('does not ship disabled mnemonic/DHT placeholder buttons', () => {
      expect(src).not.toMatch(/从助记词导入/)
      expect(src).not.toMatch(/导出助记词/)
      expect(src).not.toMatch(/发布到 DHT/)
      expect(src).not.toMatch(/桌面应用专属/)
    })

    it('does not import unused FileProtect/CloudUpload icons', () => {
      expect(src).not.toMatch(/FileProtectOutlined/)
      expect(src).not.toMatch(/CloudUploadOutlined/)
    })

    it('still wires the "仅 Web 模式" alert (now via did.webOnly.* i18n keys)', () => {
      // After DID was translated to use i18n (M3), the literal Chinese
      // strings moved to packages/locales/seed/zh-CN.json. Assert the
      // wiring by key reference + catalog content instead.
      expect(src).toMatch(/did\.webOnly\.message/)
      expect(src).toMatch(/did\.webOnly\.description/)
      const zhCN = JSON.parse(
        readFileSync(
          resolve(__dirname, '../../../locales/seed/zh-CN.json'),
          'utf-8',
        ),
      )
      expect(zhCN.did.webOnly.message).toMatch(/仅 Web 模式/)
      expect(zhCN.did.webOnly.description).toMatch(/助记词备份\/恢复/)
    })

    it('keeps the "View DID Document" button (now via did.details.viewDoc)', () => {
      expect(src).toMatch(/did\.details\.viewDoc/)
      const zhCN = JSON.parse(
        readFileSync(
          resolve(__dirname, '../../../locales/seed/zh-CN.json'),
          'utf-8',
        ),
      )
      expect(zhCN.did.details.viewDoc).toMatch(/查看 DID Document/)
    })
  })

  describe('KnowledgeGraph.vue', () => {
    const src = readSrc('views/KnowledgeGraph.vue')

    it('does not ship the disabled "AI 重建" placeholder button', () => {
      expect(src).not.toMatch(/AI 重建/)
      expect(src).not.toMatch(/桌面应用专属/)
    })

    it('does not import unused ThunderboltOutlined icon', () => {
      expect(src).not.toMatch(/ThunderboltOutlined/)
    })
  })

  describe('cross-view audit', () => {
    it('no view file ships a disabled button tagged as desktop-only', () => {
      const files = [
        'views/Compliance.vue',
        'views/DID.vue',
        'views/KnowledgeGraph.vue',
        'views/Backup.vue',
        'views/Marketplace.vue',
        'views/Inference.vue',
        'views/NLProgramming.vue',
      ]
      for (const f of files) {
        const src = readSrc(f)
        expect(src, `${f} should not ship "桌面应用专属" disabled placeholders`).not.toMatch(
          /桌面应用专属/,
        )
      }
    })
  })
})

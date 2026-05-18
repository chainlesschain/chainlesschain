/**
 * Locale System Unit Tests
 *
 * Verifies:
 *  - fr-FR and es-ES locale files contain all required top-level sections
 *  - New sections (enterprise, performance, analytics, agent, collaboration, storage)
 *    exist in all four locales (zh-CN, en-US, fr-FR, es-ES)
 *  - Key-level presence checks for selected sub-keys in each new section
 *  - All spot-checked translation values are non-empty strings
 *  - Translations differ between French and Spanish for the same key
 *  - setLocale persists to localStorage
 *  - supportedLocales exposes fr-FR and es-ES with correct labels
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock('vue-i18n', () => ({
  createI18n: vi.fn((config) => ({
    global: {
      locale: { value: config.locale },
      t: (key: string) => key,
    },
    install: vi.fn(),
  })),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helper: all required top-level section names
// ---------------------------------------------------------------------------
const REQUIRED_SECTIONS = [
  'common',
  'app',
  'nav',
  'auth',
  'knowledge',
  'project',
  'chat',
  'file',
  'editor',
  'settings',
  'ukey',
  'git',
  'p2p',
  'social',
  'trade',
  'template',
  'notification',
  'error',
  'validation',
  'time',
  'enterprise',
  'performance',
  'analytics',
  'agent',
  'collaboration',
  'storage',
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Locale System', () => {
  // =========================================================================
  // Locale completeness — fr-FR
  // =========================================================================
  describe('fr-FR locale completeness', () => {
    it('fr-FR has all required top-level sections', async () => {
      const { default: frFR } = await import('../fr-FR');
      for (const section of REQUIRED_SECTIONS) {
        expect(frFR, `fr-FR missing section: ${section}`).toHaveProperty(section);
      }
    });

    it('fr-FR enterprise section has all required keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.enterprise).toHaveProperty('orgManagement');
      expect(frFR.enterprise).toHaveProperty('departments');
      expect(frFR.enterprise).toHaveProperty('hierarchy');
      expect(frFR.enterprise).toHaveProperty('approvalWorkflow');
      expect(frFR.enterprise).toHaveProperty('pendingApprovals');
      expect(frFR.enterprise).toHaveProperty('memberJoinRequest');
      expect(frFR.enterprise).toHaveProperty('dashboardStats');
      expect(frFR.enterprise).toHaveProperty('orgSettings');
      expect(frFR.enterprise).toHaveProperty('departmentLead');
    });

    it('fr-FR performance section has all required keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.performance).toHaveProperty('monitoring');
      expect(frFR.performance).toHaveProperty('autoTuning');
      expect(frFR.performance).toHaveProperty('cpuUsage');
      expect(frFR.performance).toHaveProperty('memoryUsage');
      expect(frFR.performance).toHaveProperty('tuningRules');
      expect(frFR.performance).toHaveProperty('enableRule');
      expect(frFR.performance).toHaveProperty('disableRule');
      expect(frFR.performance).toHaveProperty('manualTune');
      expect(frFR.performance).toHaveProperty('tuningHistory');
    });

    it('fr-FR analytics section has all required keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.analytics).toHaveProperty('dashboard');
      expect(frFR.analytics).toHaveProperty('totalAICalls');
      expect(frFR.analytics).toHaveProperty('exportReport');
      expect(frFR.analytics).toHaveProperty('timeSeries');
      expect(frFR.analytics).toHaveProperty('kpis');
      expect(frFR.analytics).toHaveProperty('successRate');
      expect(frFR.analytics).toHaveProperty('totalTokens');
    });

    it('fr-FR agent section has all required keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.agent).toHaveProperty('autonomous');
      expect(frFR.agent).toHaveProperty('submitGoal');
      expect(frFR.agent).toHaveProperty('reasoning');
      expect(frFR.agent).toHaveProperty('activeGoals');
      expect(frFR.agent).toHaveProperty('toolPermissions');
      expect(frFR.agent).toHaveProperty('goalHistory');
    });

    it('fr-FR collaboration section has all required keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.collaboration).toHaveProperty('realTimeEditing');
      expect(frFR.collaboration).toHaveProperty('collaborators');
      expect(frFR.collaboration).toHaveProperty('connected');
      expect(frFR.collaboration).toHaveProperty('synced');
      expect(frFR.collaboration).toHaveProperty('undoRedo');
      expect(frFR.collaboration).toHaveProperty('richTextEditor');
    });

    it('fr-FR storage section has all required keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.storage).toHaveProperty('ipfs');
      expect(frFR.storage).toHaveProperty('nodeStatus');
      expect(frFR.storage).toHaveProperty('pinnedContent');
      expect(frFR.storage).toHaveProperty('decentralized');
      expect(frFR.storage).toHaveProperty('storageQuota');
      expect(frFR.storage).toHaveProperty('encrypted');
      expect(frFR.storage).toHaveProperty('cid');
    });

    it('fr-FR common section has all basic action keys', async () => {
      const { default: frFR } = await import('../fr-FR');
      expect(frFR.common).toHaveProperty('confirm');
      expect(frFR.common).toHaveProperty('cancel');
      expect(frFR.common).toHaveProperty('save');
      expect(frFR.common).toHaveProperty('delete');
      expect(frFR.common).toHaveProperty('edit');
      expect(frFR.common).toHaveProperty('search');
      expect(frFR.common).toHaveProperty('upload');
      expect(frFR.common).toHaveProperty('download');
    });

    it('all spot-checked fr-FR locale keys are non-empty strings', async () => {
      const { default: frFR } = await import('../fr-FR');

      const checks: [string, string][] = [
        ['common.confirm', frFR.common.confirm],
        ['common.cancel', frFR.common.cancel],
        ['enterprise.orgManagement', frFR.enterprise.orgManagement],
        ['performance.monitoring', frFR.performance.monitoring],
        ['analytics.dashboard', frFR.analytics.dashboard],
        ['agent.autonomous', frFR.agent.autonomous],
        ['collaboration.realTimeEditing', frFR.collaboration.realTimeEditing],
        ['storage.ipfs', frFR.storage.ipfs],
      ];

      for (const [keyPath, value] of checks) {
        expect(typeof value, `${keyPath} should be a string`).toBe('string');
        expect(value.length, `${keyPath} should not be empty`).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Locale completeness — es-ES
  // =========================================================================
  describe('es-ES locale completeness', () => {
    it('es-ES has all required top-level sections', async () => {
      const { default: esES } = await import('../es-ES');
      for (const section of REQUIRED_SECTIONS) {
        expect(esES, `es-ES missing section: ${section}`).toHaveProperty(section);
      }
    });

    it('es-ES enterprise section has all required keys', async () => {
      const { default: esES } = await import('../es-ES');
      expect(esES.enterprise).toHaveProperty('orgManagement');
      expect(esES.enterprise).toHaveProperty('departments');
      expect(esES.enterprise).toHaveProperty('hierarchy');
      expect(esES.enterprise).toHaveProperty('approvalWorkflow');
      expect(esES.enterprise).toHaveProperty('pendingApprovals');
      expect(esES.enterprise).toHaveProperty('memberJoinRequest');
    });

    it('es-ES performance section has all required keys', async () => {
      const { default: esES } = await import('../es-ES');
      expect(esES.performance).toHaveProperty('monitoring');
      expect(esES.performance).toHaveProperty('autoTuning');
      expect(esES.performance).toHaveProperty('cpuUsage');
      expect(esES.performance).toHaveProperty('tuningRules');
      expect(esES.performance).toHaveProperty('rendererFps');
      expect(esES.performance).toHaveProperty('domNodes');
    });

    it('es-ES analytics section has all required keys', async () => {
      const { default: esES } = await import('../es-ES');
      expect(esES.analytics).toHaveProperty('dashboard');
      expect(esES.analytics).toHaveProperty('totalAICalls');
      expect(esES.analytics).toHaveProperty('exportReport');
      expect(esES.analytics).toHaveProperty('autoRefresh');
      expect(esES.analytics).toHaveProperty('period');
    });

    it('es-ES agent section has all required keys', async () => {
      const { default: esES } = await import('../es-ES');
      expect(esES.agent).toHaveProperty('autonomous');
      expect(esES.agent).toHaveProperty('submitGoal');
      expect(esES.agent).toHaveProperty('reasoning');
      expect(esES.agent).toHaveProperty('queueStatus');
      expect(esES.agent).toHaveProperty('userIntervention');
    });

    it('es-ES collaboration section has all required keys', async () => {
      const { default: esES } = await import('../es-ES');
      expect(esES.collaboration).toHaveProperty('realTimeEditing');
      expect(esES.collaboration).toHaveProperty('collaborators');
      expect(esES.collaboration).toHaveProperty('syncing');
      expect(esES.collaboration).toHaveProperty('cursorPresence');
      expect(esES.collaboration).toHaveProperty('toolbar');
    });

    it('es-ES storage section has all required keys', async () => {
      const { default: esES } = await import('../es-ES');
      expect(esES.storage).toHaveProperty('ipfs');
      expect(esES.storage).toHaveProperty('nodeStatus');
      expect(esES.storage).toHaveProperty('pinnedContent');
      expect(esES.storage).toHaveProperty('startNode');
      expect(esES.storage).toHaveProperty('stopNode');
      expect(esES.storage).toHaveProperty('peerCount');
    });

    it('all spot-checked es-ES locale keys are non-empty strings', async () => {
      const { default: esES } = await import('../es-ES');

      const checks: [string, string][] = [
        ['common.confirm', esES.common.confirm],
        ['enterprise.orgManagement', esES.enterprise.orgManagement],
        ['performance.monitoring', esES.performance.monitoring],
        ['analytics.totalAICalls', esES.analytics.totalAICalls],
        ['agent.submitGoal', esES.agent.submitGoal],
        ['collaboration.realTimeEditing', esES.collaboration.realTimeEditing],
        ['storage.nodeStatus', esES.storage.nodeStatus],
      ];

      for (const [keyPath, value] of checks) {
        expect(typeof value, `${keyPath} should be a string`).toBe('string');
        expect(value.length, `${keyPath} should not be empty`).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Cross-locale translation divergence
  // =========================================================================
  describe('Translation divergence between fr-FR and es-ES', () => {
    it('fr-FR and es-ES have different translations for common.confirm', async () => {
      const { default: frFR } = await import('../fr-FR');
      const { default: esES } = await import('../es-ES');
      // French "Confirmer" vs Spanish "Confirmar"
      expect(frFR.common.confirm).not.toBe(esES.common.confirm);
    });

    it('fr-FR and es-ES have different translations for enterprise.orgManagement', async () => {
      const { default: frFR } = await import('../fr-FR');
      const { default: esES } = await import('../es-ES');
      expect(frFR.enterprise.orgManagement).not.toBe(esES.enterprise.orgManagement);
    });

    it('fr-FR and es-ES have different translations for performance.monitoring', async () => {
      const { default: frFR } = await import('../fr-FR');
      const { default: esES } = await import('../es-ES');
      expect(frFR.performance.monitoring).not.toBe(esES.performance.monitoring);
    });

    it('fr-FR and es-ES have different translations for storage.ipfs key label decentralized', async () => {
      const { default: frFR } = await import('../fr-FR');
      const { default: esES } = await import('../es-ES');
      expect(frFR.storage.decentralized).not.toBe(esES.storage.decentralized);
    });
  });

  // =========================================================================
  // Existing locales: zh-CN and en-US also carry the 6 new sections
  // =========================================================================
  describe('Existing locales have the 6 new sections', () => {
    const NEW_SECTIONS = [
      'enterprise',
      'performance',
      'analytics',
      'agent',
      'collaboration',
      'storage',
    ] as const;

    it('zh-CN has all 6 new sections', async () => {
      const { default: zhCN } = await import('../zh-CN');
      for (const section of NEW_SECTIONS) {
        expect(zhCN, `zh-CN missing section: ${section}`).toHaveProperty(section);
      }
    });

    it('zh-CN enterprise section has orgManagement key', async () => {
      const { default: zhCN } = await import('../zh-CN');
      expect(zhCN.enterprise).toHaveProperty('orgManagement');
      expect(typeof zhCN.enterprise.orgManagement).toBe('string');
      expect(zhCN.enterprise.orgManagement.length).toBeGreaterThan(0);
    });

    it('en-US has all 6 new sections', async () => {
      const { default: enUS } = await import('../en-US');
      for (const section of NEW_SECTIONS) {
        expect(enUS, `en-US missing section: ${section}`).toHaveProperty(section);
      }
    });

    it('en-US enterprise section has all required keys', async () => {
      const { default: enUS } = await import('../en-US');
      expect(enUS.enterprise).toHaveProperty('orgManagement');
      expect(enUS.enterprise).toHaveProperty('departments');
      expect(enUS.enterprise).toHaveProperty('hierarchy');
      expect(enUS.enterprise).toHaveProperty('approvalWorkflow');
    });

    it('en-US performance section has cpuUsage key', async () => {
      const { default: enUS } = await import('../en-US');
      expect(enUS.performance).toHaveProperty('cpuUsage');
      expect(enUS.performance.cpuUsage).toBe('CPU Usage');
    });

    it('en-US analytics section has exportReport key', async () => {
      const { default: enUS } = await import('../en-US');
      expect(enUS.analytics).toHaveProperty('exportReport');
      expect(enUS.analytics.exportReport).toBe('Export Report');
    });
  });

  // =========================================================================
  // setLocale / getLocale / supportedLocales from index.ts
  // =========================================================================
  describe('setLocale / getLocale', () => {
    beforeEach(() => {
      // Provide a fresh localStorage stub before each test in this group
      const store: Record<string, string> = {};
      const localStorageMock = {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          Object.keys(store).forEach((k) => delete store[k]);
        }),
      };
      Object.defineProperty(globalThis, 'localStorage', {
        value: localStorageMock,
        writable: true,
        configurable: true,
      });
    });

    it('setLocale saves the chosen locale to localStorage', async () => {
      const { setLocale } = await import('../index');
      setLocale('fr-FR');
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('app-locale', 'fr-FR');
    });

    it('setLocale saves es-ES to localStorage', async () => {
      const { setLocale } = await import('../index');
      setLocale('es-ES');
      expect(globalThis.localStorage.setItem).toHaveBeenCalledWith('app-locale', 'es-ES');
    });

    it('supportedLocales includes both fr-FR and es-ES values', async () => {
      const { supportedLocales } = await import('../index');
      const values = supportedLocales.map((l) => l.value);
      expect(values).toContain('fr-FR');
      expect(values).toContain('es-ES');
    });

    it('supportedLocales has correct label Français for fr-FR', async () => {
      const { supportedLocales } = await import('../index');
      const frFR = supportedLocales.find((l) => l.value === 'fr-FR');
      expect(frFR).toBeDefined();
      expect(frFR?.label).toBe('Français');
    });

    it('supportedLocales has correct label Español for es-ES', async () => {
      const { supportedLocales } = await import('../index');
      const esES = supportedLocales.find((l) => l.value === 'es-ES');
      expect(esES).toBeDefined();
      expect(esES?.label).toBe('Español');
    });

    it('supportedLocales entries each have value, label and icon fields', async () => {
      const { supportedLocales } = await import('../index');
      for (const locale of supportedLocales) {
        expect(locale).toHaveProperty('value');
        expect(locale).toHaveProperty('label');
        expect(locale).toHaveProperty('icon');
      }
    });

    it('supportedLocales contains exactly 7 entries', async () => {
      const { supportedLocales } = await import('../index');
      // zh-CN, en-US, zh-TW, ja-JP, ko-KR, fr-FR, es-ES
      expect(supportedLocales).toHaveLength(7);
    });
  });
});

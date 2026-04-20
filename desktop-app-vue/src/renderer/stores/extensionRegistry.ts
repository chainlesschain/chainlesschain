/**
 * Extension Registry Store — v6 shell 扩展点客户端
 *
 * 从 main 进程查询 plugin-manager 注册的扩展：
 *   ui.space / ui.artifact / ui.slash / ui.mention /
 *   ui.status-bar / ui.home-widget / ui.composer-slot
 *
 * 通过 window.electronAPI.plugin.* 调用已在 preload 暴露的 IPC。
 */

import { logger } from "@/utils/logger";
import { defineStore } from "pinia";

// ==================== 类型定义 ====================

export interface SpaceContribution {
  id: string;
  pluginId: string;
  name: string;
  icon: string;
  description: string;
  ragPreset: string | null;
  systemPrompt: string;
  contactsGroup: string | null;
  permissions: string[];
  order: number;
}

export interface ArtifactContribution {
  id: string;
  pluginId: string;
  type: string;
  renderer: string | null;
  rendererPath: string | null;
  actions: Array<{ id: string; label: string; icon?: string }>;
  icon: string;
  label: string;
}

export interface SlashCommandContribution {
  id: string;
  pluginId: string;
  trigger: string;
  handler: string | null;
  description: string;
  icon: string;
  requirePermissions: string[];
}

export interface MentionSourceContribution {
  id: string;
  pluginId: string;
  prefix: string;
  source: string | null;
  label: string;
  icon: string;
}

export interface StatusBarWidgetContribution {
  id: string;
  pluginId: string;
  component: string | null;
  componentPath: string | null;
  position: "left" | "center" | "right";
  order: number;
  tooltip: string;
}

export interface HomeWidgetContribution {
  id: string;
  pluginId: string;
  component: string | null;
  componentPath: string | null;
  size: "small" | "medium" | "large";
  order: number;
  title: string;
}

export interface ComposerSlotContribution {
  id: string;
  pluginId: string;
  component: string | null;
  componentPath: string | null;
  position: "left" | "right" | "above" | "below";
  order: number;
}

export interface BrandThemeContribution {
  id: string;
  pluginId: string;
  themeId: string;
  name: string;
  mode: "light" | "dark" | "auto";
  tokens: Record<string, string>;
  priority: number;
}

export interface BrandIdentityContribution {
  id: string;
  pluginId: string;
  identityId: string;
  productName: string | null;
  tagline: string | null;
  logo: string | null;
  splash: string | null;
  favicon: string | null;
  eula: string | null;
  links: Record<string, string>;
  priority: number;
}

// P4 企业能力扩展点
export interface LLMProviderContribution {
  id: string;
  pluginId: string;
  providerId: string;
  name: string;
  models: string[];
  endpoint: string | null;
  capabilities: Record<string, unknown>;
  priority: number;
}

export interface AuthProviderContribution {
  id: string;
  pluginId: string;
  providerId: string;
  name: string;
  kind: "local" | "oidc" | "saml" | "ldap" | "did" | string;
  endpoints: Record<string, string>;
  scopes: string[];
  priority: number;
}

export interface DataStorageContribution {
  id: string;
  pluginId: string;
  storageId: string;
  name: string;
  kind: "sqlite" | "postgres" | "ipfs" | "s3" | "custom" | string;
  capabilities: Record<string, unknown>;
  priority: number;
}

export interface DataCryptoContribution {
  id: string;
  pluginId: string;
  cryptoId: string;
  name: string;
  algs: string[];
  capabilities: Record<string, unknown>;
  priority: number;
}

export interface ComplianceAuditContribution {
  id: string;
  pluginId: string;
  auditId: string;
  name: string;
  kind: "syslog" | "file" | "splunk" | "siem" | "custom" | string;
  sinks: string[];
  priority: number;
}

interface RegistryState {
  spaces: SpaceContribution[];
  artifacts: ArtifactContribution[];
  slashCommands: SlashCommandContribution[];
  mentionSources: MentionSourceContribution[];
  statusBarWidgets: StatusBarWidgetContribution[];
  homeWidgets: HomeWidgetContribution[];
  composerSlots: ComposerSlotContribution[];
  brandTheme: BrandThemeContribution | null;
  brandIdentity: BrandIdentityContribution | null;
  llmProvider: LLMProviderContribution | null;
  authProvider: AuthProviderContribution | null;
  dataStorage: DataStorageContribution | null;
  dataCrypto: DataCryptoContribution | null;
  complianceAudit: ComplianceAuditContribution | null;
  loaded: boolean;
  lastRefresh: number;
}

// ==================== Helper ====================

function pluginApi(): any {
  const api: any = (globalThis as any).window?.electronAPI?.plugin;
  return api || null;
}

async function safeCall<T>(
  fn: () => Promise<{ success: boolean; [k: string]: any }>,
  field: string,
  fallback: T,
): Promise<T> {
  try {
    const result = await fn();
    if (result && result.success && result[field] !== undefined) {
      return result[field] as T;
    }
    return fallback;
  } catch (err) {
    logger.warn("[extensionRegistry] IPC 调用失败:", err);
    return fallback;
  }
}

// ==================== Store ====================

export const useExtensionRegistryStore = defineStore("extensionRegistry", {
  state: (): RegistryState => ({
    spaces: [],
    artifacts: [],
    slashCommands: [],
    mentionSources: [],
    statusBarWidgets: [],
    homeWidgets: [],
    composerSlots: [],
    brandTheme: null,
    brandIdentity: null,
    llmProvider: null,
    authProvider: null,
    dataStorage: null,
    dataCrypto: null,
    complianceAudit: null,
    loaded: false,
    lastRefresh: 0,
  }),

  getters: {
    // Space 相关
    getSpaceById: (state) => (id: string) =>
      state.spaces.find((s) => s.id === id) || null,

    // Artifact 渲染器查找
    getArtifactContribution: (state) => (type: string) =>
      state.artifacts.find((a) => a.type === type) || null,

    // Slash 命令按 trigger 前缀匹配
    matchSlashCommands: (state) => (prefix: string) => {
      const p = prefix.toLowerCase();
      return state.slashCommands.filter((c) =>
        c.trigger.toLowerCase().startsWith(p),
      );
    },

    // Mention 源按 @ 后缀匹配
    matchMentionSources: (state) => (_prefix: string) => {
      // 当前返回全部源，具体模糊匹配由源自身完成
      return state.mentionSources;
    },

    statusBarByPosition: (state) => (position: string) =>
      state.statusBarWidgets.filter((w) => w.position === position),
  },

  actions: {
    async refreshAll() {
      const api = pluginApi();
      if (!api) {
        logger.warn("[extensionRegistry] window.electronAPI.plugin 不可用");
        this.loaded = true;
        return;
      }

      const [
        spaces,
        artifacts,
        slashCommands,
        mentionSources,
        statusBarWidgets,
        homeWidgets,
        composerSlots,
        brandTheme,
        brandIdentity,
        llmProvider,
        authProvider,
        dataStorage,
        dataCrypto,
        complianceAudit,
      ] = await Promise.all([
        safeCall<SpaceContribution[]>(
          () => api.getRegisteredSpaces(),
          "spaces",
          [],
        ),
        safeCall<ArtifactContribution[]>(
          () => api.getRegisteredArtifacts(),
          "artifacts",
          [],
        ),
        safeCall<SlashCommandContribution[]>(
          () => api.getSlashCommands(),
          "commands",
          [],
        ),
        safeCall<MentionSourceContribution[]>(
          () => api.getMentionSources(),
          "sources",
          [],
        ),
        safeCall<StatusBarWidgetContribution[]>(
          () => api.getStatusBarWidgets({}),
          "widgets",
          [],
        ),
        safeCall<HomeWidgetContribution[]>(
          () => api.getHomeWidgets(),
          "widgets",
          [],
        ),
        safeCall<ComposerSlotContribution[]>(
          () => api.getComposerSlots({}),
          "slots",
          [],
        ),
        safeCall<BrandThemeContribution | null>(
          () => api.getActiveBrandTheme(),
          "theme",
          null,
        ),
        safeCall<BrandIdentityContribution | null>(
          () => api.getActiveBrandIdentity(),
          "identity",
          null,
        ),
        safeCall<LLMProviderContribution | null>(
          () => api.getActiveLLMProvider(),
          "provider",
          null,
        ),
        safeCall<AuthProviderContribution | null>(
          () => api.getActiveAuthProvider(),
          "provider",
          null,
        ),
        safeCall<DataStorageContribution | null>(
          () => api.getActiveDataStorage(),
          "storage",
          null,
        ),
        safeCall<DataCryptoContribution | null>(
          () => api.getActiveDataCrypto(),
          "crypto",
          null,
        ),
        safeCall<ComplianceAuditContribution | null>(
          () => api.getActiveComplianceAudit(),
          "audit",
          null,
        ),
      ]);

      this.spaces = spaces;
      this.artifacts = artifacts;
      this.slashCommands = slashCommands;
      this.mentionSources = mentionSources;
      this.statusBarWidgets = statusBarWidgets;
      this.homeWidgets = homeWidgets;
      this.composerSlots = composerSlots;
      this.brandTheme = brandTheme;
      this.brandIdentity = brandIdentity;
      this.llmProvider = llmProvider;
      this.authProvider = authProvider;
      this.dataStorage = dataStorage;
      this.dataCrypto = dataCrypto;
      this.complianceAudit = complianceAudit;
      this.loaded = true;
      this.lastRefresh = Date.now();
    },

    async refreshSpaces() {
      const api = pluginApi();
      if (!api) return;
      this.spaces = await safeCall<SpaceContribution[]>(
        () => api.getRegisteredSpaces(),
        "spaces",
        this.spaces,
      );
    },

    async refreshArtifacts() {
      const api = pluginApi();
      if (!api) return;
      this.artifacts = await safeCall<ArtifactContribution[]>(
        () => api.getRegisteredArtifacts(),
        "artifacts",
        this.artifacts,
      );
    },

    async refreshSlashCommands() {
      const api = pluginApi();
      if (!api) return;
      this.slashCommands = await safeCall<SlashCommandContribution[]>(
        () => api.getSlashCommands(),
        "commands",
        this.slashCommands,
      );
    },
  },
});

/**
 * SSO Store - Pinia 状态管理
 * 管理 SSO 单点登录的状态：提供者管理、会话管理、身份映射等
 *
 * @module sso-store
 * @version 1.0.0
 */

import { defineStore } from 'pinia';

// ==================== 类型定义 ====================

/**
 * SSO 提供者
 */
export interface SSOProvider {
  id: string;
  provider_type: 'saml' | 'oauth' | 'oidc';
  provider_name: string;
  enabled: boolean;
  config: string;
  created_at: number;
  updated_at?: number;
}

/**
 * SSO 会话
 */
export interface SSOSession {
  id: string;
  user_did: string;
  provider_id: string;
  expires_at: number;
  created_at: number;
}

/**
 * 身份映射
 */
export interface IdentityMapping {
  id: string;
  did: string;
  provider_id: string;
  sso_subject: string;
  sso_attributes?: string;
  verified: boolean;
  created_at: number;
}

/**
 * SSO Store 状态
 */
interface SSOState {
  providers: SSOProvider[];
  currentProvider: SSOProvider | null;
  sessions: SSOSession[];
  linkedIdentities: IdentityMapping[];
  loginUrl: string | null;
  loading: boolean;
  error: string | null;
}

// ==================== Store ====================

export const useSSOStore = defineStore('sso', {
  state: (): SSOState => ({
    // ==========================================
    // 提供者管理
    // ==========================================

    // SSO 提供者列表
    providers: [],

    // 当前选中的提供者
    currentProvider: null,

    // ==========================================
    // 会话管理
    // ==========================================

    // 活跃会话列表
    sessions: [],

    // ==========================================
    // 身份映射
    // ==========================================

    // 已关联的身份列表
    linkedIdentities: [],

    // ==========================================
    // 登录状态
    // ==========================================

    // SSO 登录 URL
    loginUrl: null,

    // ==========================================
    // 状态
    // ==========================================

    // 加载状态
    loading: false,

    // 错误信息
    error: null,
  }),

  getters: {
    /**
     * 启用的提供者列表
     */
    enabledProviders(): SSOProvider[] {
      return this.providers.filter((p) => p.enabled);
    },

    /**
     * 提供者数量
     */
    providerCount(): number {
      return this.providers.length;
    },

    /**
     * 活跃会话数量
     */
    activeSessionCount(): number {
      const now = Date.now();
      return this.sessions.filter((s) => s.expires_at > now).length;
    },

    /**
     * 已关联身份数量
     */
    linkedIdentityCount(): number {
      return this.linkedIdentities.length;
    },

    /**
     * 是否有已验证的身份映射
     */
    hasVerifiedIdentity(): boolean {
      return this.linkedIdentities.some((i) => i.verified);
    },

    /**
     * 按类型分组的提供者
     */
    providersByType(): Record<string, SSOProvider[]> {
      const grouped: Record<string, SSOProvider[]> = {};
      this.providers.forEach((p) => {
        if (!grouped[p.provider_type]) {
          grouped[p.provider_type] = [];
        }
        grouped[p.provider_type].push(p);
      });
      return grouped;
    },
  },

  actions: {
    // ==========================================
    // 提供者管理
    // ==========================================

    /**
     * 获取 SSO 提供者列表
     */
    async fetchProviders(): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:list-providers'
        );

        if (result.success) {
          this.providers = result.providers || [];
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 获取提供者列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 添加 SSO 提供者
     */
    async addProvider(data: Omit<SSOProvider, 'id' | 'created_at' | 'updated_at'>): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:add-provider',
          data
        );

        if (result.success && result.provider) {
          this.providers.push(result.provider);
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 添加提供者失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 更新 SSO 提供者
     */
    async updateProvider(id: string, updates: Partial<SSOProvider>): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:update-provider',
          { id, updates }
        );

        if (result.success) {
          const index = this.providers.findIndex((p) => p.id === id);
          if (index !== -1) {
            this.providers[index] = { ...this.providers[index], ...updates };
          }
          if (this.currentProvider?.id === id) {
            this.currentProvider = { ...this.currentProvider, ...updates };
          }
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 更新提供者失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 删除 SSO 提供者
     */
    async deleteProvider(id: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:delete-provider',
          { id }
        );

        if (result.success) {
          this.providers = this.providers.filter((p) => p.id !== id);
          if (this.currentProvider?.id === id) {
            this.currentProvider = null;
          }
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 删除提供者失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 测试 SSO 提供者连接
     */
    async testConnection(id: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:test-connection',
          { id }
        );

        return result;
      } catch (error) {
        console.error('[SSOStore] 测试连接失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 登录与登出
    // ==========================================

    /**
     * 发起 SSO 登录
     */
    async initiateLogin(providerId: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:initiate-login',
          { providerId }
        );

        if (result.success) {
          this.loginUrl = result.loginUrl || null;
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 发起登录失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 处理 SSO 回调
     */
    async handleCallback(providerId: string, callbackData: Record<string, any>): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:handle-callback',
          { providerId, callbackData }
        );

        if (result.success && result.session) {
          this.sessions.push(result.session);
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 处理回调失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * SSO 登出
     */
    async logout(sessionId: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:logout',
          { sessionId }
        );

        if (result.success) {
          this.sessions = this.sessions.filter((s) => s.id !== sessionId);
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 登出失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 会话管理
    // ==========================================

    /**
     * 获取用户的 SSO 会话列表
     */
    async fetchSessions(userDid: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:get-sessions',
          { userDid }
        );

        if (result.success) {
          this.sessions = result.sessions || [];
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 获取会话列表失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    // ==========================================
    // 身份映射
    // ==========================================

    /**
     * 关联身份
     */
    async linkIdentity(
      did: string,
      providerId: string,
      ssoSubject: string,
      attrs?: string
    ): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:link-identity',
          { did, providerId, ssoSubject, ssoAttributes: attrs }
        );

        if (result.success && result.identity) {
          this.linkedIdentities.push(result.identity);
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 关联身份失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 取消关联身份
     */
    async unlinkIdentity(did: string, providerId?: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:unlink-identity',
          { did, providerId }
        );

        if (result.success) {
          this.linkedIdentities = this.linkedIdentities.filter(
            (i) => !(i.did === did && i.provider_id === providerId)
          );
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 取消关联失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 获取已关联的身份列表
     */
    async fetchLinkedIdentities(did?: string): Promise<any> {
      this.loading = true;
      this.error = null;

      try {
        const result = await (window as any).electronAPI.invoke(
          'sso:get-linked-identities',
          { did: did || '' }
        );

        if (result.success) {
          this.linkedIdentities = result.identities || [];
        }

        return result;
      } catch (error) {
        console.error('[SSOStore] 获取已关联身份失败:', error);
        this.error = (error as Error).message;
        throw error;
      } finally {
        this.loading = false;
      }
    },

    /**
     * 验证身份关联（临时实现）
     */
    async verifyLink(linkId: string): Promise<any> {
      // TODO: 实现实际的验证逻辑
      console.warn('[SSOStore] verifyLink 临时实现，需要后续完善');
      return { success: true };
    },

    /**
     * 创建身份关联（临时实现，使用 linkIdentity）
     */
    async createLink(params: { did: string; providerId: string; ssoSubject: string; ssoAttributes?: string }): Promise<any> {
      return this.linkIdentity(
        params.did,
        params.providerId,
        params.ssoSubject,
        params.ssoAttributes
      );
    },

    // ==========================================
    // 辅助操作
    // ==========================================

    /**
     * 设置当前提供者
     */
    setCurrentProvider(provider: SSOProvider | null): void {
      this.currentProvider = provider;
    },

    /**
     * 清除登录 URL
     */
    clearLoginUrl(): void {
      this.loginUrl = null;
    },

    /**
     * 重置所有状态
     */
    reset(): void {
      this.$reset();
    },
  },
});

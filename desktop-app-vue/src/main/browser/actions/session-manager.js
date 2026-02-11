/**
 * SessionManager - 浏览器会话管理器
 *
 * 管理浏览器会话状态：
 * - Cookie 管理
 * - LocalStorage/SessionStorage
 * - 会话持久化和恢复
 * - 认证状态跟踪
 *
 * @module browser/actions/session-manager
 * @author ChainlessChain Team
 * @since v0.33.0
 */

const { EventEmitter } = require("events");

/**
 * Cookie SameSite 策略
 */
const SameSitePolicy = {
  STRICT: "Strict",
  LAX: "Lax",
  NONE: "None",
};

/**
 * 存储类型
 */
const StorageType = {
  COOKIE: "cookie",
  LOCAL_STORAGE: "localStorage",
  SESSION_STORAGE: "sessionStorage",
  INDEXED_DB: "indexedDB",
};

/**
 * 会话状态
 */
const SessionState = {
  ACTIVE: "active",
  EXPIRED: "expired",
  INVALID: "invalid",
  UNKNOWN: "unknown",
};

class SessionManager extends EventEmitter {
  /**
   * @param {Object} browserEngine - Browser engine instance
   * @param {Object} config - Configuration options
   */
  constructor(browserEngine = null, config = {}) {
    super();

    this.browserEngine = browserEngine;
    this.config = {
      enablePersistence: config.enablePersistence !== false,
      persistencePath: config.persistencePath || null,
      autoRefresh: config.autoRefresh || false,
      refreshInterval: config.refreshInterval || 300000, // 5 minutes
      trackAuthState: config.trackAuthState !== false,
      sensitivePatterns: config.sensitivePatterns || [
        /token/i,
        /session/i,
        /auth/i,
        /jwt/i,
        /bearer/i,
      ],
      ...config,
    };

    // 会话缓存
    this.sessions = new Map();

    // 认证状态跟踪
    this.authStates = new Map();

    // 刷新定时器
    this.refreshTimers = new Map();

    // 统计
    this.stats = {
      totalSessions: 0,
      activeSessions: 0,
      cookiesManaged: 0,
      storageOperations: 0,
    };
  }

  /**
   * 设置浏览器引擎
   * @param {Object} browserEngine
   */
  setBrowserEngine(browserEngine) {
    this.browserEngine = browserEngine;
  }

  // ==================== Cookie 管理 ====================

  /**
   * 获取所有 Cookies
   * @param {string} targetId - 标签页 ID
   * @param {Object} filter - 过滤条件
   * @returns {Promise<Object>}
   */
  async getCookies(targetId, filter = {}) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const context = page.context();
      let cookies = await context.cookies();

      // 应用过滤
      if (filter.domain) {
        cookies = cookies.filter((c) => c.domain.includes(filter.domain));
      }

      if (filter.name) {
        cookies = cookies.filter((c) =>
          c.name.toLowerCase().includes(filter.name.toLowerCase()),
        );
      }

      if (filter.secure !== undefined) {
        cookies = cookies.filter((c) => c.secure === filter.secure);
      }

      if (filter.httpOnly !== undefined) {
        cookies = cookies.filter((c) => c.httpOnly === filter.httpOnly);
      }

      this.stats.cookiesManaged += cookies.length;

      return {
        success: true,
        cookies,
        total: cookies.length,
      };
    } catch (error) {
      this.emit("error", { action: "getCookies", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 设置 Cookie
   * @param {string} targetId - 标签页 ID
   * @param {Object} cookie - Cookie 数据
   * @returns {Promise<Object>}
   */
  async setCookie(targetId, cookie) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const context = page.context();

      const cookieData = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || "/",
        expires: cookie.expires,
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
        sameSite: cookie.sameSite || SameSitePolicy.LAX,
      };

      await context.addCookies([cookieData]);

      this.stats.cookiesManaged++;
      this.emit("cookieSet", { targetId, cookie: cookieData });

      return { success: true, cookie: cookieData };
    } catch (error) {
      this.emit("error", { action: "setCookie", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除 Cookie
   * @param {string} targetId - 标签页 ID
   * @param {Object} filter - 删除条件
   * @returns {Promise<Object>}
   */
  async deleteCookies(targetId, filter = {}) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const context = page.context();

      // 获取匹配的 cookies
      const { cookies } = await this.getCookies(targetId, filter);

      // Playwright 通过设置过期时间来删除 cookies
      const deleteCookies = cookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
      }));

      await context.clearCookies();

      // 重新添加不需要删除的 cookies
      const allCookies = await context.cookies();
      const remainingCookies = allCookies.filter(
        (c) =>
          !deleteCookies.some(
            (d) => d.name === c.name && d.domain === c.domain,
          ),
      );

      if (remainingCookies.length > 0) {
        await context.addCookies(remainingCookies);
      }

      this.emit("cookiesDeleted", { targetId, count: deleteCookies.length });

      return { success: true, deleted: deleteCookies.length };
    } catch (error) {
      this.emit("error", { action: "deleteCookies", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 清除所有 Cookies
   * @param {string} targetId - 标签页 ID
   * @returns {Promise<Object>}
   */
  async clearAllCookies(targetId) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const context = page.context();
      await context.clearCookies();

      this.emit("cookiesCleared", { targetId });

      return { success: true };
    } catch (error) {
      this.emit("error", { action: "clearAllCookies", error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ==================== Storage 管理 ====================

  /**
   * 获取 LocalStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名
   * @returns {Promise<Object>}
   */
  async getLocalStorage(targetId, key = null) {
    return this._getStorage(targetId, "localStorage", key);
  }

  /**
   * 设置 LocalStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 键名
   * @param {string} value - 值
   * @returns {Promise<Object>}
   */
  async setLocalStorage(targetId, key, value) {
    return this._setStorage(targetId, "localStorage", key, value);
  }

  /**
   * 删除 LocalStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名，不传则清除全部
   * @returns {Promise<Object>}
   */
  async removeLocalStorage(targetId, key = null) {
    return this._removeStorage(targetId, "localStorage", key);
  }

  /**
   * 获取 SessionStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名
   * @returns {Promise<Object>}
   */
  async getSessionStorage(targetId, key = null) {
    return this._getStorage(targetId, "sessionStorage", key);
  }

  /**
   * 设置 SessionStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 键名
   * @param {string} value - 值
   * @returns {Promise<Object>}
   */
  async setSessionStorage(targetId, key, value) {
    return this._setStorage(targetId, "sessionStorage", key, value);
  }

  /**
   * 删除 SessionStorage
   * @param {string} targetId - 标签页 ID
   * @param {string} key - 可选的键名
   * @returns {Promise<Object>}
   */
  async removeSessionStorage(targetId, key = null) {
    return this._removeStorage(targetId, "sessionStorage", key);
  }

  /**
   * 通用存储获取
   * @private
   */
  async _getStorage(targetId, storageType, key) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const result = await page.evaluate(
        ([type, k]) => {
          const storage =
            type === "localStorage" ? localStorage : sessionStorage;

          if (k) {
            return { [k]: storage.getItem(k) };
          }

          const data = {};
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            data[key] = storage.getItem(key);
          }
          return data;
        },
        [storageType, key],
      );

      this.stats.storageOperations++;

      return {
        success: true,
        type: storageType,
        data: result,
        count: Object.keys(result).length,
      };
    } catch (error) {
      this.emit("error", { action: `get${storageType}`, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 通用存储设置
   * @private
   */
  async _setStorage(targetId, storageType, key, value) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      await page.evaluate(
        ([type, k, v]) => {
          const storage =
            type === "localStorage" ? localStorage : sessionStorage;
          storage.setItem(k, v);
        },
        [storageType, key, value],
      );

      this.stats.storageOperations++;
      this.emit("storageSet", { targetId, type: storageType, key });

      return { success: true, type: storageType, key };
    } catch (error) {
      this.emit("error", { action: `set${storageType}`, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 通用存储删除
   * @private
   */
  async _removeStorage(targetId, storageType, key) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      await page.evaluate(
        ([type, k]) => {
          const storage =
            type === "localStorage" ? localStorage : sessionStorage;

          if (k) {
            storage.removeItem(k);
          } else {
            storage.clear();
          }
        },
        [storageType, key],
      );

      this.stats.storageOperations++;
      this.emit("storageRemoved", { targetId, type: storageType, key });

      return { success: true, type: storageType, key };
    } catch (error) {
      this.emit("error", {
        action: `remove${storageType}`,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  // ==================== 会话管理 ====================

  /**
   * 保存会话快照
   * @param {string} targetId - 标签页 ID
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>}
   */
  async saveSession(targetId, sessionId = null) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      const id = sessionId || `session_${Date.now()}`;

      // 获取 cookies
      const context = page.context();
      const cookies = await context.cookies();

      // 获取 storage
      const storageData = await page.evaluate(() => {
        const local = {};
        const session = {};

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          local[key] = localStorage.getItem(key);
        }

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          session[key] = sessionStorage.getItem(key);
        }

        return { localStorage: local, sessionStorage: session };
      });

      // 获取 URL
      const url = page.url();

      const sessionData = {
        id,
        targetId,
        url,
        cookies,
        localStorage: storageData.localStorage,
        sessionStorage: storageData.sessionStorage,
        timestamp: Date.now(),
        state: SessionState.ACTIVE,
      };

      this.sessions.set(id, sessionData);
      this.stats.totalSessions++;
      this.stats.activeSessions++;

      this.emit("sessionSaved", { sessionId: id });

      return { success: true, sessionId: id, session: sessionData };
    } catch (error) {
      this.emit("error", { action: "saveSession", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 恢复会话
   * @param {string} targetId - 标签页 ID
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>}
   */
  async restoreSession(targetId, sessionId) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    try {
      const context = page.context();

      // 恢复 cookies
      if (session.cookies && session.cookies.length > 0) {
        await context.clearCookies();
        await context.addCookies(session.cookies);
      }

      // 导航到保存的 URL
      if (session.url) {
        await page.goto(session.url, { waitUntil: "domcontentloaded" });
      }

      // 恢复 localStorage
      if (session.localStorage) {
        await page.evaluate((data) => {
          localStorage.clear();
          for (const [key, value] of Object.entries(data)) {
            localStorage.setItem(key, value);
          }
        }, session.localStorage);
      }

      // 恢复 sessionStorage
      if (session.sessionStorage) {
        await page.evaluate((data) => {
          sessionStorage.clear();
          for (const [key, value] of Object.entries(data)) {
            sessionStorage.setItem(key, value);
          }
        }, session.sessionStorage);
      }

      this.emit("sessionRestored", { sessionId });

      return { success: true, sessionId, url: session.url };
    } catch (error) {
      this.emit("error", { action: "restoreSession", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除会话
   * @param {string} sessionId - 会话 ID
   * @returns {Object}
   */
  deleteSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }

    this.sessions.delete(sessionId);
    this.stats.activeSessions--;

    // 清理刷新定时器
    if (this.refreshTimers.has(sessionId)) {
      clearInterval(this.refreshTimers.get(sessionId));
      this.refreshTimers.delete(sessionId);
    }

    this.emit("sessionDeleted", { sessionId });

    return { success: true };
  }

  /**
   * 列出所有会话
   * @returns {Array}
   */
  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      url: s.url,
      timestamp: s.timestamp,
      state: s.state,
      cookiesCount: s.cookies?.length || 0,
    }));
  }

  // ==================== 认证状态跟踪 ====================

  /**
   * 检测认证状态
   * @param {string} targetId - 标签页 ID
   * @param {Object} indicators - 认证指标
   * @returns {Promise<Object>}
   */
  async detectAuthState(targetId, indicators = {}) {
    if (!this.browserEngine) {
      return { success: false, error: "Browser engine not set" };
    }

    const page = this.browserEngine.getPage(targetId);
    if (!page) {
      return { success: false, error: `Page not found: ${targetId}` };
    }

    try {
      // 默认指标
      const checks = {
        logoutButton:
          indicators.logoutSelector ||
          '[href*="logout"], [data-logout], .logout-btn',
        loginForm:
          indicators.loginSelector ||
          'form[action*="login"], #login-form, .login-form',
        userElement:
          indicators.userSelector || ".user-name, .user-info, [data-user]",
        authCookie: indicators.authCookieName || null,
      };

      const result = await page.evaluate((selectors) => {
        const hasLogout = !!document.querySelector(selectors.logoutButton);
        const hasLoginForm = !!document.querySelector(selectors.loginForm);
        const hasUserElement = !!document.querySelector(selectors.userElement);

        return {
          hasLogout,
          hasLoginForm,
          hasUserElement,
        };
      }, checks);

      // 检查认证 cookie
      if (checks.authCookie) {
        const { cookies } = await this.getCookies(targetId, {
          name: checks.authCookie,
        });
        result.hasAuthCookie = cookies.length > 0;
      }

      // 判断状态
      let state = SessionState.UNKNOWN;
      if (result.hasLogout || result.hasUserElement) {
        state = SessionState.ACTIVE;
      } else if (result.hasLoginForm) {
        state = SessionState.EXPIRED;
      }

      // 更新跟踪
      this.authStates.set(targetId, {
        state,
        checks: result,
        timestamp: Date.now(),
      });

      this.emit("authStateDetected", { targetId, state, checks: result });

      return { success: true, state, checks: result };
    } catch (error) {
      this.emit("error", { action: "detectAuthState", error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取认证状态
   * @param {string} targetId - 标签页 ID
   * @returns {Object}
   */
  getAuthState(targetId) {
    return this.authStates.get(targetId) || { state: SessionState.UNKNOWN };
  }

  // ==================== 统计和清理 ====================

  /**
   * 获取统计
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      sessionCount: this.sessions.size,
      trackedAuthStates: this.authStates.size,
    };
  }

  /**
   * 重置统计
   */
  resetStats() {
    this.stats = {
      totalSessions: 0,
      activeSessions: 0,
      cookiesManaged: 0,
      storageOperations: 0,
    };
    this.emit("statsReset");
  }

  /**
   * 清理过期会话
   * @param {number} maxAge - 最大年龄（毫秒）
   * @returns {Object}
   */
  cleanupExpiredSessions(maxAge = 86400000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.timestamp > maxAge) {
        this.deleteSession(id);
        cleaned++;
      }
    }

    return { success: true, cleaned };
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清理所有刷新定时器
    for (const timer of this.refreshTimers.values()) {
      clearInterval(timer);
    }
    this.refreshTimers.clear();

    this.sessions.clear();
    this.authStates.clear();
  }
}

// 单例
let sessionManagerInstance = null;

function getSessionManager(browserEngine, config) {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(browserEngine, config);
  } else if (browserEngine) {
    sessionManagerInstance.setBrowserEngine(browserEngine);
  }
  return sessionManagerInstance;
}

module.exports = {
  SessionManager,
  SameSitePolicy,
  StorageType,
  SessionState,
  getSessionManager,
};

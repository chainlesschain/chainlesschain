/**
 * Alert Manager — Multi-Channel Alerting & Escalation (v3.3)
 *
 * Routes alerts through multiple channels with escalation:
 * - Webhook: HTTP POST to configured URLs
 * - Email: SMTP-based (placeholder for Phase B integration)
 * - IM: Instant messaging (Slack/DingTalk webhook)
 * - In-app: Electron notification + IPC event
 *
 * Escalation chain: P3 → P2 → P1 → P0 with configurable timeouts.
 * Alert deduplication and rate limiting.
 *
 * @module ai-engine/cowork/alert-manager
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const ALERT_CHANNELS = {
  WEBHOOK: "webhook",
  EMAIL: "email",
  IM: "im",
  IN_APP: "in-app",
};

const ALERT_STATUS = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
  SUPPRESSED: "suppressed",
  ESCALATED: "escalated",
};

const ESCALATION_CHAIN = {
  P3: { timeout: 300000, escalateTo: "P2" },
  P2: { timeout: 180000, escalateTo: "P1" },
  P1: { timeout: 60000, escalateTo: "P0" },
  P0: { timeout: 0, escalateTo: null },
};

const DEFAULT_CONFIG = {
  enabled: true,
  defaultChannels: ["in-app"],
  webhookUrls: [],
  emailRecipients: [],
  imWebhookUrl: null,
  rateLimitPerMinute: 30,
  deduplicationWindowMs: 60000,
  enableEscalation: true,
  escalationChain: { ...ESCALATION_CHAIN },
  alertRetentionDays: 30,
  templates: {
    incident: "[{severity}] {title} — {description}",
    remediation: "自动修复 {status}: {playbook} (耗时 {duration}ms)",
    escalation: "⚠️ 升级 [{from}→{to}]: {title}",
  },
};

// ============================================================
// AlertManager Class
// ============================================================

class AlertManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.config = { ...DEFAULT_CONFIG };
    this.alertHistory = [];
    this.deduplicationCache = new Map();
    this.rateLimitCounter = 0;
    this.rateLimitResetAt = 0;
    this.escalationTimers = new Map();
    this.stats = {
      totalAlerts: 0,
      sentCount: 0,
      failedCount: 0,
      suppressedCount: 0,
      escalatedCount: 0,
      channelDistribution: {},
    };
  }

  /**
   * Initialize
   * @param {Object} db - Database instance
   * @param {Object} [config] - Override default config
   */
  async initialize(db, config = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    Object.assign(this.config, config);

    // Reset rate limit counter every minute
    this._rateLimitInterval = setInterval(() => {
      this.rateLimitCounter = 0;
    }, 60000);

    logger.info("[AlertManager] Initialized");
    this.initialized = true;
  }

  /**
   * Clean up timers
   */
  destroy() {
    if (this._rateLimitInterval) {
      clearInterval(this._rateLimitInterval);
      this._rateLimitInterval = null;
    }
    for (const timer of this.escalationTimers.values()) {
      clearTimeout(timer);
    }
    this.escalationTimers.clear();
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Send an alert through configured channels
   * @param {Object} alert - Alert data
   * @param {string} alert.type - Alert type (incident, remediation, escalation, custom)
   * @param {string} [alert.severity] - Severity level (P0-P3)
   * @param {string} [alert.title] - Alert title
   * @param {string} [alert.description] - Alert description
   * @param {Array} [alert.channels] - Override channels to use
   * @param {Object} [alert.metadata] - Additional metadata
   * @returns {Object} Send result
   */
  async sendAlert(alert = {}) {
    if (!this.initialized || !this.config.enabled) {
      return { status: ALERT_STATUS.SUPPRESSED, reason: "disabled" };
    }

    this.stats.totalAlerts++;

    // Rate limiting
    if (this.rateLimitCounter >= this.config.rateLimitPerMinute) {
      this.stats.suppressedCount++;
      return { status: ALERT_STATUS.SUPPRESSED, reason: "rate-limited" };
    }

    // Deduplication
    const dedupeKey = this._getDedupeKey(alert);
    if (this._isDuplicate(dedupeKey)) {
      this.stats.suppressedCount++;
      return { status: ALERT_STATUS.SUPPRESSED, reason: "duplicate" };
    }

    this.rateLimitCounter++;
    this._markSent(dedupeKey);

    const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const channels = alert.channels || this.config.defaultChannels;
    const message = this._formatMessage(alert);

    const results = {};
    let anySuccess = false;

    for (const channel of channels) {
      try {
        const result = await this._sendToChannel(channel, {
          ...alert,
          id: alertId,
          message,
        });
        results[channel] = result;
        if (result.success) {
          anySuccess = true;
        }

        this.stats.channelDistribution[channel] =
          (this.stats.channelDistribution[channel] || 0) + 1;
      } catch (error) {
        results[channel] = { success: false, error: error.message };
      }
    }

    const status = anySuccess ? ALERT_STATUS.SENT : ALERT_STATUS.FAILED;

    if (anySuccess) {
      this.stats.sentCount++;
    } else {
      this.stats.failedCount++;
    }

    // Record
    const record = {
      id: alertId,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      message,
      channels,
      status,
      results,
      timestamp: new Date().toISOString(),
    };

    this.alertHistory.unshift(record);
    if (this.alertHistory.length > 200) {
      this.alertHistory.length = 200;
    }

    // Set up escalation timer
    if (
      this.config.enableEscalation &&
      alert.severity &&
      alert.type === "incident"
    ) {
      this._setupEscalation(alertId, alert);
    }

    this.emit("alert:sent", record);

    logger.info(
      `[AlertManager] Alert ${alertId}: ${status} via [${channels.join(",")}]`,
    );

    return { alertId, status, channels: results };
  }

  /**
   * Cancel escalation for an incident
   * @param {string} incidentId
   */
  cancelEscalation(incidentId) {
    const timer = this.escalationTimers.get(incidentId);
    if (timer) {
      clearTimeout(timer);
      this.escalationTimers.delete(incidentId);
      logger.info(`[AlertManager] Escalation cancelled: ${incidentId}`);
    }
  }

  /**
   * Get alert history
   * @param {Object} [filter]
   * @param {string} [filter.type]
   * @param {string} [filter.severity]
   * @param {number} [filter.limit=50]
   * @returns {Array}
   */
  getAlerts(filter = {}) {
    let results = this.alertHistory;

    if (filter.type) {
      results = results.filter((a) => a.type === filter.type);
    }
    if (filter.severity) {
      results = results.filter((a) => a.severity === filter.severity);
    }

    return results.slice(0, filter.limit || 50);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      historySize: this.alertHistory.length,
      activeEscalations: this.escalationTimers.size,
    };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  /**
   * Configure alert channels
   * @param {Object} channelConfig
   */
  configureAlerts(channelConfig = {}) {
    if (channelConfig.webhookUrls) {
      this.config.webhookUrls = channelConfig.webhookUrls;
    }
    if (channelConfig.emailRecipients) {
      this.config.emailRecipients = channelConfig.emailRecipients;
    }
    if (channelConfig.imWebhookUrl) {
      this.config.imWebhookUrl = channelConfig.imWebhookUrl;
    }
    if (channelConfig.defaultChannels) {
      this.config.defaultChannels = channelConfig.defaultChannels;
    }
    return this.getConfig();
  }

  // ============================================================
  // Channel Senders
  // ============================================================

  async _sendToChannel(channel, alert) {
    switch (channel) {
      case ALERT_CHANNELS.WEBHOOK:
        return this._sendWebhook(alert);
      case ALERT_CHANNELS.EMAIL:
        return this._sendEmail(alert);
      case ALERT_CHANNELS.IM:
        return this._sendIM(alert);
      case ALERT_CHANNELS.IN_APP:
        return this._sendInApp(alert);
      default:
        return { success: false, error: `Unknown channel: ${channel}` };
    }
  }

  async _sendWebhook(alert) {
    const urls = this.config.webhookUrls;
    if (!urls || urls.length === 0) {
      return { success: false, error: "No webhook URLs configured" };
    }

    const results = [];
    for (const url of urls) {
      try {
        // Use built-in fetch or http module
        const payload = {
          alertId: alert.id,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          timestamp: new Date().toISOString(),
        };

        // Emit event for external sender to handle
        this.emit("webhook:send", { url, payload });
        results.push({ url, success: true, simulated: true });
      } catch (error) {
        results.push({ url, success: false, error: error.message });
      }
    }

    return { success: results.some((r) => r.success), results };
  }

  async _sendEmail(alert) {
    if (
      !this.config.emailRecipients ||
      this.config.emailRecipients.length === 0
    ) {
      return { success: false, error: "No email recipients configured" };
    }

    // Emit event — actual email sending would be handled by an external service
    this.emit("email:send", {
      to: this.config.emailRecipients,
      subject: `[${alert.severity || "INFO"}] ${alert.title || alert.type}`,
      body: alert.message,
    });

    return { success: true, simulated: true };
  }

  async _sendIM(alert) {
    if (!this.config.imWebhookUrl) {
      return { success: false, error: "No IM webhook URL configured" };
    }

    this.emit("im:send", {
      url: this.config.imWebhookUrl,
      message: alert.message,
      severity: alert.severity,
    });

    return { success: true, simulated: true };
  }

  async _sendInApp(alert) {
    // Emit IPC-friendly event for renderer process
    this.emit("in-app:notify", {
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title || alert.type,
      message: alert.message,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  // ============================================================
  // Escalation
  // ============================================================

  _setupEscalation(alertId, alert) {
    const severity = alert.severity;
    const chain = this.config.escalationChain[severity];
    if (!chain || !chain.escalateTo || chain.timeout <= 0) {
      return;
    }

    const incidentId = alert.incidentId || alertId;

    // Clear existing timer for this incident
    this.cancelEscalation(incidentId);

    const timer = setTimeout(() => {
      this.escalationTimers.delete(incidentId);
      this.stats.escalatedCount++;

      logger.warn(
        `[AlertManager] Escalating ${incidentId}: ${severity} → ${chain.escalateTo}`,
      );

      // Send escalation alert
      this.sendAlert({
        type: "escalation",
        severity: chain.escalateTo,
        title: alert.title || "Unresolved incident",
        description: `Escalated from ${severity} to ${chain.escalateTo} — incident unresolved after ${chain.timeout / 1000}s`,
        incidentId,
        channels: this.config.defaultChannels,
        metadata: {
          originalSeverity: severity,
          escalatedTo: chain.escalateTo,
          originalAlertId: alertId,
        },
      });

      this.emit("alert:escalated", {
        alertId,
        incidentId,
        from: severity,
        to: chain.escalateTo,
      });
    }, chain.timeout);

    this.escalationTimers.set(incidentId, timer);
  }

  // ============================================================
  // Deduplication & Formatting
  // ============================================================

  _getDedupeKey(alert) {
    return `${alert.type}:${alert.severity || ""}:${alert.title || ""}:${alert.incidentId || ""}`;
  }

  _isDuplicate(key) {
    const lastSent = this.deduplicationCache.get(key);
    if (!lastSent) {
      return false;
    }
    return Date.now() - lastSent < this.config.deduplicationWindowMs;
  }

  _markSent(key) {
    this.deduplicationCache.set(key, Date.now());

    // Clean old entries
    if (this.deduplicationCache.size > 500) {
      const cutoff = Date.now() - this.config.deduplicationWindowMs;
      for (const [k, v] of this.deduplicationCache) {
        if (v < cutoff) {
          this.deduplicationCache.delete(k);
        }
      }
    }
  }

  _formatMessage(alert) {
    const template =
      this.config.templates[alert.type] || "{title}: {description}";

    return template
      .replace("{severity}", alert.severity || "INFO")
      .replace("{title}", alert.title || alert.type || "Alert")
      .replace("{description}", alert.description || "")
      .replace("{status}", alert.status || "")
      .replace("{playbook}", alert.playbook || "")
      .replace("{duration}", String(alert.duration || 0))
      .replace("{from}", alert.metadata?.originalSeverity || "")
      .replace("{to}", alert.metadata?.escalatedTo || "");
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getAlertManager() {
  if (!instance) {
    instance = new AlertManager();
  }
  return instance;
}

module.exports = {
  AlertManager,
  getAlertManager,
  ALERT_CHANNELS,
  ALERT_STATUS,
};

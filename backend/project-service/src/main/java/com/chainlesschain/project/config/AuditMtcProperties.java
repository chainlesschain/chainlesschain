package com.chainlesschain.project.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Audit MTC double-track gradual rollout config (Q-ENG-2 decision).
 *
 * <p>When {@code enabled=false} (default), the audit pipeline behaves exactly
 * as before — operation logs are written to PostgreSQL via OperationLogService
 * and nothing else happens. Setting {@code enabled=true} activates a
 * fire-and-forget bridge that ALSO calls {@code cc audit mtc emit} for each
 * saved log, layering the MTC double-track on top without disturbing the
 * existing path.
 *
 * <p>Gradual rollout is controlled by {@link #tenantAllowList} — when set,
 * the bridge only fires for those tenant ids. When empty, all tenants are
 * eligible (subject to {@link #enabled}).
 *
 * <p>Compliance background: Q-COMP-1 (等保三级) + Q-COMP-2 (T/ZGCMCA 023—2025)
 * legal sign-off received 2026-05-01. Tenants enable explicitly per their copy
 * of the sign-off — this config is the per-deployment switch.
 *
 * <p>Maps to {@code audit.mtc.*} keys in {@code application.yml}.
 */
@Component
@ConfigurationProperties(prefix = "audit.mtc")
public class AuditMtcProperties {

    /** Master switch. Default false — no behavior change unless explicitly enabled. */
    private boolean enabled = false;

    /** Path to the {@code cc} (chainlesschain) CLI. Default looks up on PATH. */
    private String cliPath = "cc";

    /** Namespace prefix passed to {@code cc audit mtc emit}. */
    private String namespacePrefix = "mtc/v1/audit/backend";

    /** MTCA issuer string. */
    private String issuer = "mtca:cc:audit-backend";

    /** Subprocess timeout (ms). emit should be sub-second; this caps misbehavior. */
    private long timeoutMs = 5000L;

    /**
     * Tenant id allow-list. Empty = all tenants eligible (when enabled=true).
     * Non-empty = only listed tenants get bridged (other tenants behave as enabled=false).
     */
    private Set<String> tenantAllowList = new HashSet<>();

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public String getCliPath() { return cliPath; }
    public void setCliPath(String cliPath) { this.cliPath = cliPath; }

    public String getNamespacePrefix() { return namespacePrefix; }
    public void setNamespacePrefix(String namespacePrefix) { this.namespacePrefix = namespacePrefix; }

    public String getIssuer() { return issuer; }
    public void setIssuer(String issuer) { this.issuer = issuer; }

    public long getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(long timeoutMs) { this.timeoutMs = timeoutMs; }

    public Set<String> getTenantAllowList() { return tenantAllowList; }
    public void setTenantAllowList(Set<String> tenantAllowList) {
        this.tenantAllowList = tenantAllowList == null ? new HashSet<>() : tenantAllowList;
    }

    /**
     * Returns true when the bridge should fire for the given tenant id.
     * Honors {@link #enabled} as the master gate, then either the empty
     * allow-list (= all tenants) or membership.
     *
     * @param tenantId nullable; null tenants only pass when allow-list is empty
     * @return true if the bridge should be invoked
     */
    public boolean shouldBridge(String tenantId) {
        if (!enabled) return false;
        if (tenantAllowList.isEmpty()) return true;
        return tenantId != null && tenantAllowList.contains(tenantId);
    }

    /** Defensive read — returned set is unmodifiable. Used by status endpoints. */
    public Set<String> getTenantAllowListView() {
        return Collections.unmodifiableSet(tenantAllowList);
    }
}

package com.chainlesschain.project.service;

import com.chainlesschain.project.config.AuditMtcProperties;
import com.chainlesschain.project.entity.OperationLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Q-ENG-2 audit MTC double-track bridge.
 *
 * <p>Spawns {@code cc audit mtc emit} for each operation log when the feature
 * flag and tenant allow-list permit. Fire-and-forget: failures are logged but
 * never thrown — the main PostgreSQL write path is authoritative; MTC is the
 * additional finality layer.
 *
 * <p>Subprocess invocation rather than in-process Java because:
 *   <ul>
 *     <li>The CLI owns the audit-mtc/keys/ directory + Ed25519 signer
 *         (single source of truth for trust anchors)</li>
 *     <li>Reusing the existing scaffold (already test-covered at 22 unit +
 *         5 integration + 6 e2e) is lower risk than reimplementing</li>
 *     <li>Crash isolation — a CLI bug can't take down the request thread</li>
 *   </ul>
 *
 * <p>Performance: each emit is a process spawn ({@code O(50ms)} cold start
 * on Linux/macOS, slower on Windows). Already async via {@link Async}, so
 * the request thread is never blocked. For high-throughput tenants, this
 * may need batching — left for a follow-up phase if telemetry shows pressure.
 */
@Service
public class AuditMtcBridgeService {

    private static final Logger log = LoggerFactory.getLogger(AuditMtcBridgeService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final AuditMtcProperties props;
    /**
     * Optional: callback invoked when emit succeeds with the parsed event_id.
     * OperationLogService can wire this to persist the event_id back onto
     * the OperationLog row so the UI can render a per-row "待批次关闭" badge.
     * Kept opt-in (Consumer-style) to preserve fire-and-forget semantics —
     * if the callback throws, it's caught and never affects the main flow.
     */
    private volatile EmitCallback emitCallback;

    public AuditMtcBridgeService(AuditMtcProperties props) {
        this.props = props;
    }

    /** Set after construction by OperationLogService.afterPropertiesSet (avoids circular dep). */
    public void setEmitCallback(EmitCallback cb) {
        this.emitCallback = cb;
    }

    /** Functional interface for the post-emit hook. */
    @FunctionalInterface
    public interface EmitCallback {
        void onEmitted(OperationLog opLog, String eventId, String stagingPath);
    }

    /**
     * Forward an operation log to the MTC double-track.
     * Returns silently when the bridge is disabled for this tenant.
     *
     * @param opLog the operation log just persisted
     */
    @Async
    public void emitForOperationLog(OperationLog opLog) {
        if (opLog == null) return;
        // We don't have a tenant id on the entity — use userId as the
        // tenant proxy until multi-tenant scoping lands. Allow-list = empty
        // means all-tenants-eligible, so this is forward-compatible.
        String tenantId = opLog.getUserId();
        if (!props.shouldBridge(tenantId)) {
            return;
        }

        try {
            invokeCli(opLog);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("audit-mtc bridge interrupted for log id={}", opLog.getId());
        } catch (Exception ex) {
            // Never escalate — operation log is already saved to PostgreSQL.
            log.warn(
                "audit-mtc bridge failed for log id={} (continuing — main path is authoritative): {}",
                opLog.getId(), ex.getMessage()
            );
        }
    }

    private void invokeCli(OperationLog opLog) throws IOException, InterruptedException {
        List<String> cmd = buildCliCommand(opLog);
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);

        Process proc = pb.start();

        // Capture stdout so we can extract the event_id on success.
        StringBuilder out = new StringBuilder();
        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                out.append(line).append('\n');
            }
        }

        boolean finished = proc.waitFor(props.getTimeoutMs(), TimeUnit.MILLISECONDS);
        if (!finished) {
            proc.destroyForcibly();
            log.warn(
                "audit-mtc bridge timed out after {}ms for log id={}",
                props.getTimeoutMs(), opLog.getId()
            );
            return;
        }
        int exit = proc.exitValue();
        if (exit != 0) {
            log.warn(
                "audit-mtc bridge non-zero exit {} for log id={}",
                exit, opLog.getId()
            );
            return;
        }

        // Parse `cc audit mtc emit --json` output → { ok, event_id, path } and
        // hand the event_id off to the optional callback. We never rethrow —
        // the audit log row is already in PostgreSQL whether the badge wires
        // up or not.
        Map<String, String> emitResult = parseEmitOutput(out.toString());
        if (!emitResult.isEmpty() && emitCallback != null) {
            try {
                emitCallback.onEmitted(opLog,
                    emitResult.get("event_id"),
                    emitResult.get("staging_path")
                );
            } catch (Exception cbErr) {
                log.warn(
                    "audit-mtc bridge emit callback threw for log id={}: {}",
                    opLog.getId(), cbErr.getMessage()
                );
            }
        }
    }

    /**
     * Extract event_id + staging path from `cc audit mtc emit --json` stdout.
     * Returns empty map when output isn't parseable JSON or doesn't carry
     * the expected fields (silent — caller logs).
     */
    Map<String, String> parseEmitOutput(String stdout) {
        Map<String, String> result = new HashMap<>();
        if (stdout == null || stdout.isEmpty()) return result;
        try {
            JsonNode root = JSON.readTree(stdout);
            if (root == null || !root.isObject()) return result;
            JsonNode okNode = root.get("ok");
            if (okNode == null || !okNode.asBoolean()) return result;
            JsonNode eventId = root.get("event_id");
            if (eventId != null && eventId.isTextual()) {
                result.put("event_id", eventId.asText());
            }
            JsonNode pathNode = root.get("path");
            if (pathNode != null && pathNode.isTextual()) {
                result.put("staging_path", pathNode.asText());
            }
        } catch (Exception _err) {
            // Best-effort parse — unknown output shape is non-fatal
        }
        return result;
    }

    /**
     * Build the {@code cc audit mtc emit} argv. Visible for testing — the
     * test suite asserts the mapping rather than running the subprocess.
     */
    List<String> buildCliCommand(OperationLog opLog) {
        List<String> cmd = new ArrayList<>();
        cmd.add(props.getCliPath());
        cmd.add("audit");
        cmd.add("mtc");
        cmd.add("emit");
        cmd.add("--type");
        cmd.add(safeArg(opLog.getModule(), "system"));
        cmd.add("--operation");
        cmd.add(safeArg(opLog.getOperationType(), "OTHER"));
        if (opLog.getUserId() != null && !opLog.getUserId().isEmpty()) {
            cmd.add("--actor");
            cmd.add(opLog.getUserId());
        }
        if (opLog.getRequestUrl() != null && !opLog.getRequestUrl().isEmpty()) {
            cmd.add("--target");
            cmd.add(opLog.getRequestUrl());
        }
        cmd.add("--risk-level");
        cmd.add(mapRiskLevel(opLog));
        cmd.add("--json");
        return cmd;
    }

    private String safeArg(String value, String fallback) {
        if (value == null || value.isEmpty()) return fallback;
        return value;
    }

    private String mapRiskLevel(OperationLog opLog) {
        // Failed operations are at minimum medium risk; DELETE is high.
        boolean failed = opLog.getStatus() != null && !"SUCCESS".equalsIgnoreCase(opLog.getStatus());
        boolean destructive = "DELETE".equalsIgnoreCase(opLog.getOperationType());
        if (failed && destructive) return "high";
        if (failed || destructive) return "medium";
        return "low";
    }

    /** Snapshot for status endpoints. */
    public AuditMtcBridgeStatus snapshot() {
        return new AuditMtcBridgeStatus(
            props.isEnabled(),
            props.getNamespacePrefix(),
            props.getIssuer(),
            props.getTimeoutMs(),
            props.getTenantAllowListView()
        );
    }

    /** Read-only snapshot of bridge config. */
    public record AuditMtcBridgeStatus(
        boolean enabled,
        String namespacePrefix,
        String issuer,
        long timeoutMs,
        java.util.Set<String> tenantAllowList
    ) {}
}

package com.chainlesschain.project.service;

import com.chainlesschain.project.config.AuditMtcProperties;
import com.chainlesschain.project.entity.OperationLog;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link AuditMtcBridgeService}.
 *
 * <p>The CLI subprocess invocation isn't exercised here (that's an integration
 * concern). This suite locks down the pure logic: feature flag gating,
 * tenant allow-list, argv mapping, risk-level derivation.
 */
class AuditMtcBridgeServiceTest {

    private AuditMtcProperties props;
    private AuditMtcBridgeService bridge;

    @BeforeEach
    void setUp() {
        props = new AuditMtcProperties();
        bridge = new AuditMtcBridgeService(props);
    }

    private OperationLog log(String userId, String module, String op) {
        OperationLog l = new OperationLog();
        l.setId("log-id-1");
        l.setUserId(userId);
        l.setModule(module);
        l.setOperationType(op);
        l.setStatus("SUCCESS");
        return l;
    }

    @Test
    void shouldBridge_returnsFalse_whenDisabled() {
        props.setEnabled(false);
        assertFalse(props.shouldBridge("any-tenant"));
    }

    @Test
    void shouldBridge_returnsTrue_whenEnabledAndAllowListEmpty() {
        props.setEnabled(true);
        assertTrue(props.shouldBridge("any-tenant"));
        assertTrue(props.shouldBridge(null));
    }

    @Test
    void shouldBridge_returnsTrueOnlyForAllowedTenants() {
        props.setEnabled(true);
        Set<String> allow = new HashSet<>();
        allow.add("tenant-a");
        allow.add("tenant-b");
        props.setTenantAllowList(allow);

        assertTrue(props.shouldBridge("tenant-a"));
        assertTrue(props.shouldBridge("tenant-b"));
        assertFalse(props.shouldBridge("tenant-c"));
        assertFalse(props.shouldBridge(null));
    }

    @Test
    void buildCliCommand_emitsCanonicalArgvShape() {
        OperationLog l = log("user-42", "auth", "LOGIN");
        l.setRequestUrl("/api/auth/login");

        List<String> argv = bridge.buildCliCommand(l);

        assertEquals("cc", argv.get(0));
        assertEquals("audit", argv.get(1));
        assertEquals("mtc", argv.get(2));
        assertEquals("emit", argv.get(3));

        // Verify --type / --operation are propagated
        int typeIdx = argv.indexOf("--type");
        assertTrue(typeIdx > 0);
        assertEquals("auth", argv.get(typeIdx + 1));

        int opIdx = argv.indexOf("--operation");
        assertEquals("LOGIN", argv.get(opIdx + 1));

        int actorIdx = argv.indexOf("--actor");
        assertEquals("user-42", argv.get(actorIdx + 1));

        int targetIdx = argv.indexOf("--target");
        assertEquals("/api/auth/login", argv.get(targetIdx + 1));

        // --json flag is always present so we can parse the response
        assertTrue(argv.contains("--json"));
    }

    @Test
    void buildCliCommand_omitsActorWhenUserIdMissing() {
        OperationLog l = log(null, "system", "QUERY");
        List<String> argv = bridge.buildCliCommand(l);
        assertFalse(argv.contains("--actor"));
    }

    @Test
    void buildCliCommand_fallsBackToSafeDefaults() {
        OperationLog l = log("u1", null, null);
        List<String> argv = bridge.buildCliCommand(l);
        int typeIdx = argv.indexOf("--type");
        assertEquals("system", argv.get(typeIdx + 1));
        int opIdx = argv.indexOf("--operation");
        assertEquals("OTHER", argv.get(opIdx + 1));
    }

    @Test
    void buildCliCommand_riskLevel_low_for_successful_non_destructive() {
        OperationLog l = log("u1", "data", "QUERY");
        l.setStatus("SUCCESS");
        List<String> argv = bridge.buildCliCommand(l);
        int idx = argv.indexOf("--risk-level");
        assertEquals("low", argv.get(idx + 1));
    }

    @Test
    void buildCliCommand_riskLevel_medium_for_failed_or_destructive() {
        OperationLog failed = log("u1", "data", "QUERY");
        failed.setStatus("FAILURE");
        int idx = bridge.buildCliCommand(failed).indexOf("--risk-level");
        assertEquals("medium", bridge.buildCliCommand(failed).get(idx + 1));

        OperationLog destructive = log("u1", "data", "DELETE");
        destructive.setStatus("SUCCESS");
        int didx = bridge.buildCliCommand(destructive).indexOf("--risk-level");
        assertEquals("medium", bridge.buildCliCommand(destructive).get(didx + 1));
    }

    @Test
    void buildCliCommand_riskLevel_high_for_failed_destructive() {
        OperationLog l = log("u1", "data", "DELETE");
        l.setStatus("FAILURE");
        int idx = bridge.buildCliCommand(l).indexOf("--risk-level");
        assertEquals("high", bridge.buildCliCommand(l).get(idx + 1));
    }

    @Test
    void buildCliCommand_respectsCustomCliPath() {
        props.setCliPath("/usr/local/bin/cc-prod");
        OperationLog l = log("u1", "auth", "LOGIN");
        List<String> argv = bridge.buildCliCommand(l);
        assertEquals("/usr/local/bin/cc-prod", argv.get(0));
    }

    @Test
    void emitForOperationLog_isNoOp_whenDisabled() {
        // When disabled, no exception even though cliPath would be invalid
        props.setEnabled(false);
        props.setCliPath("/no/such/binary/exists");
        OperationLog l = log("u1", "auth", "LOGIN");
        // Should not throw
        assertDoesNotThrow(() -> bridge.emitForOperationLog(l));
    }

    @Test
    void emitForOperationLog_isNoOp_whenTenantNotAllowed() {
        props.setEnabled(true);
        Set<String> allow = new HashSet<>();
        allow.add("only-this-tenant");
        props.setTenantAllowList(allow);
        props.setCliPath("/no/such/binary/exists"); // would fail if invoked
        OperationLog l = log("different-tenant", "auth", "LOGIN");
        assertDoesNotThrow(() -> bridge.emitForOperationLog(l));
    }

    @Test
    void emitForOperationLog_neverThrows_evenOnSubprocessFailure() {
        // Enabled + invalid cli path → subprocess will fail to start.
        // Bridge must swallow the exception and log internally.
        props.setEnabled(true);
        props.setCliPath("/nonexistent/cc-binary-12345");
        OperationLog l = log("u1", "auth", "LOGIN");
        assertDoesNotThrow(() -> bridge.emitForOperationLog(l));
    }

    @Test
    void emitForOperationLog_isNoOp_onNullLog() {
        props.setEnabled(true);
        assertDoesNotThrow(() -> bridge.emitForOperationLog(null));
    }

    @Test
    void snapshot_returnsCurrentConfig() {
        props.setEnabled(true);
        props.setNamespacePrefix("mtc/v1/audit/test");
        props.setIssuer("mtca:cc:test");
        props.setTimeoutMs(2000L);
        Set<String> allow = new HashSet<>();
        allow.add("t1");
        props.setTenantAllowList(allow);

        AuditMtcBridgeService.AuditMtcBridgeStatus status = bridge.snapshot();
        assertTrue(status.enabled());
        assertEquals("mtc/v1/audit/test", status.namespacePrefix());
        assertEquals("mtca:cc:test", status.issuer());
        assertEquals(2000L, status.timeoutMs());
        assertTrue(status.tenantAllowList().contains("t1"));
        // snapshot view is unmodifiable
        assertThrows(UnsupportedOperationException.class, () -> status.tenantAllowList().add("t2"));
    }
}

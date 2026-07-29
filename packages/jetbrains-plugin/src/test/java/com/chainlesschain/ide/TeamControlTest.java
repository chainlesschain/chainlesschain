package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Stale-intent CAS and shell-free argv coverage for JetBrains Team Agent View. */
class TeamControlTest {
    private static final String EFFECT_A = "sha256:" + "a".repeat(64);
    private static final String EFFECT_B = "sha256:" + "b".repeat(64);
    private static final String AUTHORITY_A = "c".repeat(64);
    private static final String AUTHORITY_B = "d".repeat(64);

    @Test
    void parserMatchesCliCanonicalDigestsAndLeaseReacquireChangesAttempt() {
        TeamMonitor.State first = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-epoch:1", "\"lease-epoch:1\"",
                "in_progress", "case-1", EFFECT_A));
        assertTrue(first.ok);
        assertEquals(6L, first.version);
        assertEquals("state-6", first.stateId);

        TeamMonitor.Task running = TeamMonitor.findTask(first, "running");
        assertNotNull(running);
        assertEquals("lease-epoch:1", running.leaseId);
        assertEquals("lease-epoch:1", running.fencingToken);
        assertEquals(
                "sha256:bb5a4017f40095d8e9efe546ee9faf87028ce58cc7b3a36d305fe529cc0b5f07",
                running.attemptDigest);

        TeamMonitor.Task ambiguous = TeamMonitor.findTask(first, "ambiguous");
        assertNotNull(ambiguous);
        assertTrue(ambiguous.adjudication.required);
        assertEquals("case-1", ambiguous.adjudication.caseId);
        assertEquals(EFFECT_A, ambiguous.adjudication.sideEffectDigest);
        assertEquals(
                "sha256:bd8076476467875ebae0c3bfa3ef0e0cba0d113861f613c1e69be82d3d6a1b08",
                ambiguous.adjudicationDigest);
        assertEquals(1, TeamMonitor.summarize(first, 0L).adjudicationRequired);

        TeamMonitor.State reacquired = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-epoch:2", "2",
                "in_progress", "case-1", EFFECT_A));
        TeamMonitor.Task nextAttempt = TeamMonitor.findTask(reacquired, "running");
        assertEquals(
                "sha256:9111b94d7a397cda82c805a0bbb936dda3ce5759b1f5071ab9c59e62496820de",
                nextAttempt.attemptDigest);
        assertNotEquals(running.attemptDigest, nextAttempt.attemptDigest);

        String loneSurrogateHolder =
                "mate-" + Character.toString(Character.MIN_HIGH_SURROGATE);
        assertEquals(
                "sha256:4bca25fcd7bf7388c818653604cef59f6467424cfe17172f346a097f28e25782",
                TeamMonitor.computeTeamControlAttemptDigest(
                        loneSurrogateHolder, "lease-1", 1L));
        assertNull(TeamMonitor.computeTeamControlAttemptDigest(
                "\u00a0mate-1", "lease-1", 1L));
    }

    @Test
    void invalidAttemptAndCaseBindingsRemainMonitorOnly() {
        TeamMonitor.State invalid = TeamMonitor.parse(
                "{\"version\":6,\"stateId\":\"state-6\",\"registry\":{\"tasks\":{\"tasks\":["
                + "{\"id\":\"bad-fence\",\"status\":\"in_progress\",\"metadata\":{"
                + "\"key\":\"bad-fence\",\"lease\":{\"holder\":\"mate-1\","
                + "\"leaseId\":\"lease-1\",\"fencingToken\":9007199254740992}}},"
                + "{\"id\":\"bad-case\",\"status\":\"cancelled\",\"metadata\":{"
                + "\"key\":\"bad-case\",\"adjudication\":{\"required\":true,\"case\":{"
                + "\"caseId\":\"case-1\",\"sideEffectDigest\":\"sha256:BAD\"}}}},"
                + "{\"id\":\"missing-case\",\"status\":\"cancelled\",\"metadata\":{"
                + "\"key\":\"missing-case\",\"adjudication\":{\"required\":true,\"case\":{"
                + "\"sideEffectDigest\":\"" + EFFECT_A + "\"}}}}]}}}");
        assertTrue(invalid.ok);
        assertNull(TeamMonitor.findTask(invalid, "bad-fence").attemptDigest);
        assertNull(TeamMonitor.findTask(invalid, "bad-case").adjudicationDigest);
        assertNull(TeamMonitor.findTask(invalid, "missing-case").adjudicationDigest);
        assertFalse(TeamControl.pinInterrupt(invalid, "bad-fence").ok);
        assertFalse(TeamControl.pinAdjudication(invalid, "bad-case", "retry").ok);
        assertFalse(TeamControl.pinAdjudication(invalid, "missing-case", "retry").ok);
        TeamMonitor.State fractionalVersion = TeamMonitor.parse(
                "{\"version\":6.5,\"stateId\":\"state-6\","
                + "\"registry\":{\"tasks\":{\"tasks\":[]}}}");
        assertEquals(0L, fractionalVersion.version);
        assertFalse(TeamControl.pinInterrupt(fractionalVersion, "anything").ok);
    }

    @Test
    void interruptAndAdjudicationArgvExactlyPinStateAndDigest() {
        TeamMonitor.State snapshot = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-epoch:1", "\"lease-epoch:1\"",
                "in_progress", "case-1", EFFECT_A));
        TeamControl.Target interrupt = TeamControl.pinInterrupt(snapshot, "running");
        TeamControl.Target adjudicate =
                TeamControl.pinAdjudication(snapshot, "ambiguous", "accept");
        assertTrue(interrupt.ok);
        assertTrue(adjudicate.ok);

        String path = "C:\\state files\\team.json";
        assertEquals(List.of(
                "team", "interrupt",
                "--state", path,
                "--expected-state-id", "state-6",
                "--expected-attempt-digest", interrupt.intent.attemptDigest,
                "--task", "running",
                "--actor", "jetbrains",
                "--reason", "operator checked & approved",
                "--json"),
                TeamControl.buildArgs(
                        path, interrupt.intent, " operator checked & approved "));
        assertEquals(List.of(
                "team", "adjudicate",
                "--state", path,
                "--expected-state-id", "state-6",
                "--expected-adjudication-digest",
                adjudicate.intent.adjudicationDigest,
                "--task", "ambiguous",
                "--decision", "accept",
                "--authority", "jetbrains",
                "--reason", "verified externally",
                "--json"),
                TeamControl.buildArgs(
                        path, adjudicate.intent, "verified externally"));
    }

    @Test
    void executeReReadsThenRunsTheExactPinnedArgv() {
        TeamMonitor.State snapshot = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-epoch:1", "\"lease-epoch:1\"",
                "in_progress", "case-1", EFFECT_A));
        TeamControl.Target pinned = TeamControl.pinInterrupt(snapshot, "running");
        AtomicInteger reads = new AtomicInteger();
        AtomicReference<List<String>> invoked = new AtomicReference<List<String>>();

        TeamControl.Result result = TeamControl.execute(
                "team state.json",
                pinned.intent,
                "manual takeover",
                ignored -> {
                    reads.incrementAndGet();
                    return snapshot;
                },
                (args, timeoutMs) -> {
                    invoked.set(args);
                    assertEquals(30_000L, timeoutMs);
                    return new TeamControl.CliResult(
                            0, "{\"ok\":true,\"requestId\":\"tctl_1\"}", "",
                            false, null);
                });

        assertTrue(result.ok);
        assertEquals(1, reads.get());
        assertEquals("team", invoked.get().get(0));
        assertTrue(invoked.get().contains(pinned.intent.attemptDigest));
        assertEquals("tctl_1", result.value.get("requestId"));
    }

    @Test
    void changedStateIdRejectsStaleClickBeforeCliInvocation() {
        TeamMonitor.State first = TeamMonitor.parse(state(
                "state-old", "mate-1", "lease-1", "1",
                "in_progress", "case-1", EFFECT_A));
        TeamControl.Target pinned = TeamControl.pinInterrupt(first, "running");
        AtomicInteger invocations = new AtomicInteger();

        TeamControl.Result result = TeamControl.execute(
                "state.json", pinned.intent, "take over",
                ignored -> TeamMonitor.parse(state(
                        "state-new", "mate-1", "lease-1", "1",
                        "in_progress", "case-1", EFFECT_A)),
                (args, timeoutMs) -> {
                    invocations.incrementAndGet();
                    return ok();
                });

        assertFalse(result.ok);
        assertTrue(result.error.contains("state changed"), result.error);
        assertEquals(0, invocations.get());
    }

    @Test
    void leaseReacquireRejectsStaleTakeoverBeforeCliInvocation() {
        TeamMonitor.State first = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-1", "1",
                "in_progress", "case-1", EFFECT_A));
        TeamControl.Target pinned = TeamControl.pinInterrupt(first, "running");
        AtomicInteger invocations = new AtomicInteger();

        TeamControl.Result result = TeamControl.execute(
                "state.json", pinned.intent, "take over",
                ignored -> TeamMonitor.parse(state(
                        "state-6", "mate-2", "lease-2", "2",
                        "in_progress", "case-1", EFFECT_A)),
                (args, timeoutMs) -> {
                    invocations.incrementAndGet();
                    return ok();
                });

        assertFalse(result.ok);
        assertTrue(result.error.contains("attempt changed"), result.error);
        assertEquals(0, invocations.get());
    }

    @Test
    void caseReplacementRejectsStaleDecisionBeforeCliInvocation() {
        TeamMonitor.State first = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-1", "1",
                "in_progress", "case-1", EFFECT_A));
        TeamControl.Target pinned =
                TeamControl.pinAdjudication(first, "ambiguous", "retry");
        AtomicInteger invocations = new AtomicInteger();

        TeamControl.Result result = TeamControl.execute(
                "state.json", pinned.intent, "safe to retry",
                ignored -> TeamMonitor.parse(state(
                        "state-6", "mate-1", "lease-1", "1",
                        "in_progress", "case-2", EFFECT_B)),
                (args, timeoutMs) -> {
                    invocations.incrementAndGet();
                    return ok();
                });

        assertFalse(result.ok);
        assertTrue(result.error.contains("case changed"), result.error);
        assertEquals(0, invocations.get());
    }

    @Test
    void completedAttemptAndResolvedCaseRejectOldClicks() {
        TeamMonitor.State first = TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-1", "1",
                "in_progress", "case-1", EFFECT_A));
        TeamControl.Target interrupt = TeamControl.pinInterrupt(first, "running");
        TeamControl.Target adjudication =
                TeamControl.pinAdjudication(first, "ambiguous", "cancel");
        TeamMonitor.State finished = TeamMonitor.parse(
                "{\"version\":6,\"stateId\":\"state-6\",\"registry\":{\"tasks\":{\"tasks\":["
                + "{\"id\":\"running\",\"status\":\"completed\",\"metadata\":{"
                + "\"key\":\"running\"}},"
                + "{\"id\":\"ambiguous\",\"status\":\"cancelled\",\"metadata\":{"
                + "\"key\":\"ambiguous\",\"adjudication\":{\"required\":false}}}]}}}");

        assertFalse(TeamControl.validate(finished, interrupt.intent).ok);
        assertFalse(TeamControl.validate(finished, adjudication.intent).ok);
    }

    @Test
    void timeoutSignalNonzeroAndStderrOnlySuccessAllFailClosed() {
        TeamControl.Target pinned = pinnedInterrupt();
        TeamControl.StateReader reader = ignored -> current();

        TeamControl.Result timeout = TeamControl.execute(
                "state.json", pinned.intent, "take over", reader,
                (args, timeoutMs) -> new TeamControl.CliResult(
                        null, "{\"ok\":true}", "", true, null));
        TeamControl.Result signal = TeamControl.execute(
                "state.json", pinned.intent, "take over", reader,
                (args, timeoutMs) -> new TeamControl.CliResult(
                        0, "{\"ok\":true}", "", false, "SIGTERM"));
        TeamControl.Result nonzero = TeamControl.execute(
                "state.json", pinned.intent, "take over", reader,
                (args, timeoutMs) -> new TeamControl.CliResult(
                        7, "{\"ok\":true}", "failed", false, null));
        TeamControl.Result stderrOnly = TeamControl.execute(
                "state.json", pinned.intent, "take over", reader,
                (args, timeoutMs) -> new TeamControl.CliResult(
                        0, "", "{\"ok\":true}", false, null));

        assertFalse(timeout.ok);
        assertTrue(timeout.error.contains("timed out"));
        assertFalse(signal.ok);
        assertTrue(signal.error.contains("SIGTERM"));
        assertFalse(nonzero.ok);
        assertTrue(nonzero.error.contains("code 7"));
        assertFalse(stderrOnly.ok);
        assertTrue(stderrOnly.error.contains("no control result"));
    }

    @Test
    void failuresAreSingleLineCredentialRedactedAndBounded() {
        TeamControl.Target pinned = pinnedInterrupt();
        String secret = "super-secret-value";
        String noisy = "Authorization: Bearer " + secret
                + "\napi_key=" + secret + " https://alice:pw@example.test/"
                + "x".repeat(1_000);
        TeamControl.Result result = TeamControl.execute(
                "state.json", pinned.intent, "take over",
                ignored -> current(),
                (args, timeoutMs) -> new TeamControl.CliResult(
                        9, "", noisy, false, null));

        assertFalse(result.ok);
        assertTrue(result.error.length() <= TeamControl.MAX_FAILURE_LENGTH);
        assertFalse(result.error.contains(secret), result.error);
        assertFalse(result.error.contains("alice:pw"), result.error);
        assertFalse(result.error.contains("\n"), result.error);
        assertTrue(result.error.contains("<redacted>"), result.error);
    }

    @Test
    void invalidReasonAndMalformedOrExplicitFailureOutputFailClosed() {
        TeamControl.Target pinned = pinnedInterrupt();
        AtomicInteger invocations = new AtomicInteger();
        TeamControl.Result invalidReason = TeamControl.execute(
                "state.json", pinned.intent, "bad\nreason",
                ignored -> current(),
                (args, timeoutMs) -> {
                    invocations.incrementAndGet();
                    return ok();
                });
        TeamControl.Result malformed = TeamControl.execute(
                "state.json", pinned.intent, "take over",
                ignored -> current(),
                (args, timeoutMs) -> new TeamControl.CliResult(
                        0, "not-json", "", false, null));
        TeamControl.Result explicitFailure = TeamControl.execute(
                "state.json", pinned.intent, "take over",
                ignored -> current(),
                (args, timeoutMs) -> new TeamControl.CliResult(
                        0, "{\"ok\":false,\"error\":\"token=secret-value\"}", "",
                        false, null));

        assertFalse(invalidReason.ok);
        assertEquals(0, invocations.get());
        assertFalse(malformed.ok);
        assertTrue(malformed.error.contains("invalid control result"));
        assertFalse(explicitFailure.ok);
        assertFalse(explicitFailure.error.contains("secret-value"));
        assertTrue(explicitFailure.error.contains("<redacted>"));
    }

    @Test
    void distributedParserExposesAuthorityFenceEvidenceAndCheckpointRecovery() {
        TeamMonitor.State state = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                EFFECT_A, "rollback-recovery-required", true));

        assertTrue(state.ok);
        assertTrue(state.distributedQueue);
        assertEquals(1L, state.schemaVersion);
        assertEquals("queue-1", state.queueId);
        assertEquals(AUTHORITY_A, state.authorityDigest);
        assertEquals("C:/repo with spaces", state.repoRoot);
        assertEquals("run-1", state.runId);
        assertEquals(4L, state.revision);

        TeamMonitor.Task running = TeamMonitor.findTask(state, "running");
        assertEquals("worker-1:agent", running.holder);
        assertEquals("lease-1", running.leaseId);
        assertEquals(9L, running.fencingToken);
        assertEquals("request-1", running.interruption.requestId);
        assertEquals("operator", running.interruption.actor);
        TeamMonitor.Task recovery = TeamMonitor.findTask(state, "recovery");
        assertEquals(EFFECT_A, recovery.evidenceDigest);
        assertTrue(recovery.checkpointRecoveryRequired);
        assertEquals("rollback_failed",
                recovery.workspaceExecution.checkpointState);
        String report = TeamMonitor.formatReport(state, 0L);
        assertTrue(report.contains("distributed queue: queue-1"));
        assertTrue(report.contains("authority: " + AUTHORITY_A));
        assertTrue(report.contains("evidence=" + EFFECT_A));
        assertTrue(report.contains("transaction tx-1"));
        assertTrue(report.contains("interrupt requested by operator"));

        TeamMonitor.State malformed = TeamMonitor.parse(distributedState(
                "sha256:bad", "worker-1", "lease-1", 9L,
                EFFECT_A, "rollback-recovery-required", true));
        assertFalse(malformed.ok);
    }

    @Test
    void distributedArgvPinsQueueLeaseAndEvidenceWithUniqueIds() {
        TeamMonitor.State state = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                EFFECT_A, "rollback-recovery-required", true));
        TeamControl.Target interrupt =
                TeamControl.pinInterrupt(state, "running");
        TeamControl.Target recover =
                TeamControl.pinRecovery(state, "recovery");
        TeamControl.Target accept =
                TeamControl.pinAdjudication(state, "recovery", "accept");
        assertTrue(interrupt.ok);
        assertTrue(recover.ok);
        assertTrue(accept.ok);
        assertTrue(interrupt.intent.operationId
                .startsWith("jetbrains-request-"));
        assertTrue(recover.intent.operationId
                .startsWith("jetbrains-recovery-"));
        assertTrue(accept.intent.operationId
                .startsWith("jetbrains-decision-"));
        assertNotEquals(interrupt.intent.operationId, recover.intent.operationId);
        assertNotEquals(recover.intent.operationId, accept.intent.operationId);

        String path = "C:\\state files\\queue.json";
        assertEquals(List.of(
                "team", "queue", "interrupt",
                "--state", path,
                "--repo", "C:/repo with spaces",
                "--run-id", "run-1",
                "--queue-id", "queue-1",
                "--authority-digest", AUTHORITY_A,
                "--task", "running",
                "--holder", "worker-1:agent",
                "--lease-id", "lease-1",
                "--fencing-token", "9",
                "--request-id", interrupt.intent.operationId,
                "--actor", "jetbrains",
                "--reason", "manual takeover",
                "--json"),
                TeamControl.buildArgs(path, interrupt.intent, "manual takeover"));
        assertEquals(List.of(
                "team", "queue", "recover",
                "--state", path,
                "--repo", "C:/repo with spaces",
                "--run-id", "run-1",
                "--queue-id", "queue-1",
                "--authority-digest", AUTHORITY_A,
                "--task", "recovery",
                "--recovery-id", recover.intent.operationId,
                "--evidence-digest", EFFECT_A,
                "--actor", "jetbrains",
                "--reason", "owner dead",
                "--json"),
                TeamControl.buildArgs(path, recover.intent, "owner dead"));
        List<String> accepted =
                TeamControl.buildArgs(path, accept.intent, "verified externally");
        assertTrue(accepted.contains("--decision-id"));
        assertTrue(accepted.contains(accept.intent.operationId));
        assertTrue(accepted.contains("--evidence-digest"));
        assertTrue(accepted.contains(EFFECT_A));
        assertFalse(accepted.contains("--result"));
    }

    @Test
    void distributedCasRejectsAuthorityFenceEvidenceAndRecoveryRaces() {
        TeamMonitor.State first = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                EFFECT_A, "rollback-recovery-required", true));
        TeamControl.Target interrupt =
                TeamControl.pinInterrupt(first, "running");
        TeamControl.Target adjudicate =
                TeamControl.pinAdjudication(first, "recovery", "retry");
        TeamControl.Target recover =
                TeamControl.pinRecovery(first, "recovery");

        TeamMonitor.State changedAuthority = TeamMonitor.parse(distributedState(
                AUTHORITY_B, "worker-1:agent", "lease-1", 9L,
                EFFECT_A, "rollback-recovery-required", true));
        assertTrue(TeamControl.validate(changedAuthority, interrupt.intent)
                .error.contains("authority changed"));

        TeamMonitor.State changedFence = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-2", 10L,
                EFFECT_A, "rollback-recovery-required", true));
        assertTrue(TeamControl.validate(changedFence, interrupt.intent)
                .error.contains("lease fence changed"));

        TeamMonitor.State changedEvidence = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                EFFECT_B, "rollback-recovery-required", true));
        assertTrue(TeamControl.validate(changedEvidence, adjudicate.intent)
                .error.contains("evidence changed"));

        TeamMonitor.State recovered = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                EFFECT_A, "rolled-back", false));
        assertTrue(TeamControl.validate(recovered, recover.intent)
                .error.contains("no longer requires managed checkpoint recovery"));
    }

    @Test
    void distributedExecuteReReadsBeforeShellFreeCliInvocation() {
        TeamMonitor.State state = TeamMonitor.parse(distributedState(
                AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                EFFECT_A, "rollback-recovery-required", true));
        TeamControl.Target pinned =
                TeamControl.pinAdjudication(state, "recovery", "cancel");
        AtomicReference<List<String>> invoked =
                new AtomicReference<List<String>>();
        TeamControl.Result result = TeamControl.execute(
                "queue state.json", pinned.intent, "keep cancelled",
                ignored -> state,
                (args, timeoutMs) -> {
                    invoked.set(args);
                    return ok();
                });
        assertTrue(result.ok);
        assertEquals(List.of("team", "queue", "adjudicate"),
                invoked.get().subList(0, 3));
        assertTrue(invoked.get().contains("--decision-id"));
        assertTrue(invoked.get().contains(pinned.intent.operationId));

        AtomicInteger staleInvocations = new AtomicInteger();
        TeamControl.Result stale = TeamControl.execute(
                "queue state.json", pinned.intent, "keep cancelled",
                ignored -> TeamMonitor.parse(distributedState(
                        AUTHORITY_A, "worker-1:agent", "lease-1", 9L,
                        EFFECT_B, "rollback-recovery-required", true)),
                (args, timeoutMs) -> {
                    staleInvocations.incrementAndGet();
                    return ok();
                });
        assertFalse(stale.ok);
        assertEquals(0, staleInvocations.get());
    }

    @Test
    void commandRunnerPreservesLiteralArgumentsWithoutShellInterpretation()
            throws Exception {
        String executable = new File(
                System.getProperty("java.home"),
                "bin" + File.separator + (File.separatorChar == '\\' ? "java.exe" : "java"))
                .getAbsolutePath();
        String metacharacters = "literal ; & | $() with spaces";
        TeamControl.CliResult result = TeamControlCommandRunner.run(
                executable,
                List.of(
                        "-cp", System.getProperty("java.class.path"),
                        ArgProbe.class.getName(),
                        metacharacters),
                null,
                10_000L);

        assertEquals(0, result.code);
        assertFalse(result.timedOut);
        assertEquals(metacharacters, result.stdout.trim());
    }

    @Test
    void windowsNpmAndManagedShimsResolveToNodeArgvWithoutShell(
            @TempDir Path directory) throws Exception {
        Path node = Files.write(directory.resolve("node.exe"), new byte[] { 0 });
        Path npmScript = directory.resolve("node_modules")
                .resolve("chainlesschain")
                .resolve("bin")
                .resolve("chainlesschain.js");
        Files.createDirectories(npmScript.getParent());
        Files.writeString(npmScript, "// fixture", StandardCharsets.UTF_8);
        Path npmShim = Files.writeString(
                directory.resolve("cc.cmd"), "@ECHO off\r\n", StandardCharsets.UTF_8);
        assertEquals(
                List.of(node.toString(), npmScript.toString()),
                TeamControlCommandRunner.npmNodeCommand(npmShim));

        Path managedEntry = Files.writeString(
                directory.resolve("managed entry.js"), "// fixture",
                StandardCharsets.UTF_8);
        Path managedShim = Files.writeString(
                directory.resolve("chainlesschain-managed.cmd"),
                "@ECHO OFF\r\nnode \"" + managedEntry + "\" %*\r\n",
                StandardCharsets.UTF_8);
        assertEquals(
                List.of(node.toString(), managedEntry.toString()),
                TeamControlCommandRunner.managedNodeCommand(managedShim));
        if (File.separatorChar == '\\') {
            assertEquals(
                    List.of(node.toString(), managedEntry.toString()),
                    TeamControlCommandRunner.resolveCommand(
                            "\"" + managedShim + "\""));
        }
    }

    private static TeamControl.Target pinnedInterrupt() {
        return TeamControl.pinInterrupt(current(), "running");
    }

    private static TeamMonitor.State current() {
        return TeamMonitor.parse(state(
                "state-6", "mate-1", "lease-1", "1",
                "in_progress", "case-1", EFFECT_A));
    }

    private static TeamControl.CliResult ok() {
        return new TeamControl.CliResult(
                0, "{\"ok\":true}", "", false, null);
    }

    private static String state(String stateId, String holder, String leaseId,
            String fencingTokenJson, String runningStatus, String caseId,
            String sideEffectDigest) {
        return "{\"version\":6,\"stateId\":\"" + stateId
                + "\",\"registry\":{\"tasks\":{\"tasks\":["
                + "{\"id\":\"running\",\"title\":\"Run\",\"status\":\""
                + runningStatus + "\",\"metadata\":{\"key\":\"running\","
                + "\"lease\":{\"holder\":\"" + holder + "\",\"leaseId\":\""
                + leaseId + "\",\"fencingToken\":" + fencingTokenJson
                + ",\"expiresAt\":9999999999999}}},"
                + "{\"id\":\"ambiguous\",\"title\":\"Ambiguous\",\"status\":\"cancelled\","
                + "\"metadata\":{\"key\":\"ambiguous\",\"adjudication\":{"
                + "\"required\":true,\"reason\":\"unknown outcome\",\"case\":{"
                + "\"caseId\":\"" + caseId + "\",\"sideEffectDigest\":\""
                + sideEffectDigest + "\"}}}}]}}}";
    }

    private static String distributedState(String authorityDigest, String holder,
            String leaseId, long fencingToken, String evidenceDigest,
            String workspacePhase, boolean recoveryRequired) {
        return "{\"schemaVersion\":1,\"queueId\":\"queue-1\",\"revision\":4,"
                + "\"authorityDigest\":\"" + authorityDigest + "\","
                + "\"authority\":{\"repoRoot\":\"C:/repo with spaces\","
                + "\"runId\":\"run-1\",\"mode\":\"agent-worktree\"},"
                + "\"registry\":{\"tasks\":{\"tasks\":["
                + "{\"id\":\"running\",\"title\":\"Run\",\"status\":\"in_progress\","
                + "\"metadata\":{\"key\":\"running\",\"lease\":{\"holder\":\""
                + holder + "\",\"leaseId\":\"" + leaseId
                + "\",\"fencingToken\":" + fencingToken
                + ",\"expiresAt\":9999999999999},"
                + "\"interruption\":{\"requestId\":\"request-1\","
                + "\"actor\":\"operator\",\"reason\":\"takeover\","
                + "\"evidenceDigest\":\"" + evidenceDigest + "\"}}},"
                + "{\"id\":\"recovery\",\"title\":\"Recovery\","
                + "\"status\":\"cancelled\",\"metadata\":{\"key\":\"recovery\","
                + "\"adjudication\":{\"required\":true,\"reason\":\"unknown\","
                + "\"evidenceDigest\":\"" + evidenceDigest + "\"},"
                + "\"workspaceExecution\":{\"phase\":\"" + workspacePhase
                + "\",\"workerId\":\"worker-2\",\"checkpoint\":{"
                + "\"transactionId\":\"tx-1\",\"state\":\"rollback_failed\","
                + "\"recoveryRequired\":" + recoveryRequired
                + "}}}}]}}}";
    }

    /** Child-process probe for the shell-free ProcessBuilder regression test. */
    public static final class ArgProbe {
        private ArgProbe() {}

        public static void main(String[] args) {
            System.out.println(args.length == 0 ? "" : args[0]);
        }
    }
}

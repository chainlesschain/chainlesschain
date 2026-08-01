package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Preview/confirm controller for the existing IDE Workbench.
 *
 * <p>The sole mutation path is {@code cc artifacts delivery-step}: request
 * creates a pending coordinator effect and settlement consumes an exact
 * effect-bound result envelope. This class has no PR/CI/merge provider API.
 */
public final class DeliveryWorkflowController {
    @FunctionalInterface
    public interface CliAdapter {
        String run(List<String> args) throws Exception;
    }

    @FunctionalInterface
    public interface ResultReader {
        String read(String path) throws Exception;
    }

    public static final class Confirmation {
        public final String id;
        public final String kind;
        public final String statePath;
        public final String resultPath;
        public final String resultDigest;
        public final String flowId;
        public final String action;
        public final long expectedRevision;
        public final String expectedStateDigest;
        public final String expectedEffectId;

        private Confirmation(String kind, String statePath, String resultPath,
                String resultDigest, String flowId, String action,
                long expectedRevision, String expectedStateDigest,
                String expectedEffectId) {
            this.id = UUID.randomUUID().toString();
            this.kind = kind;
            this.statePath = statePath;
            this.resultPath = resultPath;
            this.resultDigest = resultDigest;
            this.flowId = flowId;
            this.action = action;
            this.expectedRevision = expectedRevision;
            this.expectedStateDigest = expectedStateDigest;
            this.expectedEffectId = expectedEffectId;
        }
    }

    private final CliAdapter cli;
    private final ResultReader resultReader;
    private String statePath;
    private Map<String, Object> projection;
    private Confirmation confirmation;

    public DeliveryWorkflowController(CliAdapter cli, ResultReader resultReader) {
        if (cli == null) throw new IllegalArgumentException("cli is required");
        if (resultReader == null) {
            throw new IllegalArgumentException("resultReader is required");
        }
        this.cli = cli;
        this.resultReader = resultReader;
    }

    public synchronized String statePath() {
        return statePath;
    }

    public synchronized Map<String, Object> projection() {
        return projection;
    }

    public synchronized Map<String, Object> load(String nextStatePath) throws Exception {
        if (nextStatePath == null || nextStatePath.trim().isEmpty()) {
            throw new IllegalArgumentException("statePath is required");
        }
        try {
            Map<String, Object> next = project(nextStatePath);
            statePath = nextStatePath;
            projection = next;
            confirmation = null;
            return projection;
        } catch (Exception error) {
            invalidate(nextStatePath);
            throw error;
        }
    }

    /** Retain the selected state path while removing every stale action. */
    public synchronized void invalidate(String nextStatePath) {
        statePath = nextStatePath;
        projection = null;
        confirmation = null;
    }

    public synchronized Confirmation previewRequest(String action) {
        if (projection == null || statePath == null) {
            throw stale("no delivery projection is loaded");
        }
        if (DeliveryWorkflow.pendingEffect(projection) != null) {
            throw stale("a delivery effect is already pending");
        }
        if (!DeliveryWorkflow.availableActions(projection).contains(action)) {
            throw stale("delivery action is no longer available");
        }
        confirmation = new Confirmation(
                "request", statePath, null, null,
                string(projection.get("flowId")), action,
                DeliveryWorkflow.number(projection.get("revision")),
                string(projection.get("stateDigest")), null);
        return confirmation;
    }

    public synchronized Map<String, Object> confirmRequest(Confirmation token)
            throws Exception {
        consume(token, "request");
        try {
            Map<String, Object> latest = project(token.statePath);
            projection = latest;
            if (!sameBinding(latest, token, false)
                    || DeliveryWorkflow.pendingEffect(latest) != null
                    || !DeliveryWorkflow.availableActions(latest).contains(token.action)) {
                throw stale("delivery request confirmation is stale");
            }
            Map<String, Object> next = step(DeliveryWorkflow.buildStepArgs(
                    token.statePath, token.action, null, null,
                    token.expectedRevision, token.expectedStateDigest,
                    null, true));
            Map<String, Object> pending = DeliveryWorkflow.pendingEffect(next);
            if (!Objects.equals(next.get("flowId"), token.flowId)
                    || DeliveryWorkflow.number(next.get("revision")) <= token.expectedRevision
                    || pending == null
                    || !Objects.equals(pending.get("action"), token.action)
                    || !DeliveryWorkflow.availableActions(next).isEmpty()) {
                throw stale("CLI did not return the requested pending effect");
            }
            projection = next;
            return projection;
        } catch (Exception error) {
            invalidate(token.statePath);
            throw error;
        }
    }

    public synchronized Confirmation previewSettlement(String resultPath)
            throws Exception {
        if (projection == null || statePath == null) {
            throw stale("no delivery projection is loaded");
        }
        Map<String, Object> pending = DeliveryWorkflow.pendingEffect(projection);
        if (pending == null) throw stale("no delivery effect is pending");
        String resultText = resultReader.read(resultPath);
        Map<String, Object> envelope = DeliveryWorkflow.parseActionResult(resultText);
        String effectId = string(pending.get("id"));
        if (envelope == null || !effectId.equals(string(envelope.get("effectId")))) {
            throw stale("result envelope effectId does not match the pending effect");
        }
        confirmation = new Confirmation(
                "settle", statePath, resultPath, digest(resultText),
                string(projection.get("flowId")), string(pending.get("action")),
                DeliveryWorkflow.number(projection.get("revision")),
                string(projection.get("stateDigest")), effectId);
        return confirmation;
    }

    public synchronized Map<String, Object> confirmSettlement(Confirmation token)
            throws Exception {
        consume(token, "settle");
        try {
            Map<String, Object> latest = project(token.statePath);
            projection = latest;
            if (!sameBinding(latest, token, true)) {
                throw stale("delivery settlement confirmation is stale");
            }
            String resultText = resultReader.read(token.resultPath);
            Map<String, Object> envelope = DeliveryWorkflow.parseActionResult(resultText);
            if (!token.resultDigest.equals(digest(resultText))
                    || envelope == null
                    || !token.expectedEffectId.equals(string(envelope.get("effectId")))) {
                throw stale("delivery result envelope changed after preview");
            }
            Map<String, Object> next = step(DeliveryWorkflow.buildStepArgs(
                    token.statePath, null, null, token.resultPath,
                    token.expectedRevision, token.expectedStateDigest,
                    token.expectedEffectId, true));
            if (!Objects.equals(next.get("flowId"), token.flowId)
                    || DeliveryWorkflow.number(next.get("revision")) <= token.expectedRevision
                    || DeliveryWorkflow.pendingEffect(next) != null) {
                throw stale("CLI did not settle the exact pending effect");
            }
            projection = next;
            return projection;
        } catch (Exception error) {
            invalidate(token.statePath);
            throw error;
        }
    }

    private Map<String, Object> project(String path) throws Exception {
        String raw = cli.run(DeliveryWorkflow.buildProjectArgs(path));
        Map<String, Object> result = DeliveryWorkflow.parseCommandResult(raw);
        if (result == null) throw stale("invalid delivery projection from CLI");
        return commandProjection(result);
    }

    private Map<String, Object> step(List<String> args) throws Exception {
        String raw = cli.run(args);
        Map<String, Object> result = DeliveryWorkflow.parseCommandResult(raw);
        if (result == null) throw stale("invalid delivery step result from CLI");
        return commandProjection(result);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> commandProjection(Map<String, Object> result) {
        return (Map<String, Object>) result.get("projection");
    }

    private void consume(Confirmation token, String kind) {
        if (token == null || token != confirmation || !kind.equals(token.kind)) {
            throw stale("delivery confirmation is stale");
        }
        confirmation = null;
    }

    private static boolean sameBinding(
            Map<String, Object> current, Confirmation token, boolean effect) {
        if (!Objects.equals(current.get("flowId"), token.flowId)
                || DeliveryWorkflow.number(current.get("revision")) != token.expectedRevision
                || !Objects.equals(current.get("stateDigest"), token.expectedStateDigest)) {
            return false;
        }
        if (!effect) return true;
        Map<String, Object> pending = DeliveryWorkflow.pendingEffect(current);
        return pending != null && Objects.equals(pending.get("id"), token.expectedEffectId);
    }

    private static String digest(String value) {
        try {
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            byte[] bytes = hash.digest(String.valueOf(value).getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder("sha256:");
            for (byte b : bytes) result.append(String.format("%02x", b & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static String string(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static IllegalStateException stale(String message) {
        return new IllegalStateException(message);
    }
}

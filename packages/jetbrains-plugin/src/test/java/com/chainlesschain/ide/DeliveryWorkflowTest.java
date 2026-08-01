package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DeliveryWorkflowTest {
    private static Path fixturePath() {
        for (String root : new String[] {
                "../agent-sdk", "packages/agent-sdk", "../../packages/agent-sdk" }) {
            Path path = Paths.get(root, "__fixtures__", "delivery-workflow", "cases.json");
            if (Files.isRegularFile(path)) return path;
        }
        throw new AssertionError("shared delivery workflow fixture not found");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> fixture() {
        try {
            return (Map<String, Object>) MiniJson.parse(
                    Files.readString(fixturePath(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new AssertionError("cannot read delivery fixture", e);
        }
    }

    private static final class FakeCliAdapter
            implements DeliveryWorkflowController.CliAdapter {
        final List<Map<String, Object>> outputs;
        final List<List<String>> calls = new ArrayList<>();

        FakeCliAdapter(List<Map<String, Object>> outputs) {
            this.outputs = new ArrayList<>(outputs);
        }

        @Override
        public String run(List<String> args) {
            calls.add(new ArrayList<>(args));
            if (outputs.isEmpty()) throw new AssertionError("unexpected CLI call: " + args);
            return MiniJson.stringify(outputs.remove(0));
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void consumesTheSharedProjectionAndActionCases() {
        Map<String, Object> root = fixture();
        assertEquals("chainlesschain.delivery-host-fixtures", root.get("schema"));
        for (Object raw : (List<Object>) root.get("projectionCases")) {
            Map<String, Object> testCase = (Map<String, Object>) raw;
            Map<String, Object> value = (Map<String, Object>) testCase.get("value");
            if (Boolean.TRUE.equals(testCase.get("valid"))) {
                assertNotNull(DeliveryWorkflow.validateProjection(value),
                        String.valueOf(testCase.get("name")));
            } else {
                assertNull(DeliveryWorkflow.validateProjection(value),
                        String.valueOf(testCase.get("name")));
            }
        }
        for (Object raw : (List<Object>) root.get("actionCases")) {
            Map<String, Object> testCase = (Map<String, Object>) raw;
            Map<String, Object> value = (Map<String, Object>) testCase.get("value");
            if (Boolean.TRUE.equals(testCase.get("valid"))) {
                assertNotNull(DeliveryWorkflow.validateAction(value),
                        String.valueOf(testCase.get("name")));
            } else {
                assertNull(DeliveryWorkflow.validateAction(value),
                        String.valueOf(testCase.get("name")));
            }
        }
        for (Object raw : (List<Object>) root.get("resultCases")) {
            Map<String, Object> testCase = (Map<String, Object>) raw;
            Map<String, Object> value = (Map<String, Object>) testCase.get("value");
            if (Boolean.TRUE.equals(testCase.get("valid"))) {
                assertNotNull(DeliveryWorkflow.validateActionResult(value),
                        String.valueOf(testCase.get("name")));
            } else {
                assertNull(DeliveryWorkflow.validateActionResult(value),
                        String.valueOf(testCase.get("name")));
            }
        }
        Map<String, Object> controller =
                (Map<String, Object>) root.get("controllerCase");
        assertNotNull(DeliveryWorkflow.validateCommandResult(
                (Map<String, Object>) controller.get("initial")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void rendersThePathFailureMappingAndImmutableEvidence() {
        for (Object raw : (List<Object>) fixture().get("uiCases")) {
            Map<String, Object> testCase = (Map<String, Object>) raw;
            String rendered = DeliveryWorkflow.render(
                    (Map<String, Object>) testCase.get("value"), "flow.json");
            for (Object expected : (List<Object>) testCase.get("contains")) {
                assertTrue(rendered.contains(String.valueOf(expected)),
                        testCase.get("name") + ": missing " + expected);
            }
            assertTrue(rendered.contains("delivery-step only"));
            assertTrue(rendered.contains("never calls a PR, CI, merge, or archive provider"));
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void controllerRequestsAndSettlesOnlyThroughExactCliBindings() throws Exception {
        Map<String, Object> c = (Map<String, Object>) fixture().get("controllerCase");
        FakeCliAdapter cli = new FakeCliAdapter(List.of(
                (Map<String, Object>) c.get("initial"),
                (Map<String, Object>) c.get("initial"),
                (Map<String, Object>) c.get("requested"),
                (Map<String, Object>) c.get("requested"),
                (Map<String, Object>) c.get("settled")));
        String resultText = MiniJson.stringify(c.get("resultEnvelope"));
        DeliveryWorkflowController controller = new DeliveryWorkflowController(
                cli, path -> {
                    assertEquals(c.get("resultPath"), path);
                    return resultText;
                });

        controller.load(String.valueOf(c.get("statePath")));
        DeliveryWorkflowController.Confirmation request =
                controller.previewRequest("refresh_ci");
        assertEquals(7, request.expectedRevision);
        controller.confirmRequest(request);
        assertEquals(c.get("expectedRequestArgs"), cli.calls.get(2));
        assertEquals("refresh_ci",
                DeliveryWorkflow.pendingEffect(controller.projection()).get("action"));

        DeliveryWorkflowController.Confirmation settlement =
                controller.previewSettlement(String.valueOf(c.get("resultPath")));
        assertEquals(((Map<String, Object>) c.get("resultEnvelope")).get("effectId"),
                settlement.expectedEffectId);
        controller.confirmSettlement(settlement);
        assertEquals(c.get("expectedSettleArgs"), cli.calls.get(4));
        assertEquals("evidence", controller.projection().get("phase"));
        assertNull(DeliveryWorkflow.pendingEffect(controller.projection()));

        int mutationCalls = 0;
        for (List<String> args : cli.calls) {
            if (args.size() > 1 && "delivery-step".equals(args.get(1))) {
                mutationCalls++;
                assertEquals(Arrays.asList("artifacts", "delivery-step"),
                        args.subList(0, 2));
                assertTrue(args.contains("--write-state"));
                assertFalse(args.stream().anyMatch(
                        arg -> arg.matches("^(gh|git|merge|push)$")));
            }
        }
        assertEquals(2, mutationCalls);
    }

    @Test
    @SuppressWarnings("unchecked")
    void staleRevisionAndChangedResultFailBeforeDeliveryStep() throws Exception {
        Map<String, Object> c = (Map<String, Object>) fixture().get("controllerCase");
        FakeCliAdapter staleCli = new FakeCliAdapter(List.of(
                (Map<String, Object>) c.get("initial"),
                (Map<String, Object>) c.get("stale")));
        DeliveryWorkflowController stale = new DeliveryWorkflowController(
                staleCli, path -> MiniJson.stringify(c.get("resultEnvelope")));
        stale.load(String.valueOf(c.get("statePath")));
        DeliveryWorkflowController.Confirmation request =
                stale.previewRequest("refresh_ci");
        assertThrows(IllegalStateException.class, () -> stale.confirmRequest(request));
        assertFalse(staleCli.calls.stream().anyMatch(
                args -> args.size() > 1 && "delivery-step".equals(args.get(1))));
        assertEquals(c.get("statePath"), stale.statePath());
        assertNull(stale.projection());

        FakeCliAdapter changedCli = new FakeCliAdapter(List.of(
                (Map<String, Object>) c.get("requested"),
                (Map<String, Object>) c.get("requested")));
        AtomicReference<String> resultText =
                new AtomicReference<>(MiniJson.stringify(c.get("resultEnvelope")));
        DeliveryWorkflowController changed = new DeliveryWorkflowController(
                changedCli, path -> resultText.get());
        changed.load(String.valueOf(c.get("statePath")));
        DeliveryWorkflowController.Confirmation settlement =
                changed.previewSettlement(String.valueOf(c.get("resultPath")));
        Map<String, Object> changedEnvelope = new java.util.LinkedHashMap<>(
                (Map<String, Object>) c.get("resultEnvelope"));
        Map<String, Object> changedResult = new java.util.LinkedHashMap<>(
                (Map<String, Object>) changedEnvelope.get("result"));
        changedResult.put("changed", true);
        changedEnvelope.put("result", changedResult);
        resultText.set(MiniJson.stringify(changedEnvelope));
        assertThrows(IllegalStateException.class,
                () -> changed.confirmSettlement(settlement));
        assertFalse(changedCli.calls.stream().anyMatch(
                args -> args.size() > 1 && "delivery-step".equals(args.get(1))));
        assertEquals(c.get("statePath"), changed.statePath());
        assertNull(changed.projection());
    }

    @Test
    @SuppressWarnings("unchecked")
    void failedRefreshClearsStaleActionsButRetainsTheSelectedPath() throws Exception {
        Map<String, Object> c = (Map<String, Object>) fixture().get("controllerCase");
        FakeCliAdapter cli = new FakeCliAdapter(List.of(
                (Map<String, Object>) c.get("initial"),
                Map.of("schema", "invalid")));
        DeliveryWorkflowController controller = new DeliveryWorkflowController(
                cli, path -> MiniJson.stringify(c.get("resultEnvelope")));

        controller.load(String.valueOf(c.get("statePath")));
        assertEquals(List.of("refresh_ci"),
                DeliveryWorkflow.availableActions(controller.projection()));
        assertThrows(IllegalStateException.class,
                () -> controller.load(String.valueOf(c.get("statePath"))));
        assertEquals(c.get("statePath"), controller.statePath());
        assertNull(controller.projection());
        assertThrows(IllegalStateException.class,
                () -> controller.previewRequest("refresh_ci"));
    }

    @Test
    void buildsOnlyTheExplicitCliStepProtocol() {
        assertEquals(Arrays.asList(
                        "artifacts", "delivery-step", "flow.json",
                        "--action", "refresh_ci",
                        "--result-file", "ci.json", "--json"),
                DeliveryWorkflow.buildStepArgs(
                        "flow.json", "refresh_ci", null, "ci.json"));
        assertThrows(IllegalArgumentException.class,
                () -> DeliveryWorkflow.buildStepArgs(
                        "flow.json", "force_merge", null, null));
    }
}

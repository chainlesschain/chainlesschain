package com.chainlesschain.ide;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Cross-language contract for {@link CapabilityNegotiation} (JetBrains side).
 *
 * <p>Drives the Java twin over the SAME shared fixture the JS core uses
 * ({@code packages/cli/__tests__/fixtures/capability-negotiation-cases.json},
 * asserted by {@code packages/cli/__tests__/unit/capability-negotiation.test.js}).
 * Both sides MUST compute identical {ok, agreedVersion, features, downgraded,
 * disabledFeatures} for every case — a drift in either fails loudly here.
 *
 * <p>Real JUnit 5 (per-case isolation + XML), run by {@code ./gradlew test} in
 * CI — no IntelliJ platform framework, headless in ms.
 */
public class CapabilityNegotiationTest {

    private static Path fixtureFile() {
        for (String root : new String[] {
                "../cli", "packages/cli", "../../packages/cli" }) {
            Path p = Paths.get(root, "__tests__", "fixtures",
                    "capability-negotiation-cases.json");
            if (Files.isRegularFile(p)) return p;
        }
        throw new AssertionError(
                "shared negotiation fixture not found (drift or moved dir?) cwd="
                        + Paths.get("").toAbsolutePath());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> readCases() {
        try {
            String json = new String(Files.readAllBytes(fixtureFile()),
                    StandardCharsets.UTF_8);
            Map<String, Object> root = MiniJson.parseObject(json);
            List<Map<String, Object>> out = new ArrayList<>();
            for (Object c : (List<Object>) root.get("cases")) {
                out.add((Map<String, Object>) c);
            }
            return out;
        } catch (IOException e) {
            throw new AssertionError("cannot read negotiation fixture", e);
        }
    }

    private static List<String> asStrings(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List) {
            for (Object o : (List<?>) v) out.add(String.valueOf(o));
        }
        return out;
    }

    private static Integer asIntOrNull(Object v) {
        return v instanceof Number ? ((Number) v).intValue() : null;
    }

    @Test
    void fixtureIsPresentAndNonEmpty() {
        assertTrue(Files.isRegularFile(fixtureFile()), "missing shared fixture");
        assertTrue(readCases().size() >= 8, "expected the full case set");
    }

    @SuppressWarnings("unchecked")
    @TestFactory
    List<DynamicTest> matchesSharedFixture() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Map<String, Object> c : readCases()) {
            String name = String.valueOf(c.get("name"));
            tests.add(DynamicTest.dynamicTest(name, () -> {
                Map<String, Object> server = (Map<String, Object>) c.get("server");
                Map<String, Object> client = (Map<String, Object>) c.get("client");
                Map<String, Integer> mins = null;
                Object fmv = c.get("featureMinVersion");
                if (fmv instanceof Map) {
                    mins = new HashMap<>();
                    for (Map.Entry<String, Object> e :
                            ((Map<String, Object>) fmv).entrySet()) {
                        mins.put(e.getKey(), asIntOrNull(e.getValue()));
                    }
                }
                Map<String, Object> expected =
                        (Map<String, Object>) c.get("expected");

                CapabilityNegotiation.Result r =
                        CapabilityNegotiation.negotiate(server, client, mins);

                assertEquals(expected.get("ok"), r.ok, name + " / ok");
                assertEquals(asIntOrNull(expected.get("agreedVersion")),
                        r.agreedVersion, name + " / agreedVersion");
                assertEquals(asStrings(expected.get("features")), r.features,
                        name + " / features");
                assertEquals(expected.get("downgraded"), r.downgraded,
                        name + " / downgraded");
                assertEquals(asStrings(expected.get("disabledFeatures")),
                        r.disabledFeatures, name + " / disabledFeatures");
            }));
        }
        return tests;
    }
}

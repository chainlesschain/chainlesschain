package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Headless contract for {@link CapabilityNegotiation}, asserting the Java twin
 * against the SAME shared fixture the JS core uses
 * ({@code packages/cli/__tests__/fixtures/capability-negotiation-cases.json},
 * see {@code packages/cli/__tests__/unit/capability-negotiation.test.js}). Both
 * sides MUST compute identical {ok, agreedVersion, features, downgraded,
 * disabledFeatures} for every case — a drift in either fails loudly.
 *
 * No IntelliJ SDK, no cc — plain {@code javac} + {@code java}.
 *
 * Repro (from packages/jetbrains-plugin):
 *   javac --release 17 -encoding UTF-8 -d .smoke-out \
 *     src/main/java/com/chainlesschain/ide/MiniJson.java \
 *     src/main/java/com/chainlesschain/ide/CapabilityNegotiation.java \
 *     src/test/java/com/chainlesschain/ide/CapabilityNegotiationSmokeMain.java
 *   java -cp .smoke-out com.chainlesschain.ide.CapabilityNegotiationSmokeMain
 */
public final class CapabilityNegotiationSmokeMain {

    private static int passed = 0;
    private static int failed = 0;

    private static void eq(Object got, Object want, String name) {
        boolean ok = (got == null) ? (want == null) : got.equals(want);
        if (ok) passed++;
        else {
            failed++;
            System.out.println("  FAIL: " + name + " -> got[" + got + "] want[" + want + "]");
        }
    }

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
    private static List<String> asStrings(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List) {
            for (Object o : (List<Object>) v) out.add(String.valueOf(o));
        }
        return out;
    }

    private static Integer asIntOrNull(Object v) {
        if (v instanceof Number) return ((Number) v).intValue();
        return null;
    }

    @SuppressWarnings("unchecked")
    public static void main(String[] args) throws IOException {
        String json = new String(Files.readAllBytes(fixtureFile()), StandardCharsets.UTF_8);
        Map<String, Object> root = MiniJson.parseObject(json);
        List<Object> cases = (List<Object>) root.get("cases");
        System.out.println("capability-negotiation fixture: " + cases.size() + " cases");

        for (Object cObj : cases) {
            Map<String, Object> c = (Map<String, Object>) cObj;
            String name = String.valueOf(c.get("name"));
            Map<String, Object> server = (Map<String, Object>) c.get("server");
            Map<String, Object> client = (Map<String, Object>) c.get("client"); // may be null
            Map<String, Integer> mins = null;
            Object fmv = c.get("featureMinVersion");
            if (fmv instanceof Map) {
                mins = new HashMap<>();
                for (Map.Entry<String, Object> e : ((Map<String, Object>) fmv).entrySet()) {
                    mins.put(e.getKey(), asIntOrNull(e.getValue()));
                }
            }
            Map<String, Object> expected = (Map<String, Object>) c.get("expected");

            CapabilityNegotiation.Result r =
                    CapabilityNegotiation.negotiate(server, client, mins);

            eq(r.ok, expected.get("ok"), name + " / ok");
            eq(r.agreedVersion, asIntOrNull(expected.get("agreedVersion")),
                    name + " / agreedVersion");
            eq(r.features, asStrings(expected.get("features")), name + " / features");
            eq(r.downgraded, expected.get("downgraded"), name + " / downgraded");
            eq(r.disabledFeatures, asStrings(expected.get("disabledFeatures")),
                    name + " / disabledFeatures");
        }

        System.out.println("passed=" + passed + " failed=" + failed);
        if (failed > 0) System.exit(1);
    }
}

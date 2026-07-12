package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Java twin of packages/cli/src/lib/capability-negotiation.js — bidirectional
 * capability negotiation with N / N-1 downgrade for Agent Protocol
 * (agent-sdk docs/PROTOCOL.md §1.2.2 / §1.3).
 *
 * <p>The JetBrains panel is a CLIENT: it builds a {@code hello} offer and reads
 * the CLI's {@code system/negotiated} reply. Keeping the SAME algorithm here
 * lets either side reason about the agreed level, and the shared fixture
 * ({@code packages/cli/__tests__/fixtures/capability-negotiation-cases.json},
 * asserted by {@code CapabilityNegotiationSmokeMain} + the JS
 * {@code capability-negotiation.test.js}) keeps the two honest.
 *
 * <p>Pure logic — no IntelliJ SDK. Mirrors the JS rules exactly:
 * agreedVersion = min(maxes); incompatible when below max(mins); effective
 * features = server-offered ∩ client-accepted minus version-gated; no client
 * offer keeps full behavior.
 */
public final class CapabilityNegotiation {

    public static final int PROTOCOL_VERSION = 1;
    public static final int PROTOCOL_MIN_VERSION = 1;
    public static final List<String> PROTOCOL_FEATURES =
            Collections.unmodifiableList(
                    Arrays.asList("event_seq", "tool_use_id", "trace_id"));

    private CapabilityNegotiation() {}

    /** Negotiation outcome (fields mirror the JS result object). */
    public static final class Result {
        public final boolean ok;
        /** Agreed version, or null when the ranges do not overlap. */
        public final Integer agreedVersion;
        public final List<String> features;          // sorted
        public final boolean downgraded;
        public final List<String> disabledFeatures;  // sorted
        public final boolean clientAware;
        public final String reason;

        Result(boolean ok, Integer agreedVersion, List<String> features,
               boolean downgraded, List<String> disabledFeatures,
               boolean clientAware, String reason) {
            this.ok = ok;
            this.agreedVersion = agreedVersion;
            this.features = features;
            this.downgraded = downgraded;
            this.disabledFeatures = disabledFeatures;
            this.clientAware = clientAware;
            this.reason = reason;
        }
    }

    private static int intOr(Object v, int fallback) {
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (d == Math.floor(d) && d > 0 && !Double.isInfinite(d)) {
                return (int) d;
            }
        }
        return fallback;
    }

    private static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean) return (Boolean) v;
        if (v instanceof Number) return ((Number) v).doubleValue() != 0;
        if (v instanceof String) return !((String) v).isEmpty();
        return true;
    }

    /** Array of strings, or truthy keys of an object → sorted de-duplicated list. */
    static List<String> normalizeFeatureList(Object input) {
        LinkedHashSet<String> keys = new LinkedHashSet<>();
        if (input instanceof List) {
            for (Object o : (List<?>) input) {
                if (o instanceof String && !((String) o).isEmpty()) keys.add((String) o);
            }
        } else if (input instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) input).entrySet()) {
                if (truthy(e.getValue())) keys.add(String.valueOf(e.getKey()));
            }
        } else {
            return new ArrayList<>();
        }
        List<String> out = new ArrayList<>(keys);
        Collections.sort(out);
        return out;
    }

    private static boolean versionOk(String feature, int version,
                                     Map<String, Integer> mins) {
        Integer m = mins == null ? null : mins.get(feature);
        return (m == null ? 0 : m) <= version;
    }

    /**
     * @param server         {@code {protocolVersion, minProtocolVersion?, features}}
     * @param clientOffer     null (legacy peer) or {@code {protocolVersion?, minProtocolVersion?, features?}}
     * @param featureMinVersion optional feature → minimum version gate (may be null)
     */
    public static Result negotiate(Map<String, Object> server,
                                   Map<String, Object> clientOffer,
                                   Map<String, Integer> featureMinVersion) {
        int serverMax = intOr(server.get("protocolVersion"), PROTOCOL_VERSION);
        int serverMin = intOr(server.get("minProtocolVersion"), serverMax);
        List<String> serverFeatures = normalizeFeatureList(server.get("features"));

        if (clientOffer == null) {
            List<String> feats = new ArrayList<>();
            for (String f : serverFeatures) {
                if (versionOk(f, serverMax, featureMinVersion)) feats.add(f);
            }
            return new Result(true, serverMax, feats, false,
                    new ArrayList<>(), false, null);
        }

        int clientMax = intOr(clientOffer.get("protocolVersion"), serverMax);
        int clientMin = intOr(clientOffer.get("minProtocolVersion"), clientMax);
        int agreedVersion = Math.min(serverMax, clientMax);
        int floor = Math.max(serverMin, clientMin);

        if (agreedVersion < floor) {
            List<String> disabled = new ArrayList<>(serverFeatures);
            Collections.sort(disabled);
            return new Result(false, null, new ArrayList<>(), true, disabled, true,
                    "no common protocol version (server " + serverMin + "-" + serverMax
                            + ", client " + clientMin + "-" + clientMax + ")");
        }

        // A client that omits `features` accepts whatever the agreed version
        // offers; present (even empty) narrows to the intersection.
        Set<String> clientFeatures = clientOffer.containsKey("features")
                ? new HashSet<>(normalizeFeatureList(clientOffer.get("features")))
                : null;

        List<String> enabled = new ArrayList<>();
        List<String> disabled = new ArrayList<>();
        for (String f : serverFeatures) {
            boolean okVersion = versionOk(f, agreedVersion, featureMinVersion);
            boolean okClient = clientFeatures == null || clientFeatures.contains(f);
            if (okVersion && okClient) enabled.add(f);
            else disabled.add(f);
        }
        Collections.sort(enabled);
        Collections.sort(disabled);
        boolean downgraded = agreedVersion < serverMax || !disabled.isEmpty();
        return new Result(true, agreedVersion, enabled, downgraded, disabled, true, null);
    }
}

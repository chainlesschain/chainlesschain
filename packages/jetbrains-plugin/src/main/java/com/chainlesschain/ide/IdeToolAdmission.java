package com.chainlesschain.ide;

/** IDE-to-CLI session-level tool admission envelope. Pure JDK and secret-free. */
public final class IdeToolAdmission {
    private IdeToolAdmission() {}

    public static String environmentJson() {
        return "{\"enforce\":true,\"source\":\"jetbrains-plugin\","
                + "\"capabilityGranted\":true,\"policyAllowed\":true,"
                + "\"permissionGranted\":true,\"budgetOk\":true,\"uiSupported\":true,"
                + "\"tools\":{\"publish_artifact\":{\"policyAllowed\":false},"
                + "\"notify\":{\"policyAllowed\":false}}}";
    }
}

package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Extra `cc agent` CLI args for a chat conversation — the Java twin of the VS
 * Code extension's buildSessionArgs (chat-events.js). Empty/missing values fall
 * through to the CLI's own config defaults. {@code mode} is the conversation's
 * approval mode (the /auto · /bypass · /normal selector); "default" or unset
 * adds no flag, so the agent keeps its normal per-action approval flow.
 *
 * Pure (no IntelliJ SDK); the chat tool-window glue passes the result as
 * {@code AgentChatSession.Options.extraArgs}.
 */
public final class SessionArgs {
    private SessionArgs() {}

    /**
     * Approval modes the panel may pass to {@code cc agent --permission-mode}.
     * "default" (and anything unknown) is intentionally absent → no flag. Plan
     * is accepted for completeness, though the panel drives plan mode live over
     * the stdin protocol rather than at spawn time.
     */
    public static final Set<String> PERMISSION_MODES = Collections.unmodifiableSet(
            new LinkedHashSet<String>(Arrays.asList("plan", "acceptEdits", "bypassPermissions")));

    /** Build the extra-args list (provider/model/resume/mode), omitting blanks. */
    public static List<String> build(String provider, String model, String resume, String mode) {
        return build(provider, model, resume, mode, null);
    }

    /**
     * Build the extra-args list including the extended-thinking toggle.
     * {@code think}: "on" → --think, "ultra" → --ultrathink (Anthropic only;
     * other providers ignore it); "off"/null/unknown adds nothing.
     */
    public static List<String> build(String provider, String model, String resume, String mode, String think) {
        return build(provider, model, null, null, resume, mode, think);
    }

    /**
     * Build the full extra-args list including the endpoint + key. The panel
     * pins --provider/--model and MUST also pass --base-url/--api-key: the CLI,
     * seeing an explicit --provider, skips config resolution and would otherwise
     * drop a cloud provider's baseUrl/key → the endpoint falls through to ollama
     * ("配置了火山却 fetch failed / 切到 ollama"). Blank baseUrl/apiKey are
     * omitted (back-compat: the CLI then resolves them itself).
     */
    public static List<String> build(String provider, String model, String baseUrl, String apiKey,
            String resume, String mode, String think) {
        List<String> args = new ArrayList<String>();
        if (notBlank(provider)) {
            args.add("--provider");
            args.add(provider.trim());
        }
        if (notBlank(model)) {
            args.add("--model");
            args.add(model.trim());
        }
        if (notBlank(baseUrl)) {
            args.add("--base-url");
            args.add(baseUrl.trim());
        }
        if (notBlank(apiKey)) {
            args.add("--api-key");
            args.add(apiKey.trim());
        }
        if (notBlank(resume)) {
            args.add("--resume");
            args.add(resume.trim());
        }
        if (mode != null && PERMISSION_MODES.contains(mode.trim())) {
            args.add("--permission-mode");
            args.add(mode.trim());
        }
        String t = think == null ? "" : think.trim();
        if ("ultra".equals(t)) {
            args.add("--ultrathink");
        } else if ("on".equals(t)) {
            args.add("--think");
        }
        return args;
    }

    private static boolean notBlank(String s) {
        return s != null && !s.trim().isEmpty();
    }
}

package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Project-memory commands — the Java twin of the VS Code extension's
 * project-memory-commands.js. The CLI does the real work
 * ({@code chainlesschain init} inventories the folder into a cc.md that
 * {@code cc agent} auto-loads; {@code memory files} shows the effective
 * chain); the plugin just builds args and shows the captured output.
 */
public final class ProjectMemory {

    private ProjectMemory() {}

    /** {@code init [--ai] [--force]} — generate/refresh the project's cc.md. */
    public static List<String> buildInitArgs(boolean ai, boolean force) {
        List<String> args = new ArrayList<String>(Arrays.asList("init"));
        if (ai) args.add("--ai");
        if (force) args.add("--force");
        return args;
    }

    /** {@code memory files} — list the effective memory-file chain. */
    public static List<String> buildMemoryFilesArgs() {
        return new ArrayList<String>(Arrays.asList("memory", "files"));
    }

    /**
     * Lean chat context (VS Code {@code chainlesschain.chat.leanContext} parity):
     * the value to set for the {@code CC_PROJECT_MEMORY} env var on the chat
     * panel's {@code cc agent} child, or {@code null} when the setting is off (do
     * not set the var at all). {@code "lean"} keeps only the primary entry
     * instruction file (cc.md/CLAUDE.md) and sheds CLAUDE.local.md, .claude/rules,
     * and .chainlesschain/rules.md — the heavy per-turn block. Delivered as an env
     * var, not a CLI flag, so an older {@code cc} that predates lean mode falls
     * back to full memory (safe) instead of erroring on an unknown flag.
     */
    public static String leanContextEnvValue(boolean enabled) {
        return enabled ? "lean" : null;
    }

    /** The two init modes for the chooser, {@code [label, description]} rows. */
    public static List<String[]> initModes() {
        return Arrays.asList(
                new String[] { "Offline inventory (default)",
                        "chainlesschain init — census languages/scripts/layout into a starter cc.md" },
                new String[] { "Inventory + AI refine (--ai)",
                        "Bounded headless agent fills the Conventions section with observed facts "
                        + "(needs a reachable LLM)" });
    }
}

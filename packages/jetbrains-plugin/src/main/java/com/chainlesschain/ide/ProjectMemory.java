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

package com.chainlesschain.ide;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Makes the npm-global ChainlessChain CLI ({@code cc}) reachable from spawned
 * processes even when the IDE itself did not inherit the npm global bin
 * directory on PATH.
 *
 * <p>The classic failure (reported as <em>"'cc' is not recognized as an
 * internal or external command"</em>) happens on Windows when IntelliJ is
 * launched from a Start-menu / desktop shortcut, or was already running when
 * {@code npm i -g chainlesschain} added {@code %APPDATA%\npm} to PATH: the
 * GUI process never sees that directory, so a plain {@code cmd /c cc …} can't
 * find the shim. Rather than make the user fix PATH and restart, we append the
 * usual npm / node bin directories to the spawned child's PATH so {@code cc}
 * resolves transparently.
 *
 * <p>Pure JDK (Java 8). The directory list and PATH merge are pure functions
 * (environment-injected) so they are smoke-testable headless.
 */
public final class CliLauncher {
    private CliLauncher() {}

    static boolean notBlank(String s) {
        return s != null && !s.trim().isEmpty();
    }

    /**
     * Likely npm-global / node bin directories, derived from environment
     * variables. Pure given {@code env}; never touches the filesystem (so it's
     * cheap and deterministic — existence is left to PATH resolution at spawn).
     */
    static List<String> candidateBinDirs(Map<String, String> env, boolean windows) {
        List<String> dirs = new ArrayList<String>();
        if (env == null) env = Collections.<String, String>emptyMap();

        // Node version managers first — they point at the ACTIVE node's bin,
        // which is where a global `cc` actually lives under nvm/volta/fnm.
        String nvmBin = env.get("NVM_BIN"); // nvm (posix)
        if (notBlank(nvmBin)) dirs.add(nvmBin);
        String volta = env.get("VOLTA_HOME"); // volta (any OS)
        if (notBlank(volta)) dirs.add(volta + (windows ? "\\bin" : "/bin"));
        String fnm = env.get("FNM_MULTISHELL_PATH"); // fnm
        if (notBlank(fnm)) dirs.add(fnm + (windows ? "" : "/bin"));

        if (windows) {
            String appdata = env.get("APPDATA"); // npm default global prefix
            if (notBlank(appdata)) dirs.add(appdata + "\\npm");
            String localAppData = env.get("LOCALAPPDATA");
            if (notBlank(localAppData)) dirs.add(localAppData + "\\npm");
            String nvmSym = env.get("NVM_SYMLINK"); // nvm-windows active symlink
            if (notBlank(nvmSym)) dirs.add(nvmSym);
            String pf = env.get("ProgramFiles");
            if (notBlank(pf)) dirs.add(pf + "\\nodejs");
        } else {
            String home = env.get("HOME");
            dirs.add("/usr/local/bin"); // homebrew (intel) / common global prefix
            dirs.add("/opt/homebrew/bin"); // homebrew (apple silicon)
            if (notBlank(home)) {
                dirs.add(home + "/.npm-global/bin");
                dirs.add(home + "/.local/bin");
                dirs.add(home + "/.volta/bin");
                dirs.add(home + "/.yarn/bin");
            }
            dirs.add("/usr/bin");
        }
        return dirs;
    }

    /**
     * {@code currentPath} with each candidate dir appended (only those not
     * already present), preserving the existing order so anything the IDE
     * already resolves still wins. Pure.
     */
    static String augmentedPath(String currentPath, List<String> dirs, char separator) {
        String sep = String.valueOf(separator);
        LinkedHashSet<String> parts = new LinkedHashSet<String>();
        if (currentPath != null) {
            for (String p : currentPath.split(Pattern.quote(sep), -1)) {
                if (!p.isEmpty()) parts.add(p);
            }
        }
        if (dirs != null) {
            for (String d : dirs) {
                if (notBlank(d)) parts.add(d);
            }
        }
        return String.join(sep, parts);
    }

    /**
     * Append the npm-global / node bin dirs to a {@link ProcessBuilder}'s PATH
     * in place, so {@code cc} (and its sibling shim names) resolve even when the
     * IDE process never inherited them. Best-effort and no-op-safe.
     */
    public static void augmentPath(ProcessBuilder pb) {
        if (pb == null) return;
        try {
            boolean windows = File.separatorChar == '\\';
            Map<String, String> env = pb.environment();
            List<String> dirs = candidateBinDirs(System.getenv(), windows);
            // Windows env keys are case-insensitive but the Map isn't — find the
            // real "Path"/"PATH" key so we EXTEND it rather than create a twin
            // that the OS would ignore.
            String pathKey = "PATH";
            for (String k : env.keySet()) {
                if ("PATH".equalsIgnoreCase(k)) {
                    pathKey = k;
                    break;
                }
            }
            env.put(pathKey, augmentedPath(env.get(pathKey), dirs, File.pathSeparatorChar));
            // Security: our spawns run `cmd.exe /c cc …` with cwd = the open
            // project root, and cmd.exe resolves a BARE command name from the
            // current directory BEFORE PATH — so a cloned/untrusted repo shipping
            // a `cc.bat`/`cc.cmd` at its root would be executed merely by opening
            // the chat panel or a version probe. This tells cmd.exe (and
            // CreateProcess) to skip the current-directory lookup.
            if (windows) env.put("NoDefaultCurrentDirectoryInExePath", "1");
        } catch (Throwable ignored) {
            // best-effort — a locked-down SecurityManager must not break spawns
        }
    }

    /** Heuristic: does this spawn output / error mean the cc executable wasn't found? */
    public static boolean looksLikeMissingCli(String output) {
        if (output == null) return false;
        String o = output.toLowerCase();
        return o.contains("not recognized as an internal or external command")
                || o.contains("command not found")
                || o.contains("no such file or directory")
                || o.contains("cannot run program")
                || o.contains("createprocess error=2")
                || o.contains("error=2,");
    }

    /** Actionable, user-facing guidance shown when {@code cc} cannot be located.
     *  Names the Node.js floor too — {@code npm i -g chainlesschain} aborts on
     *  older Node (the package's engines requires >= 22.12.0). */
    public static String missingCliMessage() {
        return "未找到 ChainlessChain CLI(cc)。请先安装(需 Node.js >= 22.12.0):"
                + "npm i -g chainlesschain —— 安装后重启 IDE(让它读到新的 PATH),"
                + "或在终端运行 `cc --version` 确认可用。";
    }
}

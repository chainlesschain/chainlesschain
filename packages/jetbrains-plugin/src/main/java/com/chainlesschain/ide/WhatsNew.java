package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * "What's New" — surface the cc CLI's own release notes ({@code cc changelog
 * --json}, shipped offline with the npm package since 0.162.151) inside the
 * IDE. The Java twin of the VS Code extension's whats-new.js: pure arg
 * builder + tolerant parser + text renderer; the glue (ShowWhatsNewAction)
 * drives {@code AgentChatSession.runCapture} + a dialog around them.
 */
public final class WhatsNew {

    private WhatsNew() {}

    /** First cc release that ships {@code cc changelog}. */
    public static final String MIN_CHANGELOG_CLI = "0.162.151";

    /** One release entry from {@code cc changelog --json}. */
    public static final class Release {
        public final String cliVersion;
        public final String productVersion; // nullable
        public final String date;           // nullable
        public final String title;          // nullable
        /** [heading (nullable), body (nullable)] pairs in document order. */
        public final List<String[]> sections;

        Release(String cliVersion, String productVersion, String date, String title,
                List<String[]> sections) {
            this.cliVersion = cliVersion;
            this.productVersion = productVersion;
            this.date = date;
            this.title = title;
            this.sections = sections;
        }
    }

    /** {@code cc changelog -n <limit> --json} — the panel's argv. */
    public static List<String> buildChangelogArgs(int limit) {
        return new ArrayList<String>(Arrays.asList(
                "changelog", "-n", String.valueOf(limit <= 0 ? 5 : limit), "--json"));
    }

    /** Does the installed cc ship {@code cc changelog}? (raw version output ok) */
    public static boolean supportsChangelog(String installedRaw) {
        String installed = CliVersionCheck.parseVersion(installedRaw);
        return installed != null
                && CliVersionCheck.compare(installed, MIN_CHANGELOG_CLI) >= 0;
    }

    /**
     * Tolerant parse of {@code cc changelog --json} stdout → releases (empty on
     * any mismatch — an old CLI printing an "unknown command" error, garbage…).
     */
    public static List<Release> parseChangelogJson(String stdout) {
        List<Release> out = new ArrayList<Release>();
        Map<String, Object> data;
        try {
            data = MiniJson.parseObject(stdout == null ? "" : stdout.trim());
        } catch (RuntimeException e) {
            return out;
        }
        Object releases = data.get("releases");
        if (!(releases instanceof List)) return out;
        for (Object row : (List<?>) releases) {
            if (!(row instanceof Map)) continue;
            Map<?, ?> r = (Map<?, ?>) row;
            Object cli = r.get("cliVersion");
            if (!(cli instanceof String) || ((String) cli).isEmpty()) continue;
            List<String[]> sections = new ArrayList<String[]>();
            Object secs = r.get("sections");
            if (secs instanceof List) {
                for (Object so : (List<?>) secs) {
                    if (!(so instanceof Map)) continue;
                    Map<?, ?> s = (Map<?, ?>) so;
                    sections.add(new String[] {
                            asStringOrNull(s.get("heading")),
                            asStringOrNull(s.get("body")) });
                }
            }
            out.add(new Release(
                    (String) cli,
                    asStringOrNull(r.get("productVersion")),
                    asStringOrNull(r.get("date")),
                    asStringOrNull(r.get("title")),
                    sections));
        }
        return out;
    }

    /**
     * Render releases into the text document the dialog shows — the same
     * markdown VS Code's changelogToMarkdown produces (the section bodies come
     * straight from the package's own curated changelog, so they already ARE
     * markdown and read fine as plain text). {@code installed} (nullable) marks
     * the user's version with "← installed".
     */
    public static String changelogToText(List<Release> releases, String installed) {
        StringBuilder sb = new StringBuilder("# cc CLI — What's New\n\n");
        for (Release rel : releases == null ? new ArrayList<Release>() : releases) {
            StringBuilder meta = new StringBuilder();
            if (rel.productVersion != null && !rel.productVersion.isEmpty()) {
                meta.append("product ").append(rel.productVersion);
            }
            if (rel.date != null && !rel.date.isEmpty()) {
                if (meta.length() > 0) meta.append(", ");
                meta.append(rel.date);
            }
            String mark = installed != null && installed.equals(rel.cliVersion)
                    ? " ← installed" : "";
            sb.append("## ").append(rel.cliVersion)
              .append(meta.length() > 0 ? " (" + meta + ")" : "")
              .append(mark).append("\n\n");
            if (rel.title != null && !rel.title.isEmpty()) {
                sb.append(rel.title).append("\n\n");
            }
            for (String[] s : rel.sections) {
                if (s[0] != null && !s[0].isEmpty()) sb.append("### ").append(s[0]).append("\n\n");
                if (s[1] != null && !s[1].isEmpty()) {
                    // Strip the changelog's blockquote markers — plain text dialog.
                    sb.append(s[1].replaceAll("(?m)^>\\s?", "")).append("\n\n");
                }
            }
        }
        return sb.toString().replaceAll("\n{3,}", "\n\n");
    }

    private static String asStringOrNull(Object v) {
        return v instanceof String && !((String) v).isEmpty() ? (String) v : null;
    }
}

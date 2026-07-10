package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.DeepLink;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.JBProtocolCommand;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.project.ProjectManager;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;

/**
 * {@code jetbrains://} deep-link handler — VS Code {@code registerUriHandler}
 * parity. Opening
 * {@code jetbrains://idea/chainlesschain/open?prompt=fix%20the%20bug} focuses
 * the ChainlessChain chat tool window and optionally seeds a prompt, so docs,
 * scripts, or the CLI can hand off into the IDE chat.
 *
 * <p>Registered via the {@code com.intellij.jbProtocolCommand} extension point;
 * the command name ({@code "chainlesschain"}) is the authority segment of the
 * URL. Parsing lives in the SDK-free, smoke-tested {@link DeepLink}; this class
 * is the thin platform glue.
 *
 * <p>We override the Java-friendly {@code perform(target, parameters, fragment)}
 * (the platform's default suspend {@code execute} delegates to it): return
 * {@code null} inside the Future on success, or a short error string the
 * platform surfaces to the user.
 */
public final class CcProtocolCommand extends JBProtocolCommand {
    public CcProtocolCommand() {
        super("chainlesschain");
    }

    @Override
    public @NotNull Future<String> perform(
            @Nullable String target,
            @NotNull Map<String, String> parameters,
            @Nullable String fragment) {
        DeepLink.Action link = DeepLink.parse(target, parameters);
        if (link == null) {
            return CompletableFuture.completedFuture(
                    "ChainlessChain: unsupported deep link");
        }
        Project project = firstOpenProject();
        if (project == null) {
            return CompletableFuture.completedFuture(
                    "ChainlessChain: no open project to focus");
        }
        // A link may target a specific workspace; if the open project doesn't
        // match, don't silently act on the wrong repo (VS twin does the same).
        if (link.workspace != null && !workspaceMatches(project, link.workspace)) {
            return CompletableFuture.completedFuture(
                    "ChainlessChain: link targets a different workspace — ignored");
        }
        final DeepLink.Action a = link;
        // Tool-window activation + panel access are EDT-only; the protocol
        // dispatcher may call us off the EDT.
        ApplicationManager.getApplication().invokeLater(() ->
                ChatToolWindowFactory.onPanel(project, panel -> {
                    // Order mirrors the VS twin: resume → mode → prompt → file.
                    if (a.session != null) panel.resumeSession(a.session);
                    if (a.mode != null) panel.applyApprovalMode(a.mode);
                    if (a.prompt != null) panel.seedActiveInput(a.prompt);
                    if (a.file != null) panel.openFileAtLine(a.file, a.line);
                }));
        return CompletableFuture.completedFuture(null); // null = success
    }

    private static boolean workspaceMatches(Project project, String want) {
        String base = project.getBasePath();
        if (base == null) return true; // can't tell → don't block
        String a = base.replace('\\', '/').replaceAll("/+$", "").toLowerCase();
        String b = want.replace('\\', '/').replaceAll("/+$", "").toLowerCase();
        return a.equals(b);
    }

    private static @Nullable Project firstOpenProject() {
        Project[] open = ProjectManager.getInstance().getOpenProjects();
        return open.length > 0 ? open[0] : null;
    }
}

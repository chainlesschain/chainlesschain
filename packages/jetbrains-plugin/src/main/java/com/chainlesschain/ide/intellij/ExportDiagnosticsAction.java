package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.DiagnosticBundleExport;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.fileChooser.FileChooserFactory;
import com.intellij.openapi.fileChooser.FileSaverDescriptor;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileWrapper;
import org.jetbrains.annotations.NotNull;

import javax.swing.SwingUtilities;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * Tools-menu one-click de-identified support bundle.
 *
 * <p>The save dialog authorizes the destination. The CLI writes to a private
 * sibling temp and runs its own secret-scan gate; this action validates the v1
 * contract before replacing the destination, so CLI failure never truncates a
 * user's previous bundle.
 */
public final class ExportDiagnosticsAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) return;
        FileSaverDescriptor descriptor = newJsonSaverDescriptor(
                CcBundle.message("diagnostic.export.title"),
                CcBundle.message("diagnostic.export.description"));
        VirtualFileWrapper wrapper = FileChooserFactory.getInstance()
                .createSaveFileDialog(descriptor, project)
                .save((VirtualFile) null, "cc-diagnostic-bundle.json");
        if (wrapper == null) return;

        Path target = wrapper.getFile().toPath().toAbsolutePath().normalize();
        ApplicationManager.getApplication().executeOnPooledThread(
                () -> export(project, target));
    }

    private static void export(Project project, Path target) {
        Path temp = null;
        String failure = null;
        try {
            Path parent = target.getParent();
            if (parent == null || !Files.isDirectory(parent)) {
                throw new IllegalStateException(
                        "Diagnostic bundle directory not found: " + parent);
            }
            if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)
                    && (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)
                            || Files.isSymbolicLink(target))) {
                throw new IllegalStateException(
                        "Diagnostic bundle target must be a regular file");
            }

            temp = Files.createTempFile(
                    parent, ".cc-diagnostic-bundle-", ".tmp");
            File cwd = project.getBasePath() == null
                    ? null : new File(project.getBasePath());
            AgentChatSession.runCapture(
                    DiagnosticBundleExport.buildArgs(temp.toString()),
                    cwd,
                    60000);
            String body = Files.readString(temp, StandardCharsets.UTF_8);
            if (!DiagnosticBundleExport.isValidBundle(body)) {
                throw new IllegalStateException(
                        "CLI did not produce a valid "
                                + DiagnosticBundleExport.SCHEMA);
            }
            Files.copy(
                    temp,
                    target,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception error) {
            failure = boundedMessage(error);
        } finally {
            if (temp != null) {
                try {
                    Files.deleteIfExists(temp);
                } catch (Exception ignored) {
                    // Best-effort; the validated destination is already safe.
                }
            }
        }

        String error = failure;
        SwingUtilities.invokeLater(() -> {
            if (error != null) {
                Messages.showErrorDialog(
                        project,
                        CcBundle.message("diagnostic.export.failed", error),
                        CcBundle.message("diagnostic.export.title"));
                return;
            }
            VirtualFile vf = LocalFileSystem.getInstance()
                    .refreshAndFindFileByNioFile(target);
            if (vf != null) {
                FileEditorManager.getInstance(project).openFile(vf, true);
            }
            Messages.showInfoMessage(
                    project,
                    CcBundle.message(
                            "diagnostic.export.saved", target.toString()),
                    CcBundle.message("diagnostic.export.title"));
        });
    }

    private static String boundedMessage(Throwable error) {
        String message = error == null || error.getMessage() == null
                ? String.valueOf(error) : error.getMessage();
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    /**
     * Constructor compatibility twin of DiagnoseBridgeAction's save dialog:
     * 2024.3 added the scalar extension overload while 242 only has varargs.
     */
    private static FileSaverDescriptor newJsonSaverDescriptor(
            String title, String description) {
        try {
            return FileSaverDescriptor.class
                    .getConstructor(
                            String.class, String.class, String.class)
                    .newInstance(title, description, "json");
        } catch (ReflectiveOperationException pre243) {
            try {
                return FileSaverDescriptor.class
                        .getConstructor(
                                String.class, String.class, String[].class)
                        .newInstance(
                                title, description, new String[] { "json" });
            } catch (ReflectiveOperationException error) {
                throw new IllegalStateException(
                        "No usable FileSaverDescriptor constructor", error);
            }
        }
    }
}

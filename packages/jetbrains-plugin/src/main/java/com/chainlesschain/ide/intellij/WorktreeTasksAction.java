package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.CliLauncher;
import com.chainlesschain.ide.WorktreeTasks;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.DefaultListModel;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.BorderFactory;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Worktree parallel tasks dialog (Tools menu, P1 #9) — lists agent task
 * worktrees and routes preview/show/apply/rollback through the CLI-authoritative
 * {@code team merge-review} v1 contract. The IDE selects stable file/hunk IDs;
 * it never accepts patch bytes or invokes {@code git merge}. New-task and the
 * explicitly-confirmed discard workflow retain their existing compatibility.
 */
public final class WorktreeTasksAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        final File repo = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        if (repo == null) {
            Messages.showInfoMessage(project, "Open a project first.", "Worktree Tasks");
            return;
        }

        final AtomicReference<List<Map<String, Object>>> tasks = new AtomicReference<>();
        final AtomicReference<String> mainBranch = new AtomicReference<>("");
        DefaultListModel<String> model = new DefaultListModel<>();
        JList<String> list = new JList<>(model);
        JLabel status = new JLabel(" ");

        Runnable refresh = () -> {
            status.setText("loading…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                Git list0 = git(WorktreeTasks.buildWorktreeListArgs(), repo);
                Git background = cli(WorktreeTasks.buildBackgroundListArgs(), repo);
                List<Map<String, Object>> rows =
                        WorktreeTasks.parseWorktreeList(list0.stdout);
                Map<String, Object> main = rows.isEmpty() ? null : rows.get(0);
                String base = main == null ? "HEAD" : String.valueOf(main.get("branch"));
                String baseHead = main == null ? "HEAD" : String.valueOf(main.get("head"));
                List<Map<String, Object>> worktrees = new ArrayList<>();
                for (Map<String, Object> r : rows) {
                    if (Boolean.TRUE.equals(r.get("main"))
                            || !Boolean.TRUE.equals(r.get("isTask"))) continue;
                    String branch = String.valueOf(r.get("branch"));
                    Git st = git(WorktreeTasks.buildStatusArgs(),
                            new File(String.valueOf(r.get("path"))));
                    Git ahead = git(WorktreeTasks.buildAheadArgs(baseHead, branch), repo);
                    Git stat = git(WorktreeTasks.buildShortstatArgs(baseHead, branch), repo);
                    r.put("dirty", st.code == 0 && !st.stdout.trim().isEmpty());
                    long aheadN;
                    try {
                        aheadN = Long.parseLong(ahead.stdout.trim());
                    } catch (NumberFormatException nfe) {
                        aheadN = 0;
                    }
                    r.put("ahead", aheadN);
                    r.put("stat", WorktreeTasks.summarizeShortstat(stat.stdout));
                    worktrees.add(r);
                }
                List<Map<String, Object>> enriched =
                        WorktreeTasks.attachTaskGovernance(worktrees, background.stdout);
                tasks.set(enriched);
                mainBranch.set(base);
                ApplicationManager.getApplication().invokeLater(() -> {
                    model.clear();
                    if (list0.code != 0) {
                        model.addElement("(not a git repository: "
                                + list0.stderr.trim() + ")");
                    } else if (enriched.isEmpty()) {
                        model.addElement("(no agent task worktrees — cc-agent-* / "
                                + "batch/* / agent/* / team/*; New task… starts one)");
                    } else {
                        for (Map<String, Object> t : enriched) {
                            model.addElement(WorktreeTasks.formatTaskLine(t));
                        }
                    }
                    status.setText("base: " + base);
                });
            });
        };

        JButton newTask = new JButton("New isolated task…");
        JButton reviewApply = new JButton("Review & apply…");
        JButton rollback = new JButton("Rollback last…");
        JButton discard = new JButton("Discard…");
        JButton refreshBtn = new JButton("Refresh");
        AtomicReference<WorktreeTasks.MergeReviewEnvelope> appliedReview =
                new AtomicReference<>();
        rollback.setEnabled(false);

        newTask.addActionListener(ev -> {
            String task = Messages.showInputDialog(project,
                    "Task for the isolated agent (runs in its own git worktree + branch)",
                    "New Isolated Task", null);
            if (task == null || task.trim().isEmpty()) return;
            status.setText("resolving cc…");
            // resolveBinary()'s first use runs up to 4 serial cmd.exe probes
            // (12s budget each) — never on the EDT; terminal glue back on it.
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                final String cmd = WorktreeTasks.buildNewTaskCommand(task,
                        AgentChatSession.resolveBinary(), File.separatorChar == '\\');
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (runInTerminal(project, repo, cmd)) {
                        status.setText("task started in the integrated terminal — Refresh lists it");
                    } else {
                        // Terminal plugin absent — hand the command over instead.
                        status.setText(" ");
                        Messages.showInfoMessage(project,
                                "Run this in a terminal at the project root:\n\n" + cmd,
                                "New Isolated Task");
                    }
                });
            });
        });
        reviewApply.addActionListener(ev -> withSelected(
                project, list, tasks.get(), task -> startMergeReview(
                        project, repo, task, mainBranch.get(), status,
                        reviewApply, rollback, appliedReview, refresh)));
        rollback.addActionListener(ev -> startRollback(
                project, repo, status, rollback, appliedReview, refresh));
        discard.addActionListener(ev -> withSelected(project, list, tasks.get(), t -> {
            String branch = String.valueOf(t.get("branch"));
            String path = String.valueOf(t.get("path"));
            int r = Messages.showYesNoDialog(project,
                    "Discard worktree task " + branch + "? The worktree at " + path
                            + " is removed and the branch is deleted — unmerged commits are LOST.",
                    "Discard Worktree Task", null);
            if (r != Messages.YES) return;
            status.setText("discarding " + branch + "…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                git(WorktreeTasks.buildWorktreeRemoveArgs(path), repo);
                git(WorktreeTasks.buildBranchDeleteArgs(branch), repo);
                ApplicationManager.getApplication().invokeLater(refresh::run);
            });
        }));
        refreshBtn.addActionListener(ev -> refresh.run());

        JPanel root = new JPanel(new BorderLayout(6, 6));
        root.add(new JScrollPane(list), BorderLayout.CENTER);
        JPanel bottom = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        bottom.add(newTask);
        bottom.add(reviewApply);
        bottom.add(rollback);
        bottom.add(discard);
        bottom.add(refreshBtn);
        bottom.add(status);
        root.add(bottom, BorderLayout.SOUTH);
        root.setPreferredSize(new Dimension(880, 420));

        refresh.run();
        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain — Worktree Tasks");
        b.setCenterPanel(root);
        b.addOkAction().setText("Close");
        b.show();
    }

    private static void startMergeReview(Project project, File repo,
            Map<String, Object> task, String baseBranch, JLabel status,
            JButton reviewApply, JButton rollback,
            AtomicReference<WorktreeTasks.MergeReviewEnvelope> appliedReview,
            Runnable refresh) {
        final String branch = String.valueOf(task.get("branch"));
        reviewApply.setEnabled(false);
        status.setText("requesting CLI merge review for " + branch + "…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                List<String> previewArgs = WorktreeTasks.buildMergeReviewPreviewArgs(
                        java.util.Collections.singletonList(branch), baseBranch, null,
                        "jetbrains-worktree-tasks",
                        "Review worktree task " + branch);
                Git previewResult = cli(previewArgs, repo);
                if (previewResult.code != 0) {
                    throw new IllegalStateException(commandFailure(
                            "merge-review preview", previewResult));
                }
                WorktreeTasks.MergeReviewEnvelope preview =
                        WorktreeTasks.parseMergeReviewEnvelope(
                                previewResult.stdout, "preview");

                List<String> expectedShow = WorktreeTasks.buildMergeReviewShowArgs(
                        preview.review.reviewId, null);
                List<String> showArgs = WorktreeTasks.selectMergeReviewActionArgs(
                        preview, "show", expectedShow);
                if (showArgs == null) {
                    throw new IllegalStateException(
                            "CLI did not issue the exact show action for this review");
                }
                Git showResult = cli(showArgs, repo);
                if (showResult.code != 0) {
                    throw new IllegalStateException(commandFailure(
                            "merge-review show", showResult));
                }
                WorktreeTasks.MergeReviewEnvelope shown =
                        WorktreeTasks.parseMergeReviewEnvelope(showResult.stdout, "show");
                WorktreeTasks.requireSameReviewAuthority(
                        preview.review, shown.review);

                ApplicationManager.getApplication().invokeLater(() -> {
                    ReviewSelection selection = showSelectionDialog(project, shown.review);
                    if (selection == null) {
                        reviewApply.setEnabled(true);
                        status.setText("merge review cancelled");
                        return;
                    }
                    status.setText("applying selected CLI merge review "
                            + shown.review.reviewId + "…");
                    ApplicationManager.getApplication().executeOnPooledThread(() -> {
                        try {
                            List<String> applyArgs = WorktreeTasks.buildMergeReviewApplyArgs(
                                    shown.review, selection.fileIds, selection.hunkIds,
                                    null, "jetbrains-worktree-tasks",
                                    "Approved selected files and hunks in JetBrains");
                            Git applyResult = cli(applyArgs, repo);
                            if (applyResult.code != 0) {
                                throw new IllegalStateException(commandFailure(
                                        "merge-review apply", applyResult));
                            }
                            WorktreeTasks.MergeReviewEnvelope applied =
                                    WorktreeTasks.parseMergeReviewEnvelope(
                                            applyResult.stdout, "apply");
                            if ("conflicted".equals(applied.review.state)) {
                                WorktreeTasks.requireConflictedTransition(
                                        shown.review, applied.review);
                                String explanation = boundedDisplay(
                                        WorktreeTasks.explainMergeReviewConflicts(
                                                applied.review), 6000);
                                ApplicationManager.getApplication().invokeLater(() -> {
                                    reviewApply.setEnabled(true);
                                    status.setText("merge review "
                                            + applied.review.reviewId
                                            + " is conflicted; base was not published");
                                    Messages.showWarningDialog(project,
                                            "The CLI refused to publish this selection.\n\n"
                                                    + explanation,
                                            "Merge Review Conflicts");
                                    refresh.run();
                                });
                                return;
                            }
                            WorktreeTasks.requirePublishedTransition(
                                    shown.review, applied.review);
                            appliedReview.set(applied);
                            ApplicationManager.getApplication().invokeLater(() -> {
                                reviewApply.setEnabled(true);
                                rollback.setEnabled(true);
                                status.setText("published merge review "
                                        + applied.review.reviewId + " at revision "
                                        + applied.review.revision);
                                refresh.run();
                            });
                        } catch (RuntimeException error) {
                            failReview(project, reviewApply, status,
                                    "Apply Merge Review", error);
                        }
                    });
                });
            } catch (RuntimeException error) {
                failReview(project, reviewApply, status,
                        "Open Merge Review", error);
            }
        });
    }

    private static void startRollback(Project project, File repo, JLabel status,
            JButton rollback,
            AtomicReference<WorktreeTasks.MergeReviewEnvelope> appliedReview,
            Runnable refresh) {
        WorktreeTasks.MergeReviewEnvelope applied = appliedReview.get();
        if (applied == null) {
            Messages.showInfoMessage(project,
                    "No merge review applied during this dialog can be rolled back.",
                    "Rollback Merge Review");
            return;
        }
        String confirmation = Messages.showInputDialog(project,
                "Type the exact review ID to roll back revision "
                        + applied.review.revision + ":\n"
                        + applied.review.reviewId,
                "Confirm Merge Review Rollback", null);
        if (confirmation == null) return;
        if (!applied.review.reviewId.equals(confirmation)) {
            Messages.showErrorDialog(project,
                    "Rollback confirmation did not exactly match the review ID.",
                    "Rollback Merge Review");
            return;
        }
        rollback.setEnabled(false);
        status.setText("rolling back " + applied.review.reviewId + "…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                List<String> expected = WorktreeTasks.buildMergeReviewRollbackArgs(
                        applied.review, confirmation, null);
                List<String> rollbackArgs = WorktreeTasks.selectMergeReviewActionArgs(
                        applied, "rollback", expected);
                if (rollbackArgs == null) {
                    throw new IllegalStateException(
                            "CLI did not issue the exact rollback action for this revision");
                }
                Git rollbackResult = cli(rollbackArgs, repo);
                if (rollbackResult.code != 0) {
                    throw new IllegalStateException(commandFailure(
                            "merge-review rollback", rollbackResult));
                }
                WorktreeTasks.MergeReviewEnvelope rolledBack =
                        WorktreeTasks.parseMergeReviewEnvelope(
                                rollbackResult.stdout, "rollback");
                WorktreeTasks.requireRolledBackTransition(
                        applied.review, rolledBack.review);
                appliedReview.set(null);
                ApplicationManager.getApplication().invokeLater(() -> {
                    rollback.setEnabled(false);
                    status.setText("rolled back merge review "
                            + rolledBack.review.reviewId);
                    refresh.run();
                });
            } catch (RuntimeException error) {
                ApplicationManager.getApplication().invokeLater(() -> {
                    rollback.setEnabled(true);
                    status.setText("rollback refused");
                    Messages.showErrorDialog(project, safeMessage(error),
                            "Rollback Merge Review");
                });
            }
        });
    }

    private static ReviewSelection showSelectionDialog(
            Project project, WorktreeTasks.MergeReview review) {
        JPanel content = new JPanel();
        content.setLayout(new BoxLayout(content, BoxLayout.Y_AXIS));
        content.add(new JLabel("Review " + review.reviewId + " · revision "
                + review.revision + " · state " + review.state));
        content.add(new JLabel("Plan " + review.planDigest));

        if (!review.conflicts.isEmpty()) {
            JTextArea conflicts = new JTextArea(
                    WorktreeTasks.explainMergeReviewConflicts(review));
            conflicts.setEditable(false);
            conflicts.setLineWrap(true);
            conflicts.setWrapStyleWord(true);
            conflicts.setRows(Math.min(10, 3 + review.conflicts.size() * 2));
            conflicts.setBorder(BorderFactory.createTitledBorder(
                    "CLI conflict explanation (select only what should publish)"));
            content.add(conflicts);
        }

        Map<WorktreeTasks.ReviewFile, JCheckBox> fileChecks =
                new LinkedHashMap<>();
        Map<WorktreeTasks.ReviewHunk, JCheckBox> hunkChecks =
                new LinkedHashMap<>();
        for (WorktreeTasks.ReviewFile file : review.files) {
            JPanel filePanel = new JPanel();
            filePanel.setLayout(new BoxLayout(filePanel, BoxLayout.Y_AXIS));
            filePanel.setBorder(BorderFactory.createTitledBorder(
                    file.candidateKey + " · " + file.status));
            JCheckBox wholeFile = new JCheckBox(
                    "Entire file: " + file.path + (file.binary ? " [binary]" : ""),
                    file.selected);
            fileChecks.put(file, wholeFile);
            filePanel.add(wholeFile);
            List<JCheckBox> children = new ArrayList<>();
            for (WorktreeTasks.ReviewHunk hunk : file.hunks) {
                JCheckBox hunkBox = new JCheckBox(
                        "Hunk " + hunk.header + " ("
                                + hunk.oldStart + "," + hunk.oldLines + " → "
                                + hunk.newStart + "," + hunk.newLines + ")",
                        hunk.selected);
                hunkChecks.put(hunk, hunkBox);
                children.add(hunkBox);
                filePanel.add(hunkBox);
                hunkBox.addActionListener(event -> {
                    if (hunkBox.isSelected()) wholeFile.setSelected(false);
                });
            }
            wholeFile.addActionListener(event -> {
                if (wholeFile.isSelected()) {
                    for (JCheckBox child : children) child.setSelected(false);
                }
                for (JCheckBox child : children) {
                    child.setEnabled(!wholeFile.isSelected());
                }
            });
            if (wholeFile.isSelected()) {
                for (JCheckBox child : children) child.setEnabled(false);
            }
            content.add(filePanel);
        }

        JScrollPane scroll = new JScrollPane(content);
        scroll.setPreferredSize(new Dimension(820, 560));
        DialogBuilder dialog = new DialogBuilder(project);
        dialog.setTitle("CLI Merge Review — select files and hunks");
        dialog.setCenterPanel(scroll);
        dialog.addOkAction().setText("Apply selected changes");
        dialog.addCancelAction();
        if (!dialog.showAndGet()) return null;

        List<String> fileIds = new ArrayList<>();
        List<String> hunkIds = new ArrayList<>();
        for (Map.Entry<WorktreeTasks.ReviewFile, JCheckBox> entry
                : fileChecks.entrySet()) {
            if (entry.getValue().isSelected()) fileIds.add(entry.getKey().id);
        }
        for (Map.Entry<WorktreeTasks.ReviewHunk, JCheckBox> entry
                : hunkChecks.entrySet()) {
            if (entry.getValue().isSelected()) hunkIds.add(entry.getKey().id);
        }
        try {
            WorktreeTasks.validateApplySelection(review, fileIds, hunkIds);
        } catch (IllegalArgumentException error) {
            Messages.showErrorDialog(project, safeMessage(error),
                    "Invalid Merge Review Selection");
            return null;
        }
        int confirm = Messages.showYesNoDialog(project,
                "Publish " + fileIds.size() + " complete file(s) and "
                        + hunkIds.size() + " individual hunk(s)?\n\n"
                        + "The CLI will revalidate revision " + review.revision
                        + " and plan digest before changing the base branch.",
                "Confirm CLI Merge Review", "Publish", "Cancel", null);
        return confirm == Messages.YES
                ? new ReviewSelection(fileIds, hunkIds) : null;
    }

    private static void failReview(Project project, JButton button,
            JLabel status, String title, RuntimeException error) {
        ApplicationManager.getApplication().invokeLater(() -> {
            button.setEnabled(true);
            status.setText("merge review refused");
            Messages.showErrorDialog(project, safeMessage(error), title);
        });
    }

    private static String commandFailure(String operation, Git result) {
        String detail = result.stderr == null ? "" : result.stderr.trim();
        if (detail.isEmpty()) detail = "CLI exited with code " + result.code;
        return operation + " failed: " + boundedDisplay(detail, 500);
    }

    private static String safeMessage(Throwable error) {
        String message = error == null || error.getMessage() == null
                ? "Merge-review authority rejected the operation."
                : error.getMessage();
        return boundedDisplay(message, 700);
    }

    private static String boundedDisplay(String value, int max) {
        String clean = String.valueOf(value == null ? "" : value)
                .replaceAll("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]", " ")
                .trim();
        return clean.substring(0, Math.min(max, clean.length()));
    }

    private static final class ReviewSelection {
        final List<String> fileIds;
        final List<String> hunkIds;

        ReviewSelection(List<String> fileIds, List<String> hunkIds) {
            this.fileIds = fileIds;
            this.hunkIds = hunkIds;
        }
    }

    private static void withSelected(Project project, JList<String> list,
            List<Map<String, Object>> rows,
            java.util.function.Consumer<Map<String, Object>> action) {
        int idx = list.getSelectedIndex();
        if (rows == null || idx < 0 || idx >= rows.size()) {
            Messages.showInfoMessage(project, "Select a task row first.", "Worktree Tasks");
            return;
        }
        action.accept(rows.get(idx));
    }

    /** Open an integrated terminal at the repo root and run the command.
     *  Terminal-plugin classes may be absent — Throwable-guarded. */
    private static boolean runInTerminal(Project project, File repo, String cmd) {
        try {
            TerminalLauncher.run(project, repo.getAbsolutePath(), "cc worktree task", cmd);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private static final class Git {
        final int code;
        final String stdout;
        final String stderr;
        Git(int code, String stdout, String stderr) {
            this.code = code;
            this.stdout = stdout;
            this.stderr = stderr;
        }
    }

    /** Run git with captured stdout/stderr; never throws (code -1 on failure). */
    private static Git git(List<String> args, File cwd) {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        cmd.addAll(args);
        return run(cmd, cwd);
    }

    /** Run the resolved cc binary with captured stdout/stderr. */
    private static Git cli(List<String> args, File cwd) {
        List<String> cmd = new ArrayList<>();
        cmd.add(AgentChatSession.resolveBinary());
        cmd.addAll(args);
        return run(cmd, cwd);
    }

    private static Git run(List<String> cmd, File cwd) {
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.directory(cwd);
            CliLauncher.augmentPath(pb);
            Process p = pb.start();
            // StringBuffer, not StringBuilder: the pump threads append while the
            // final toString() below reads after a waitFor timeout / join(500)
            // timeout — an unsynchronized StringBuilder read can tear (mirrors
            // AgentChatSession.runCaptureWith), garbling parseWorktreeList or
            // strict merge-review JSON into a wrong verdict.
            StringBuffer out = new StringBuffer();
            StringBuffer err = new StringBuffer();
            Thread outT = pump(p.getInputStream(), out);
            Thread errT = pump(p.getErrorStream(), err);
            if (!p.waitFor(60, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return new Git(-1, out.toString(), "timeout");
            }
            outT.join(500);
            errT.join(500);
            return new Git(p.exitValue(), out.toString(), err.toString());
        } catch (Exception ex) {
            if (ex instanceof InterruptedException) Thread.currentThread().interrupt();
            return new Git(-1, "", String.valueOf(ex.getMessage()));
        }
    }

    private static Thread pump(java.io.InputStream in, StringBuffer sink) {
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    // StringBuffer.append is already atomic; the two-call
                    // sequence is grouped so a reader never sees a line without
                    // its newline.
                    synchronized (sink) {
                        sink.append(line).append('\n');
                    }
                }
            } catch (Exception ignored) {
                // closed / killed
            }
        }, "cc-worktree-git-pump");
        t.setDaemon(true);
        t.start();
        return t;
    }
}

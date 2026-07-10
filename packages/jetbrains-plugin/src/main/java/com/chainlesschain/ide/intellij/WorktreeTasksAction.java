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
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Worktree parallel tasks dialog (Tools menu, P1 #9) — lists agent task
 * worktrees (change footprint + merge-conflict preview via {@code git
 * merge-tree --write-tree}), with New isolated task (integrated terminal
 * running {@code cc agent --worktree -p …} when the Terminal plugin is
 * present), Merge back (aborted clean on conflicts) and Discard (worktree
 * remove + branch -D, confirmed). Pure core: {@link WorktreeTasks}. VS Code
 * twin: {@code chainlesschain.worktree.tasks} (webview form).
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
                List<Map<String, Object>> rows =
                        WorktreeTasks.parseWorktreeList(list0.stdout);
                Map<String, Object> main = rows.isEmpty() ? null : rows.get(0);
                String base = main == null ? "HEAD" : String.valueOf(main.get("branch"));
                String baseHead = main == null ? "HEAD" : String.valueOf(main.get("head"));
                List<Map<String, Object>> enriched = new ArrayList<>();
                for (Map<String, Object> r : rows) {
                    if (Boolean.TRUE.equals(r.get("main"))
                            || !Boolean.TRUE.equals(r.get("isTask"))) continue;
                    String branch = String.valueOf(r.get("branch"));
                    Git st = git(WorktreeTasks.buildStatusArgs(),
                            new File(String.valueOf(r.get("path"))));
                    Git ahead = git(WorktreeTasks.buildAheadArgs(baseHead, branch), repo);
                    Git stat = git(WorktreeTasks.buildShortstatArgs(baseHead, branch), repo);
                    Git prev = git(WorktreeTasks.buildMergePreviewArgs(base, branch), repo);
                    r.put("dirty", st.code == 0 && !st.stdout.trim().isEmpty());
                    long aheadN;
                    try {
                        aheadN = Long.parseLong(ahead.stdout.trim());
                    } catch (NumberFormatException nfe) {
                        aheadN = 0;
                    }
                    r.put("ahead", aheadN);
                    r.put("stat", WorktreeTasks.summarizeShortstat(stat.stdout));
                    r.put("merge", WorktreeTasks.parseMergePreview(
                            prev.code, prev.stdout, prev.stderr));
                    enriched.add(r);
                }
                tasks.set(enriched);
                mainBranch.set(base);
                ApplicationManager.getApplication().invokeLater(() -> {
                    model.clear();
                    if (list0.code != 0) {
                        model.addElement("(not a git repository: "
                                + list0.stderr.trim() + ")");
                    } else if (enriched.isEmpty()) {
                        model.addElement("(no agent task worktrees — cc-agent-* / "
                                + "batch/* / agent/*; New task… starts one)");
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
        JButton merge = new JButton("Merge");
        JButton discard = new JButton("Discard…");
        JButton refreshBtn = new JButton("Refresh");

        newTask.addActionListener(ev -> {
            String task = Messages.showInputDialog(project,
                    "Task for the isolated agent (runs in its own git worktree + branch)",
                    "New Isolated Task", null);
            if (task == null || task.trim().isEmpty()) return;
            String cmd = WorktreeTasks.buildNewTaskCommand(task,
                    AgentChatSession.resolveBinary(), File.separatorChar == '\\');
            if (runInTerminal(project, repo, cmd)) {
                status.setText("task started in the integrated terminal — Refresh lists it");
            } else {
                // Terminal plugin absent — hand the command over instead.
                Messages.showInfoMessage(project,
                        "Run this in a terminal at the project root:\n\n" + cmd,
                        "New Isolated Task");
            }
        });
        merge.addActionListener(ev -> withSelected(project, list, tasks.get(), t -> {
            String branch = String.valueOf(t.get("branch"));
            status.setText("merging " + branch + "…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                Git res = git(WorktreeTasks.buildMergeArgs(branch), repo);
                if (res.code != 0) {
                    git(WorktreeTasks.buildMergeAbortArgs(), repo);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        status.setText("merge " + branch + " FAILED and was aborted"
                                + " — resolve manually: git merge " + branch);
                        refresh.run();
                    });
                    return;
                }
                ApplicationManager.getApplication().invokeLater(() -> {
                    status.setText("merged " + branch + " into " + mainBranch.get());
                    refresh.run();
                });
            });
        }));
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
        bottom.add(merge);
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
            com.intellij.terminal.ui.TerminalWidget widget =
                    org.jetbrains.plugins.terminal.TerminalToolWindowManager
                            .getInstance(project)
                            .createShellWidget(repo.getAbsolutePath(), "cc worktree task", true, true);
            widget.sendCommandToExecute(cmd);
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
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.directory(cwd);
            CliLauncher.augmentPath(pb);
            Process p = pb.start();
            StringBuilder out = new StringBuilder();
            StringBuilder err = new StringBuilder();
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

    private static Thread pump(java.io.InputStream in, StringBuilder sink) {
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
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

package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.*;
import com.intellij.openapi.project.Project;
import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.io.File;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.function.*;

/** EDT-owned composer recovery. File work uses the independent bounded draft worker. */
final class ChatComposerDrafts {
    private final Project project;
    private final ConversationManager.Conversation conv;
    private final ChatDraftStore store;
    private final JTextArea input;
    private final ChatComposerImages images;
    private final BooleanSupplier busy;
    private final Supplier<AgentChatSession> live;
    private final Consumer<String> notice;
    private final JLabel status = new JLabel("Loading saved input…");
    private final javax.swing.Timer timer;
    private boolean loaded, restoring, badImages, conflict, disposed;
    private long revision;

    ChatComposerDrafts(Project project, ConversationManager.Conversation conv, ChatDraftStore store,
            JTextArea input, ChatComposerImages images, BooleanSupplier busy,
            Supplier<AgentChatSession> live, Consumer<String> notice) {
        this.project = project; this.conv = conv; this.store = store; this.input = input;
        this.images = images; this.busy = busy; this.live = live; this.notice = notice;
        status.getAccessibleContext().setAccessibleName("Saved input status");
        timer = new javax.swing.Timer(250, event -> save()); timer.setRepeats(false);
        input.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { changed(); }
            public void removeUpdate(DocumentEvent e) { changed(); }
            public void changedUpdate(DocumentEvent e) { changed(); }
        });
        images.setOnChange(this::changed);
        input.setEditable(false); images.setEditable(false);
        ChatDraftTasks.submit(() -> store.load(conv.draftKey)).whenComplete((draft, error) -> SwingUtilities.invokeLater(() -> {
            if (disposed) return;
            if (error != null) { showError(error); return; }
            if (revision != 0 && (!draft.composer().text().isEmpty() || !draft.composer().images().isEmpty())) {
                conflict = true; loaded = true; input.setEditable(true); images.setEditable(true);
                status.setText("Saved input exists; review it before replacing it");
            } else if (revision != 0) {
                loaded = true; input.setEditable(true); images.setEditable(true); save();
            } else restore(draft.composer(), false);
            if (!draft.submissions().isEmpty()) notice.accept("ℹ " + draft.submissions().size()
                    + " saved input(s); review acceptance before intentionally resending.\n");
        }));
    }
    JLabel label() { return status; }
    long revision() { return revision; }
    boolean ready() { return loaded && !badImages && !conflict && !disposed; }
    private void changed() {
        if (restoring || disposed) return;
        revision++;
        if (!loaded || conflict || disposed || busy.getAsBoolean()) return;
        status.setText("Saving draft…"); timer.restart();
    }
    private static String message(Throwable error) {
        while (error.getCause() != null) error = error.getCause();
        return error.getMessage() == null ? "Draft operation failed" : error.getMessage();
    }
    private void showError(Throwable error) { status.setText("Saved input: " + message(error)); }
    private void save() {
        if (!loaded || conflict || disposed || busy.getAsBoolean()) return;
        long captured = revision;
        String text = input.getText(), sid = conv.sessionId;
        List<String> paths = images.snapshot();
        boolean keepMissingImages = badImages;
        ChatDraftTasks.submit(() -> keepMissingImages ? store.saveText(conv.draftKey, sid, text)
                : store.save(conv.draftKey, sid, text, paths)).whenComplete((draft, error) ->
            SwingUtilities.invokeLater(() -> {
                if (disposed || captured != revision || busy.getAsBoolean()) return;
                if (error != null) showError(error); else status.setText(keepMissingImages
                        ? "Text saved; missing attachments still block sending"
                        : "Draft saved · " + draft.submissions().size() + " saved input(s)");
            }));
    }
    CompletableFuture<ChatDraftStore.Draft> beginSend() {
        timer.stop(); input.setEditable(false); images.setEditable(false);
        String text = input.getText(), sid = conv.sessionId;
        List<String> paths = images.snapshot();
        // Queue preservation on the EDT before binary probing or tab-close cleanup.
        return ChatDraftTasks.submit(() -> store.save(conv.draftKey, sid, text, paths));
    }
    CompletableFuture<ChatDraftStore.Prepared> prepare(String text, List<String> paths, String worklog) {
        return prepare(text, paths, worklog, false);
    }
    CompletableFuture<ChatDraftStore.Prepared> prepare(String text, List<String> paths, String worklog, boolean priorTurnsIdle) {
        String sid = conv.sessionId;
        return ChatDraftTasks.submit(() -> {
            if (priorTurnsIdle) store.discardAcceptedWhenIdle(conv.draftKey);
            store.save(conv.draftKey, sid, text, paths);
            return store.prepare(conv.draftKey, sid, text, paths, worklog);
        });
    }
    CompletableFuture<Void> markUnknown(String id) {
        return ChatDraftTasks.submit(() -> { store.settle(conv.draftKey, id, null); return null; });
    }
    void accept(String id, Map<String, Object> receipt) {
        ChatDraftTasks.submit(() -> { store.settle(conv.draftKey, id, receipt); return null; })
                .whenComplete((ignored, error) -> SwingUtilities.invokeLater(() -> {
                    if (disposed) return;
                    if (error != null) showError(error);
                    else { status.setText("Input accepted and stored by the CLI"); notice.accept("ℹ Input accepted by the CLI; task completion is separate.\n"); }
                }));
    }
    void finishSend(ChatDraftStore.Prepared prepared, long captured) {
        if (disposed) return;
        input.setEditable(true); images.setEditable(true);
        if (prepared != null) {
            if (revision == captured) {
                restoring = true;
                try { input.setText(""); images.clearAll(); } finally { restoring = false; }
                revision++;
            }
            status.setText("Input saved; review its acceptance under Saved inputs");
            // A programmatic edit during sending is newer than the saved submission.
            if (!input.getText().isEmpty() || !images.isEmpty()) save();
        } else save();
    }
    void discardAttachments() {
        if (busy.getAsBoolean()) return;
        badImages = false; images.clearAll(); changed();
    }
    private void restore(ChatDraftStore.Content content, boolean explicit) {
        if (explicit && (!input.getText().isEmpty() || !images.isEmpty())) {
            notice.accept("ℹ Clear the composer before copying saved input.\n"); return;
        }
        long captured = revision;
        ChatDraftTasks.submit(() -> store.paths(conv.draftKey, content)).whenComplete((paths, error) -> SwingUtilities.invokeLater(() -> {
            if (disposed) return;
            if (captured != revision || busy.getAsBoolean()) {
                if (!loaded) {
                    loaded = true; conflict = true; input.setEditable(true); images.setEditable(true);
                    status.setText("Saved input exists; review it before replacing it");
                }
                return;
            }
            restoring = true;
            try {
                input.setText(content.text());
                badImages = error != null;
                images.restore(error == null ? paths : List.of(), content.images().stream().mapToLong(ChatDraftStore.Attachment::bytes).sum());
                conflict = false; loaded = true; revision++;
                input.setEditable(true); images.setEditable(true);
                if (error != null) status.setText("Saved attachment missing or changed; clear attachments before sending");
                else status.setText("Saved input restored for editing; it has not been sent");
            } finally { restoring = false; }
            if (explicit && error == null) save();
        }));
    }
    void copyQuestionText(String text) { restore(new ChatDraftStore.Content(text, List.of()), true); }
    void review() {
        if (busy.getAsBoolean()) return;
        ChatDraftTasks.submit(() -> store.load(conv.draftKey)).whenComplete((draft, error) -> SwingUtilities.invokeLater(() -> {
            if (disposed) return;
            if (error != null) { showError(error); return; }
            List<String> choices = new ArrayList<>();
            choices.add("Restore saved composer"); choices.add("Discard saved composer");
            for (ChatDraftStore.Submission s : draft.submissions()) choices.add(s.id() + " · " + s.status() + " · "
                    + s.content().text().replace('\n', ' ').substring(0, Math.min(50, s.content().text().length())));
            for (ChatDraftStore.Question q : draft.questions()) choices.add("Question · " + q.id() + " · " + q.status() + " · "
                    + q.title().replace('\n', ' ').substring(0, Math.min(50, q.title().length())));
            String choice = ChoiceDialog.choose(project, "Saved inputs", "Acceptance confirms input storage, not task completion. Recovery never sends automatically.", choices, choices.get(0));
            if (disposed || choice == null) return;
            int index = choices.indexOf(choice);
            if (index == 0) { restore(draft.composer(), true); return; }
            if (index == 1) {
                restoring = true;
                try { input.setText(""); images.clearAll(); } finally { restoring = false; }
                revision++; conflict = false; badImages = false; loaded = true; save(); return;
            }
            if (index >= 2 + draft.submissions().size()) {
                ChatDraftStore.Question selected = draft.questions().get(index - 2 - draft.submissions().size());
                List<String> actions = List.of("Copy fields to composer", "Discard saved question");
                String action = ChoiceDialog.choose(project, "Saved question", selected.title()
                        + "\nSaved fields are editable text. They cannot approve or answer an old request.", actions, actions.get(0));
                if (disposed || action == null || busy.getAsBoolean()) return;
                if (action.equals("Copy fields to composer")) {
                    restore(new ChatDraftStore.Content(selected.title() + (selected.text().isEmpty() ? "" : "\n" + selected.text()), List.of()), true);
                } else {
                    ChatDraftTasks.submit(() -> { store.discardQuestion(conv.draftKey, selected.id()); return null; })
                            .whenComplete((ignored, failure) -> SwingUtilities.invokeLater(() -> {
                                if (!disposed) { if (failure != null) showError(failure); else status.setText("Saved question discarded; an active form may save new edits"); }
                            }));
                }
                return;
            }
            ChatDraftStore.Submission selected = draft.submissions().get(index - 2);
            List<String> actions = "accepted".equals(selected.status())
                    ? List.of("Discard saved record") : List.of("Check acceptance", "Copy to composer", "Discard saved record");
            String action = ChoiceDialog.choose(project, "Saved input", selected.id() + " · " + selected.status(), actions, actions.get(0));
            if (disposed || action == null || busy.getAsBoolean()) return;
            if (action.equals("Copy to composer")) {
                ChatDraftTasks.submit(() -> store.load(conv.draftKey).submissions().stream()
                        .filter(s -> s.id().equals(selected.id()) && !"accepted".equals(s.status())).findFirst().orElse(null))
                        .whenComplete((current, failure) -> SwingUtilities.invokeLater(() -> {
                            if (disposed || busy.getAsBoolean()) return;
                            if (failure != null) showError(failure);
                            else if (current == null) status.setText("Saved input was accepted or removed; refresh Saved inputs");
                            else restore(current.content(), true);
                        }));
                return;
            }
            if (action.equals("Check acceptance")) { checkAcceptance(selected); return; }
            AgentChatSession session = live.get();
            if (session != null && session.hasPendingTurns()) {
                notice.accept("ℹ Wait for or stop the pending turn before discarding its saved attachments.\n"); return;
            }
            ChatDraftTasks.submit(() -> { store.discardSubmission(conv.draftKey, selected.id()); return null; })
                    .whenComplete((ignored, failure) -> SwingUtilities.invokeLater(() -> {
                        if (!disposed) { if (failure != null) showError(failure); else status.setText("Saved input discarded"); }
                    }));
        }));
    }
    private void checkAcceptance(ChatDraftStore.Submission selected) {
        status.setText("Checking stored acceptance…");
        // Command is explicitly read-only; it neither starts cc agent nor retries an input.
        com.intellij.openapi.application.ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                String raw = AgentChatSession.runCapture(List.of("session", "show", selected.sessionId(), "--json", "--input-receipt", selected.id()),
                        project.getBasePath() == null ? null : new File(project.getBasePath()), 10000);
                Map<String, Object> result = MiniJson.parseObject(raw);
                if (!"chainlesschain.input-receipt/v1".equals(result.get("schema")) || !selected.sessionId().equals(result.get("sessionId"))
                        || !selected.id().equals(result.get("clientMessageId"))) throw new IOException("The CLI returned no matching receipt");
                if (Boolean.TRUE.equals(result.get("accepted")) && result.get("receipt") instanceof Map<?, ?> receipt) {
                    @SuppressWarnings("unchecked") Map<String, Object> typed = (Map<String, Object>) receipt;
                    accept(selected.id(), typed);
                } else SwingUtilities.invokeLater(() -> { if (!disposed) status.setText("No acceptance receipt found; delivery remains unknown"); });
            } catch (Exception error) { SwingUtilities.invokeLater(() -> { if (!disposed) showError(error); }); }
        });
    }
    void dispose() {
        timer.stop();
        List<String> paths = images.snapshot();
        List<String> temporary = images.takeOwnedTemps(paths);
        String text = input.getText(), sid = conv.sessionId;
        boolean shouldSave = loaded && !busy.getAsBoolean();
        boolean keepMissingImages = badImages && !conflict;
        String key = conflict ? ChatDraftStore.newKey() : conv.draftKey;
        disposed = true;
        ChatDraftTasks.submit(() -> {
            if (shouldSave) {
                if (keepMissingImages) store.saveText(key, sid, text); else store.save(key, sid, text, paths);
            }
            return null;
        }).whenComplete((ignored, error) -> {
            for (String path : temporary) { try { java.nio.file.Files.deleteIfExists(java.nio.file.Path.of(path)); } catch (IOException ignoredError) { } }
        });
    }
}

package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionTranscriptPage;
import com.chainlesschain.ide.SessionTranscriptChanges;
import com.chainlesschain.ide.SessionHistoryReader;
import javax.swing.*;
import java.awt.BorderLayout;
import java.awt.CardLayout;
import java.awt.FlowLayout;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/** Per-tab read-only history browser. State and rendering are EDT-owned. */
final class ChatHistoryView {
    interface Loader {
        SessionTranscriptPage read(String sessionId, String cursor, BooleanSupplier cancelled) throws Exception;
        default SessionTranscriptChanges changes(String sessionId, String cursor, BooleanSupplier cancelled) throws Exception {
            throw new java.io.IOException("Incremental history is unavailable");
        }
    }
    private static final Executor WORKERS = new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(32), task -> {
                Thread thread = new Thread(task, "cc-chat-history"); thread.setDaemon(true); return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    private final JPanel root = new JPanel(new BorderLayout());
    private final JPanel pages = new JPanel(new CardLayout());
    private final JLabel status = new JLabel(" ");
    private final JButton older = new JButton("Older");
    private final JButton latest = new JButton("Latest");
    private final JButton liveButton = new JButton("Live");
    private final ChatTranscript live;
    private final ChatTranscript history = new ChatTranscript();
    private final Supplier<String> sessionId;
    private final BooleanSupplier active;
    private final Loader loader;
    private final Executor worker;
    private boolean known, disposed, browsing, pending, preserveLiveNotice;
    private long revision, epoch;
    private Request request;
    private SessionTranscriptPage shownPage, latestPage;
    private String syncCursor;
    private Supplier<Object> owner = () -> null;
    private Result deferred;
    private record Result(SessionTranscriptPage page, String cursor, boolean more, boolean baseline) {}
    private record Request(String sessionId, String cursor, long revision, long epoch,
                           Object owner, boolean explicit, boolean incremental, int batch, AtomicBoolean cancelled) {}

    ChatHistoryView(ChatTranscript live, Supplier<String> sessionId, BooleanSupplier active,
                    boolean known, Loader loader) {
        this(live, sessionId, active, known, loader, WORKERS);
    }
    ChatHistoryView(ChatTranscript live, Supplier<String> sessionId, BooleanSupplier active,
                    boolean known, Loader loader, Executor worker) {
        this.live = live; this.sessionId = sessionId; this.active = active;
        this.known = known; this.loader = loader; this.worker = worker;
        pages.add(new JScrollPane(live.pane()), "live");
        pages.add(new JScrollPane(history.pane()), "history");
        JPanel navigation = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
        navigation.add(older); navigation.add(latest); navigation.add(liveButton);
        older.getAccessibleContext().setAccessibleName("Older messages"); older.setToolTipText("Load older saved messages");
        latest.getAccessibleContext().setAccessibleName("Latest saved messages"); latest.setToolTipText("Load the latest saved messages");
        liveButton.getAccessibleContext().setAccessibleName("Return to live conversation"); liveButton.setToolTipText("Return to live conversation without replaying messages");
        JPanel header = new JPanel(new BorderLayout());
        header.add(navigation, BorderLayout.NORTH); header.add(status, BorderLayout.SOUTH);
        root.add(header, BorderLayout.NORTH); root.add(pages, BorderLayout.CENTER);
        status.getAccessibleContext().setAccessibleName("Saved conversation status");
        older.addActionListener(event -> { if (shownPage != null) load(shownPage.nextCursor(), true); });
        latest.addActionListener(event -> load(null, true));
        liveButton.addActionListener(event -> showLive());
        live.onHistoryReady(() -> { if (request != null && deferred != null) finish(request, deferred, null); });
        updateControls();
    }
    void ownerSource(Supplier<Object> source) { owner = source; }
    JPanel component() { return root; }
    void onSelected() { if (known && !browsing && !preserveLiveNotice && request == null) load(null, false); }
    void liveChanged() { revision++; updateControls(); }
    void showLive() {
        browsing = false; shownPage = latestPage;
        ((CardLayout) pages.getLayout()).show(pages, "live");
        status.setText(" Live conversation");
        updateControls();
        if (pending && !active.getAsBoolean()) load(null, false);
    }
    void settled() {
        known = true; pending = true; preserveLiveNotice = false;
        if (browsing) status.setText(" New output is available in the live conversation.");
        else load(null, false);
        updateControls();
    }
    /** Exit/error/interrupt diagnostics may not be persisted. Keep them readable
     * until the user explicitly chooses the saved snapshot. */
    void stopped() {
        known = true; pending = false; preserveLiveNotice = true; cancel();
        status.setText(" Live turn stopped. Saved history is available from Latest saved messages.");
        updateControls();
    }
    void idle() { if (pending && !browsing && !active.getAsBoolean()) load(null, false); updateControls(); }
    void reset(boolean known) {
        cancel(); epoch++; revision++; this.known = known;
        browsing = false; pending = false; preserveLiveNotice = false; shownPage = null; latestPage = null; syncCursor = null;
        live.clear(); history.clear(); status.setText(" ");
        ((CardLayout) pages.getLayout()).show(pages, "live"); updateControls();
    }
    void dispose() { disposed = true; cancel(); updateControls(); }
    private void cancel() { if (request != null) request.cancelled().set(true); request = null; deferred = null; }
    private void updateControls() {
        boolean idle = !disposed && !active.getAsBoolean();
        older.setEnabled(idle && request == null && shownPage != null && shownPage.nextCursor() != null);
        latest.setEnabled(!disposed && known && request == null);
        liveButton.setEnabled(!disposed && browsing);
    }
    private void load(String cursor, boolean explicit) {
        load(cursor, explicit, 0);
    }
    private void load(String cursor, boolean explicit, int batch) {
        if (disposed || !known || sessionId.get() == null) return;
        if (active.getAsBoolean()) {
            pending = true; status.setText(" Saved history will refresh after the active turn."); updateControls(); return;
        }
        boolean incremental = cursor == null && syncCursor != null;
        String query = incremental ? syncCursor : cursor;
        if (request != null && Objects.equals(request.cursor(), query) && request.incremental() == incremental) return;
        cancel();
        Request next = new Request(sessionId.get(), query, revision, epoch, owner.get(), explicit, incremental, batch, new AtomicBoolean());
        request = next; pending = false; status.setText(" Loading saved conversation…"); updateControls();
        try {
            worker.execute(() -> {
                Result result = null; Exception failure = null;
                try {
                    if (next.cancelled().get()) return;
                    if (next.incremental()) {
                        try {
                            SessionTranscriptChanges changes = loader.changes(next.sessionId(), next.cursor(), next.cancelled()::get);
                            result = new Result(changes.page(), changes.nextCursor(), changes.hasMore(), false);
                        } catch (SessionHistoryReader.CursorExpired stale) {
                            SessionTranscriptPage page = loader.read(next.sessionId(), null, next.cancelled()::get);
                            result = new Result(page, page.syncCursor(), false, true);
                        }
                    } else {
                        SessionTranscriptPage page = loader.read(next.sessionId(), next.cursor(), next.cancelled()::get);
                        result = new Result(page, page.syncCursor(), false, true);
                    }
                } catch (Exception error) { failure = error; }
                Result captured = result; Exception error = failure;
                SwingUtilities.invokeLater(() -> finish(next, captured, error));
            });
        } catch (RuntimeException error) { finish(next, null, error); }
    }
    private void finish(Request next, Result result, Exception error) {
        if (disposed || request != next || next.cancelled().get()) return;
        if (epoch != next.epoch() || owner.get() != next.owner() || !Objects.equals(sessionId.get(), next.sessionId())) {
            cancel(); pending = true; updateControls(); return;
        }
        if (revision != next.revision() || active.getAsBoolean()) {
            cancel();
            pending = true; status.setText(" New live output arrived; saved history will refresh when idle.");
            updateControls();
            if (!active.getAsBoolean() && !browsing) load(null, false);
            return;
        }
        SessionTranscriptPage page = result == null ? null : result.page();
        if (error != null || page == null) {
            cancel();
            String reason = error == null ? "No history response" : String.valueOf(error.getMessage());
            status.setText(" Saved conversation could not be loaded: " + reason.substring(0, Math.min(500, reason.length())));
            status.setToolTipText(status.getText()); updateControls(); return;
        }
        if (next.incremental() || next.cursor() == null) {
            if (!live.mergeHistory(page, result.baseline())) {
                deferred = result;
                status.setText(" Saved update waits for your text selection to finish.");
                updateControls(); return;
            }
            syncCursor = result.cursor();
            page = page.navigation(live.firstSavedOrdinal(page.totalMessages()));
            latestPage = page; browsing = false; preserveLiveNotice = false;
            ((CardLayout) pages.getLayout()).show(pages, "live");
        } else {
            history.replaceHistory(page, true); browsing = true;
            ((CardLayout) pages.getLayout()).show(pages, "history");
        }
        cancel();
        shownPage = page;
        long first = browsing ? (page.messages().isEmpty() ? 0 : page.messages().getFirst().ordinal()) : live.firstSavedOrdinal(0);
        long last = browsing ? (page.messages().isEmpty() ? -1 : page.messages().getLast().ordinal()) : live.lastSavedOrdinal();
        String range = last < 0 ? "No saved messages" : "Saved messages "
                + (first + 1) + "–" + (last + 1)
                + " of " + page.totalMessages();
        status.setText(" " + (page.snapshotBoundary() ? "History begins at a saved snapshot · " : "") + range);
        status.setToolTipText(status.getText()); updateControls();
        if (result.more()) {
            if (next.batch() < 7) load(null, next.explicit(), next.batch() + 1);
            else status.setText(" More saved messages are available; select Latest to continue loading.");
        }
    }
}

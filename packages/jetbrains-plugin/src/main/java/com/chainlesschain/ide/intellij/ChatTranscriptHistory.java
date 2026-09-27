package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionTranscriptPage;
import com.chainlesschain.ide.TranscriptReferences;
import javax.swing.JTextPane;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.text.AttributeSet;
import javax.swing.text.BadLocationException;
import javax.swing.text.StyledDocument;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** EDT-owned ranges; only verified rows can acquire a saved identity. */
final class ChatTranscriptHistory {
    static final int MAX_DOCUMENT_CHARS = 1024 * 1024 + 16_384;
    interface EditObserver { void edit(int offset, int removed, int added); }
    static final class Span {
        int start, end;
        final String role, raw, sessionId, clientId;
        final Object owner;
        String eventRef;
        SessionTranscriptPage.Row saved;
        Span(int start, int end, String role, String raw, String sessionId, String clientId, Object owner) {
            this.start = start; this.end = end; this.role = role; this.raw = raw;
            this.sessionId = sessionId; this.clientId = clientId; this.owner = owner;
        }
    }
    private final JTextPane pane;
    private final StyledDocument document;
    private final AttributeSet plain, bold, dim;
    private final EditObserver observer;
    private final List<Span> spans = new ArrayList<>();
    private boolean merging;
    ChatTranscriptHistory(JTextPane pane, AttributeSet plain, AttributeSet bold, AttributeSet dim, EditObserver observer) {
        this.pane = pane; this.document = pane.getStyledDocument(); this.plain = plain; this.bold = bold; this.dim = dim;
        this.observer = observer;
        document.addDocumentListener(new DocumentListener() {
            public void changedUpdate(DocumentEvent event) { }
            public void insertUpdate(DocumentEvent event) {
                for (Span span : spans) {
                    if (event.getOffset() <= span.start) { span.start += event.getLength(); span.end += event.getLength(); }
                    else if (event.getOffset() < span.end) span.end += event.getLength();
                }
            }
            public void removeUpdate(DocumentEvent event) {
                for (Span span : spans) {
                    span.start = removedPosition(span.start, event.getOffset(), event.getLength());
                    span.end = removedPosition(span.end, event.getOffset(), event.getLength());
                }
                spans.removeIf(span -> span.end <= span.start);
            }
        });
    }
    static int removedPosition(int value, int offset, int length) {
        return value <= offset ? value : value >= offset + length ? value - length : offset;
    }
    Span add(int start, int end, String role, String raw, String session, String client, Object owner) {
        Span span = new Span(start, end, role, com.chainlesschain.ide.TranscriptCap.boundEntry(raw, 200_000), session, client, owner);
        if (end > start) spans.add(span);
        if (!merging) trimRanges();
        return span;
    }
    private void trimRanges() {
        // Range metadata must also stay bounded when the text consists of tiny entries.
        while (spans.size() > 4096) {
            // Saved ranges must never silently become live-only: a later
            // rewind needs their identities to remove discarded rows.
            Span candidate = spans.stream().filter(value -> value.saved == null).findFirst().orElse(null);
            if (candidate == null) break;
            spans.remove(candidate);
        }
    }
    void clear() { spans.clear(); }
    void removeUndispatched(String clientId, Object owner) {
        if (clientId == null || owner == null) return;
        for (Span span : List.copyOf(spans)) {
            if (span.owner != owner || !clientId.equals(span.clientId) || !"user".equals(span.role)
                    || span.saved != null || span.eventRef != null) continue;
            try { erase(span); }
            catch (BadLocationException error) { throw new IllegalStateException("Could not remove unsent input", error); }
        }
    }
    void input(Map<String, Object> event, String session, Object owner) {
        String hash = TranscriptReferences.input(event, session);
        if (owner == null || hash == null) return;
        for (Span span : spans) if (span.saved == null && "user".equals(span.role) && span.owner == owner
                && Objects.equals(span.sessionId, session) && Objects.equals(span.clientId, event.get("client_message_id"))) span.eventRef = hash;
    }
    void terminal(Span assistant, TranscriptReferences refs, Object owner) {
        if (refs == null || owner == null || assistant == null || assistant.owner != owner
                || !Objects.equals(assistant.sessionId, refs.sessionId()) || !spans.contains(assistant)) return;
        assistant.eventRef = refs.assistantEventId();
        if (refs.clientMessageId() != null && refs.userEventId() != null)
            for (Span span : spans) if (span.saved == null && "user".equals(span.role) && span.owner == owner
                    && Objects.equals(span.sessionId, refs.sessionId()) && Objects.equals(span.clientId, refs.clientMessageId())) span.eventRef = refs.userEventId();
    }
    long firstOrdinal(long fallback) {
        return spans.stream().filter(span -> span.saved != null).mapToLong(span -> span.saved.ordinal()).min().orElse(fallback);
    }
    long lastOrdinal() { return spans.stream().filter(span -> span.saved != null).mapToLong(span -> span.saved.ordinal()).max().orElse(-1); }
    List<String> savedIds() { return spans.stream().filter(span -> span.saved != null).sorted(Comparator.comparingInt(span -> span.start)).map(span -> span.saved.id()).toList(); }
    int wholePrefix(int remove) {
        for (Span span : spans) if (span.start < remove && span.end > remove) remove = span.end;
        return remove;
    }
    private boolean selected(int start, int end) {
        return pane.getSelectionStart() != pane.getSelectionEnd() && start < pane.getSelectionEnd() && end > pane.getSelectionStart();
    }
    private boolean same(Span span, SessionTranscriptPage.Row row) {
        return span.raw.equals(row.text()) && (span.saved == null ? !row.truncated() : span.saved.truncated() == row.truncated());
    }
    /** False means a conflicting edit is deferred, with no cursor or text changes. */
    boolean merge(SessionTranscriptPage page, boolean baseline) {
        Map<String, SessionTranscriptPage.Row> verified = new java.util.LinkedHashMap<>();
        if (!baseline) for (Span span : spans) if (span.saved != null) verified.put(span.saved.id(), span.saved);
        for (SessionTranscriptPage.Row row : page.messages()) verified.put(row.id(), row);
        List<SessionTranscriptPage.Row> retained = verified.values().stream()
                .sorted(Comparator.comparingLong(SessionTranscriptPage.Row::ordinal).reversed()).limit(100).toList();
        verified.clear(); for (SessionTranscriptPage.Row row : retained) verified.put(row.id(), row);
        Map<String, Span> targets = new HashMap<>();
        Set<Span> remove = new HashSet<>();
        for (Span span : spans) if (span.saved != null && !verified.containsKey(span.saved.id())) remove.add(span);
        for (SessionTranscriptPage.Row row : verified.values()) {
            List<Span> matches = spans.stream().filter(span -> row.id().equals(span.saved == null ? null : span.saved.id())
                    || (span.saved == null && row.itemIndex() == 0 && Objects.equals(span.sessionId, page.sessionId())
                        && row.role().equals(span.role) && row.eventId().equals(span.eventRef))).toList();
            if (!matches.isEmpty()) {
                Span target = matches.stream().filter(span -> span.saved != null).findFirst().orElse(matches.getFirst());
                targets.put(row.id(), target);
                for (Span match : matches) if (match != target) remove.add(match);
                if (!same(target, row) && selected(target.start, target.end)) return false;
            }
        }
        if (remove.stream().anyMatch(span -> selected(span.start, span.end))) return false;
        List<SessionTranscriptPage.Row> ordered = verified.values().stream().sorted(Comparator.comparingLong(SessionTranscriptPage.Row::ordinal)).toList();
        int prior = -1;
        for (SessionTranscriptPage.Row row : ordered) {
            Span target = targets.get(row.id());
            if (target != null) {
                if (target.start < prior && pane.getSelectionStart() != pane.getSelectionEnd()) return false;
                prior = target.start;
            }
        }
        // Insertion inside a selected unassociated diagnostic must wait too.
        for (SessionTranscriptPage.Row row : ordered) if (!targets.containsKey(row.id())) {
            int offset = insertion(row.ordinal(), targets, verified, document.getLength());
            if (pane.getSelectionStart() < offset && offset < pane.getSelectionEnd()) return false;
        }
        // Preflight the budget before any mutation or cursor advancement. A
        // selection may keep its text, but may not make retention unbounded.
        long projected = document.getLength();
        for (Span span : remove) projected -= span.end - span.start;
        for (SessionTranscriptPage.Row row : ordered) {
            Span target = targets.get(row.id());
            if (target == null) projected += renderedLength(row);
            else if (!same(target, row)) projected += renderedLength(row) - (target.end - target.start);
            else projected += Math.max(0, renderedLength(row) - (target.end - target.start));
        }
        if (projected > MAX_DOCUMENT_CHARS && pane.getSelectionStart() != pane.getSelectionEnd()) return false;
        merging = true;
        try {
            for (Span span : remove.stream().sorted(Comparator.comparingInt((Span s) -> s.start).reversed()).toList()) erase(span);
            Span previous = null;
            for (SessionTranscriptPage.Row row : ordered) {
                Span target = targets.get(row.id());
                if (target == null) {
                    target = insert(insertion(row.ordinal(), targets, verified, document.getLength()), row, page.sessionId());
                    targets.put(row.id(), target);
                } else if (!same(target, row)) {
                    int offset = target.start; erase(target);
                    target = insert(offset, row, page.sessionId()); targets.put(row.id(), target);
                }
                target.saved = row;
                if (previous != null && target.start < previous.start) {
                    erase(target);
                    target = insert(previous.end, row, page.sessionId()); targets.put(row.id(), target);
                }
                previous = target;
            }
            // Snapshot rows can exceed the 200K live cap, but never grow indefinitely.
            int excess = document.getLength() - MAX_DOCUMENT_CHARS;
            if (excess > 0) {
                int length = wholePrefix(excess);
                if (!selected(0, length)) { observer.edit(0, length, 0); document.remove(0, length); }
            }
            return true;
        } catch (BadLocationException error) { throw new IllegalStateException("Could not merge saved history", error); }
        finally { merging = false; trimRanges(); }
    }
    private int insertion(long ordinal, Map<String, Span> targets, Map<String, SessionTranscriptPage.Row> verified, int fallback) {
        return targets.entrySet().stream().filter(entry -> verified.get(entry.getKey()).ordinal() > ordinal)
                .mapToInt(entry -> entry.getValue().start).min().orElse(fallback);
    }
    private void erase(Span span) throws BadLocationException {
        int start = span.start, length = span.end - span.start;
        spans.remove(span);
        observer.edit(start, length, 0); document.remove(start, length);
    }
    private Span insert(int offset, SessionTranscriptPage.Row row, String session) throws BadLocationException {
        String heading = heading(row), suffix = suffix(row);
        observer.edit(offset, 0, heading.length() + row.text().length() + suffix.length());
        document.insertString(offset, heading, bold);
        document.insertString(offset + heading.length(), row.text(), plain);
        document.insertString(offset + heading.length() + row.text().length(), suffix, dim);
        Span span = add(offset, offset + heading.length() + row.text().length() + suffix.length(), row.role(), row.text(), session, null, null);
        span.saved = row; return span;
    }
    private static String heading(SessionTranscriptPage.Row row) { return "\nMessage " + (row.ordinal() + 1) + ", " + row.role() + " (saved)\n"; }
    private static String suffix(SessionTranscriptPage.Row row) { return row.truncated() ? "\n[Message shortened for display; the saved session retains its original content.]\n" : "\n"; }
    private static int renderedLength(SessionTranscriptPage.Row row) { return heading(row).length() + row.text().length() + suffix(row).length(); }
}

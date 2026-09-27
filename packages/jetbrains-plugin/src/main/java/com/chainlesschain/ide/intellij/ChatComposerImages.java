package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ImageAttachments;

import javax.swing.JLabel;
import javax.swing.JTextArea;
import java.awt.Component;
import java.util.ArrayList;
import java.util.List;

/**
 * Pending image attachments for the chat composer: clipboard paste, drag-drop
 * (files or raw images), and the 📷 indicator label. Split out of
 * ConversationView (opportunistic split) — owns the attachment list + label;
 * accept/cap policy stays in the pure {@link ImageAttachments}.
 */
final class ChatComposerImages {

    private final List<String> pendingImages = new ArrayList<>();
    // Temp pngs THIS composer wrote (cc-paste-*/cc-drop-*) — the only files we
    // may delete. User-dropped real files are never in here. deleteOnExit stays
    // as a backstop, but that list only grows for the IDE's long lifetime, so
    // eager cleanup (discard → here, sent → after the turn) is the primary path.
    private final java.util.Set<String> ownTemps = new java.util.HashSet<>();
    private final JLabel label = new JLabel();
    private final JTextArea input; // caret target for plain-text drops
    private int generation;
    private int inFlight;
    private long attachedBytes;
    private String lastError = "";
    private Runnable onChange = () -> {};
    private boolean editable = true;

    void setOnChange(Runnable listener) { onChange = listener; }
    void setEditable(boolean value) { editable = value; }
    /** Restore already validated store snapshots; the composer does not own/delete them. */
    void restore(List<String> paths, long bytes) {
        clearAll();
        pendingImages.addAll(paths); attachedBytes = bytes;
        updateIndicator(); onChange.run();
    }

    ChatComposerImages(JTextArea input) {
        this.input = input;
        label.setEnabled(false);
        label.setVisible(false);
    }

    /** The 📷 attached-image indicator (placed by the panel's layout). */
    JLabel indicatorLabel() {
        return label;
    }

    boolean isEmpty() {
        return pendingImages.isEmpty();
    }

    boolean isPreparing() { return inFlight > 0; }

    private boolean reserve() {
        if (!editable) return false;
        if (pendingImages.size() + inFlight >= ImageAttachments.MAX) {
            showError("Attach at most 4 images per message");
            return false;
        }
        inFlight++;
        lastError = "";
        updateIndicator();
        return true;
    }

    private void showError(String message) {
        lastError = message;
        updateIndicator();
    }

    /** Copy of the pending paths (what a send should attach). */
    List<String> snapshot() {
        return new ArrayList<>(pendingImages);
    }

    /**
     * Transfer ownership of the self-created temp files among {@code paths} to
     * the caller (who deletes them once the CLI has consumed the turn). Call
     * BEFORE {@link #clearAll()} on the send path — clearAll deletes whatever
     * own temps are still pending, treating them as discarded.
     */
    List<String> takeOwnedTemps(java.util.Collection<String> paths) {
        List<String> owned = new ArrayList<>();
        for (String p : paths) {
            if (ownTemps.remove(p)) owned.add(p);
        }
        return owned;
    }

    /** Drop all pending attachments and hide the indicator (after send / reset).
     *  Self-created temp pngs still pending here were never sent — delete them. */
    void clearAll() {
        generation++;
        inFlight = 0;
        attachedBytes = 0;
        lastError = "";
        for (String p : pendingImages) {
            if (ownTemps.remove(p)) {
                try {
                    java.nio.file.Files.deleteIfExists(java.nio.file.Paths.get(p));
                } catch (Exception ignored) {
                    // locked/odd path → deleteOnExit backstop
                }
            }
        }
        pendingImages.clear();
        updateIndicator();
        onChange.run();
    }

    /** Attach a clipboard image (Ctrl/Cmd+V). Returns true if one was taken. */
    boolean tryPaste() {
        try {
            java.awt.datatransfer.Clipboard cb =
                    java.awt.Toolkit.getDefaultToolkit().getSystemClipboard();
            if (!cb.isDataFlavorAvailable(java.awt.datatransfer.DataFlavor.imageFlavor)) {
                return false;
            }
            Object data = cb.getData(java.awt.datatransfer.DataFlavor.imageFlavor);
            if (!(data instanceof java.awt.Image)) return false;
            // Cap reached: still consume the paste (don't dump binary as text).
            attachRawImage((java.awt.Image) data, "cc-paste-");
            return true;
        } catch (Exception ex) {
            showError("Image paste failed: " + ex.getMessage());
            return false; // any failure → fall back to normal text paste
        }
    }

    /** Accept image drops on {@code target} without replacing its TransferHandler. */
    void installDropTarget(Component target) {
        new java.awt.dnd.DropTarget(target, java.awt.dnd.DnDConstants.ACTION_COPY,
                new java.awt.dnd.DropTargetAdapter() {
                    @Override
                    public void drop(java.awt.dnd.DropTargetDropEvent e) {
                        try {
                            e.acceptDrop(java.awt.dnd.DnDConstants.ACTION_COPY);
                            e.dropComplete(importDropped(e.getTransferable()));
                        } catch (Exception ex) {
                            showError("Image drop failed: " + ex.getMessage());
                            e.dropComplete(false);
                        }
                    }
                });
    }

    /**
     * Dropped payload → image attachments (a file list filtered to images, or a
     * raw image). Plain text still lands at the caret (the DropTarget replaces
     * the text area's built-in drop handling, so re-implement that bit).
     */
    private boolean importDropped(java.awt.datatransfer.Transferable t) throws Exception {
        if (!editable) return false;
        if (t.isDataFlavorSupported(java.awt.datatransfer.DataFlavor.javaFileListFlavor)) {
            @SuppressWarnings("unchecked")
            List<java.io.File> files = (List<java.io.File>)
                    t.getTransferData(java.awt.datatransfer.DataFlavor.javaFileListFlavor);
            boolean handled = false;
            for (java.io.File file : files) {
                if (!ImageAttachments.isImagePath(file.getPath())) continue;
                handled = true;
                if (!reserve()) continue;
                int ticket = generation;
                com.intellij.openapi.application.ApplicationManager.getApplication().executeOnPooledThread(() -> {
                    java.nio.file.Path copy = null;
                    try {
                        ImageAttachments.validateFile(file.toPath());
                        String name = file.getName();
                        copy = java.nio.file.Files.createTempFile("cc-drop-", name.substring(name.lastIndexOf('.')));
                        copy.toFile().deleteOnExit();
                        try (java.io.InputStream source = java.nio.file.Files.newInputStream(file.toPath());
                             java.io.OutputStream dest = boundedOutput(copy)) {
                            source.transferTo(dest);
                        }
                        long size = ImageAttachments.validateFile(copy);
                        finish(ticket, copy, size, null);
                    } catch (Exception error) { finish(ticket, copy, 0, file.getName() + ": " + error.getMessage()); }
                });
            }
            return handled;
        }
        if (t.isDataFlavorSupported(java.awt.datatransfer.DataFlavor.imageFlavor)) {
            Object data = t.getTransferData(java.awt.datatransfer.DataFlavor.imageFlavor);
            if (!(data instanceof java.awt.Image)) return false;
            attachRawImage((java.awt.Image) data, "cc-drop-");
            return true;
        }
        if (t.isDataFlavorSupported(java.awt.datatransfer.DataFlavor.stringFlavor)) {
            Object s = t.getTransferData(java.awt.datatransfer.DataFlavor.stringFlavor);
            if (s instanceof String) {
                input.replaceSelection((String) s);
                return true;
            }
        }
        return false;
    }

    /**
     * Encode a raw AWT image to a temp png OFF the EDT, then attach it. The
     * image is already read from the clipboard/drop on the EDT; only the PNG
     * encode (multi-MB for a 4K screenshot) moves — doing it inline hitched the
     * paste/drop handler. Failures remain visible next to the attachment count.
     */
    private void attachRawImage(java.awt.Image img, String prefix) {
        try { ImageAttachments.validateDimensions(img.getWidth(null), img.getHeight(null)); }
        catch (java.io.IOException error) { showError(error.getMessage()); return; }
        if (!reserve()) return;
        final int ticket = generation;
        final java.awt.Image src = img;
        com.intellij.openapi.application.ApplicationManager.getApplication()
                .executeOnPooledThread(() -> {
            java.nio.file.Path path = null;
            try {
                java.io.File tmp = java.io.File.createTempFile(prefix, ".png");
                tmp.deleteOnExit(); // backstop only — eager cleanup owns the normal path
                path = tmp.toPath();
                try (java.io.OutputStream out = boundedOutput(path)) {
                    if (!javax.imageio.ImageIO.write(toBuffered(src), "png", out)) throw new java.io.IOException("PNG encoder unavailable");
                }
                finish(ticket, path, ImageAttachments.validateFile(path), null);
            } catch (Exception ex) { finish(ticket, path, 0, "Image could not be attached: " + ex.getMessage()); }
        });
    }

    private static java.io.OutputStream boundedOutput(java.nio.file.Path path) throws java.io.IOException {
        return new java.io.FilterOutputStream(java.nio.file.Files.newOutputStream(path)) {
            private long written;
            private void reserve(int count) throws java.io.IOException {
                if (written + count > ImageAttachments.MAX_IMAGE_BYTES) throw new java.io.IOException("Encoded image exceeds 20 MiB");
                written += count;
            }
            @Override public void write(int value) throws java.io.IOException { reserve(1); out.write(value); }
            @Override public void write(byte[] data, int off, int length) throws java.io.IOException { reserve(length); out.write(data, off, length); }
        };
    }

    private void finish(int ticket, java.nio.file.Path path, long bytes, String error) {
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater(() -> {
            if (generation == ticket) {
                inFlight--;
                if (error == null && attachedBytes + bytes > ImageAttachments.MAX_TURN_BYTES) errorHolder(ticket, path, "Total images exceed 20 MiB");
                else if (error != null) errorHolder(ticket, path, error);
                else {
                    String absolute = path.toAbsolutePath().toString();
                    pendingImages.add(absolute); ownTemps.add(absolute); attachedBytes += bytes; updateIndicator(); onChange.run();
                }
            } else if (path != null) path.toFile().delete();
        });
    }

    private void errorHolder(int ticket, java.nio.file.Path path, String error) {
        if (path != null) path.toFile().delete();
        if (generation == ticket) showError(error);
    }

    private static java.awt.image.BufferedImage toBuffered(java.awt.Image img) throws java.io.IOException {
        ImageAttachments.validateDimensions(img.getWidth(null), img.getHeight(null));
        if (img instanceof java.awt.image.BufferedImage) {
            return (java.awt.image.BufferedImage) img;
        }
        int w = Math.max(1, img.getWidth(null));
        int h = Math.max(1, img.getHeight(null));
        java.awt.image.BufferedImage bi =
                new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = bi.createGraphics();
        g.drawImage(img, 0, 0, null);
        g.dispose();
        return bi;
    }

    private void updateIndicator() {
        int n = pendingImages.size();
        label.setText("📷 " + n + " image" + (n == 1 ? "" : "s") + (inFlight > 0 ? " · preparing " + inFlight : "") + (lastError.isEmpty() ? "" : " · " + lastError));
        label.setToolTipText(lastError.isEmpty() ? "Up to 4 images, 20 MiB total, 40 megapixels per image" : lastError);
        label.setVisible(n > 0 || inFlight > 0 || !lastError.isEmpty());
        label.setEnabled(true);
    }
}

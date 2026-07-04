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
    private final JLabel label = new JLabel();
    private final JTextArea input; // caret target for plain-text drops

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

    /** Copy of the pending paths (what a send should attach). */
    List<String> snapshot() {
        return new ArrayList<>(pendingImages);
    }

    /** Drop all pending attachments and hide the indicator (after send / reset). */
    void clearAll() {
        pendingImages.clear();
        updateIndicator();
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
            if (pendingImages.size() >= ImageAttachments.MAX) return true;
            attachRawImage((java.awt.Image) data, "cc-paste-");
            return true;
        } catch (Exception ex) {
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
        if (t.isDataFlavorSupported(java.awt.datatransfer.DataFlavor.javaFileListFlavor)) {
            @SuppressWarnings("unchecked")
            List<java.io.File> files = (List<java.io.File>)
                    t.getTransferData(java.awt.datatransfer.DataFlavor.javaFileListFlavor);
            List<String> paths = new ArrayList<>();
            for (java.io.File f : files) paths.add(f.getAbsolutePath());
            List<String> accepted =
                    ImageAttachments.acceptDropped(paths, pendingImages.size());
            if (accepted.isEmpty()) return false;
            pendingImages.addAll(accepted);
            updateIndicator();
            return true;
        }
        if (t.isDataFlavorSupported(java.awt.datatransfer.DataFlavor.imageFlavor)) {
            Object data = t.getTransferData(java.awt.datatransfer.DataFlavor.imageFlavor);
            if (!(data instanceof java.awt.Image)) return false;
            if (pendingImages.size() >= ImageAttachments.MAX) return true;
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

    /** Write a raw AWT image to a temp png and attach it to the composer. */
    private void attachRawImage(java.awt.Image img, String prefix) throws java.io.IOException {
        java.io.File tmp = java.io.File.createTempFile(prefix, ".png");
        tmp.deleteOnExit();
        javax.imageio.ImageIO.write(toBuffered(img), "png", tmp);
        pendingImages.add(tmp.getAbsolutePath());
        updateIndicator();
    }

    private static java.awt.image.BufferedImage toBuffered(java.awt.Image img) {
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
        label.setText(n == 0 ? "" : "📷 " + n + " image" + (n == 1 ? "" : "s"));
        label.setVisible(n > 0);
    }
}

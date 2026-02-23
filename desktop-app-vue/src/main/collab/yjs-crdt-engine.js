/**
 * Yjs CRDT Engine
 * Core Yjs document management for real-time collaborative editing
 * Y.Doc with Y.Text, Y.Map, Y.Array structures
 * Markdown ↔ Yjs bidirectional conversion
 *
 * @module collab/yjs-crdt-engine
 * @version 2.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// Try to load Yjs
let Y;
try {
  Y = require("yjs");
} catch (_e) {
  logger.warn("[YjsCRDTEngine] yjs not available");
}

/**
 * YjsCRDTEngine - Core CRDT document management
 */
class YjsCRDTEngine extends EventEmitter {
  constructor(options = {}) {
    super();

    // Active documents (documentId -> Y.Doc)
    this.documents = new Map();

    // Document metadata
    this._metadata = new Map();

    // Max document size (default 10MB)
    this.maxDocSize = options.maxDocSize || 10 * 1024 * 1024;
  }

  /**
   * Create or get a Yjs document
   * @param {string} documentId
   * @param {Object} [options]
   * @param {string} [options.initialContent] - Initial Markdown content
   * @returns {Object} { doc, text, meta, comments }
   */
  getOrCreateDocument(documentId, options = {}) {
    if (this.documents.has(documentId)) {
      return this._getDocStructure(documentId);
    }

    if (!Y) {
      throw new Error("Yjs library not available");
    }

    const doc = new Y.Doc();

    // Set up shared types
    const text = doc.getText("content"); // Y.Text for document content
    const meta = doc.getMap("metadata"); // Y.Map for metadata
    const comments = doc.getArray("comments"); // Y.Array for comments/annotations

    // Initialize metadata
    meta.set("documentId", documentId);
    meta.set("createdAt", Date.now());
    meta.set("version", 1);

    // Set initial content if provided
    if (options.initialContent) {
      doc.transact(() => {
        text.insert(0, options.initialContent);
      });
    }

    // Listen for updates
    doc.on("update", (update, origin) => {
      this.emit("document:update", {
        documentId,
        update,
        origin,
        size: update.length,
      });
    });

    this.documents.set(documentId, doc);
    this._metadata.set(documentId, {
      createdAt: Date.now(),
      lastModified: Date.now(),
      updateCount: 0,
    });

    logger.info(`[YjsCRDTEngine] Created document: ${documentId}`);
    return this._getDocStructure(documentId);
  }

  /**
   * Get document structure helpers
   */
  _getDocStructure(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc) {
      return null;
    }

    return {
      doc,
      text: doc.getText("content"),
      meta: doc.getMap("metadata"),
      comments: doc.getArray("comments"),
    };
  }

  /**
   * Get document content as Markdown string
   * @param {string} documentId
   * @returns {string}
   */
  getMarkdown(documentId) {
    const structure = this._getDocStructure(documentId);
    if (!structure) {
      return "";
    }

    return structure.text.toString();
  }

  /**
   * Set document content from Markdown
   * @param {string} documentId
   * @param {string} markdown
   */
  setMarkdown(documentId, markdown) {
    const structure = this.getOrCreateDocument(documentId);
    const { doc, text } = structure;

    doc.transact(() => {
      // Clear existing content
      if (text.length > 0) {
        text.delete(0, text.length);
      }
      // Insert new content
      text.insert(0, markdown);
    });

    this._updateMetadata(documentId);
  }

  /**
   * Apply a text operation (insert/delete)
   * @param {string} documentId
   * @param {Object} operation
   * @param {string} operation.type - 'insert' | 'delete' | 'replace'
   * @param {number} operation.position
   * @param {string} [operation.content]
   * @param {number} [operation.length]
   */
  applyOperation(documentId, operation) {
    const structure = this._getDocStructure(documentId);
    if (!structure) {
      throw new Error(`Document not found: ${documentId}`);
    }

    const { doc, text } = structure;

    doc.transact(() => {
      switch (operation.type) {
        case "insert":
          text.insert(operation.position, operation.content || "");
          break;

        case "delete":
          text.delete(operation.position, operation.length || 1);
          break;

        case "replace":
          if (operation.length) {
            text.delete(operation.position, operation.length);
          }
          text.insert(operation.position, operation.content || "");
          break;
      }
    });

    this._updateMetadata(documentId);
  }

  /**
   * Add a comment/annotation to the document
   * @param {string} documentId
   * @param {Object} comment
   */
  addComment(documentId, comment) {
    const structure = this._getDocStructure(documentId);
    if (!structure) {
      return;
    }

    const { doc, comments } = structure;

    doc.transact(() => {
      comments.push([
        {
          id: comment.id || require("uuid").v4(),
          text: comment.text,
          authorDid: comment.authorDid,
          authorName: comment.authorName,
          position: comment.position || 0,
          resolved: false,
          createdAt: Date.now(),
        },
      ]);
    });
  }

  /**
   * Get all comments for a document
   * @param {string} documentId
   * @returns {Array}
   */
  getComments(documentId) {
    const structure = this._getDocStructure(documentId);
    if (!structure) {
      return [];
    }

    return structure.comments.toArray();
  }

  /**
   * Update document metadata
   * @param {string} documentId
   * @param {string} key
   * @param {*} value
   */
  setMetadata(documentId, key, value) {
    const structure = this._getDocStructure(documentId);
    if (!structure) {
      return;
    }

    structure.doc.transact(() => {
      structure.meta.set(key, value);
    });
  }

  /**
   * Get document metadata
   * @param {string} documentId
   * @returns {Object}
   */
  getMetadata(documentId) {
    const structure = this._getDocStructure(documentId);
    if (!structure) {
      return {};
    }

    const meta = {};
    structure.meta.forEach((value, key) => {
      meta[key] = value;
    });
    return meta;
  }

  // ==========================================
  // Sync Protocol
  // ==========================================

  /**
   * Encode the full document state for initial sync
   * @param {string} documentId
   * @returns {Uint8Array}
   */
  encodeState(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc || !Y) {
      return new Uint8Array();
    }

    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Get state vector for incremental sync
   * @param {string} documentId
   * @returns {Uint8Array}
   */
  getStateVector(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc || !Y) {
      return new Uint8Array();
    }

    return Y.encodeStateVector(doc);
  }

  /**
   * Encode state difference from a state vector
   * @param {string} documentId
   * @param {Uint8Array} remoteStateVector
   * @returns {Uint8Array}
   */
  encodeDiff(documentId, remoteStateVector) {
    const doc = this.documents.get(documentId);
    if (!doc || !Y) {
      return new Uint8Array();
    }

    return Y.encodeStateAsUpdate(doc, remoteStateVector);
  }

  /**
   * Apply a remote update to a document
   * @param {string} documentId
   * @param {Uint8Array} update
   * @param {*} [origin] - Update origin (for tracking)
   */
  applyUpdate(documentId, update, origin) {
    const doc = this.documents.get(documentId);
    if (!doc || !Y) {
      return;
    }

    try {
      Y.applyUpdate(doc, update, origin);
      this._updateMetadata(documentId);
      logger.info(
        `[YjsCRDTEngine] Applied update to ${documentId} (${update.length} bytes)`,
      );
    } catch (error) {
      logger.error(`[YjsCRDTEngine] Failed to apply update:`, error.message);
      this.emit("document:error", { documentId, error: error.message });
    }
  }

  /**
   * Merge two documents (for offline reconnect)
   * @param {string} documentId
   * @param {Uint8Array} remoteState
   */
  mergeState(documentId, remoteState) {
    const structure = this.getOrCreateDocument(documentId);
    if (!Y) {
      return;
    }

    try {
      Y.applyUpdate(structure.doc, remoteState);
      logger.info(`[YjsCRDTEngine] Merged state for ${documentId}`);
    } catch (error) {
      logger.error(`[YjsCRDTEngine] Merge failed:`, error.message);
    }
  }

  // ==========================================
  // Markdown ↔ Yjs Conversion
  // ==========================================

  /**
   * Convert Markdown to Yjs document structure
   * @param {string} documentId
   * @param {string} markdown
   * @returns {Object} Document structure
   */
  markdownToYjs(documentId, markdown) {
    const structure = this.getOrCreateDocument(documentId);
    const { doc, text, meta } = structure;

    doc.transact(() => {
      // Clear and set content
      if (text.length > 0) {
        text.delete(0, text.length);
      }
      text.insert(0, markdown);

      // Extract and store metadata from frontmatter
      const frontmatter = this._extractFrontmatter(markdown);
      if (frontmatter) {
        for (const [key, value] of Object.entries(frontmatter)) {
          meta.set(`fm_${key}`, value);
        }
      }
    });

    return structure;
  }

  /**
   * Convert Yjs document to Markdown
   * @param {string} documentId
   * @returns {string}
   */
  yjsToMarkdown(documentId) {
    return this.getMarkdown(documentId);
  }

  /**
   * Extract YAML frontmatter from Markdown
   */
  _extractFrontmatter(markdown) {
    if (!markdown.startsWith("---")) {
      return null;
    }

    const endIndex = markdown.indexOf("---", 3);
    if (endIndex === -1) {
      return null;
    }

    const yamlContent = markdown.slice(3, endIndex).trim();
    const result = {};

    for (const line of yamlContent.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        result[match[1]] = match[2].trim();
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  // ==========================================
  // Document Lifecycle
  // ==========================================

  /**
   * Close and destroy a document
   * @param {string} documentId
   */
  closeDocument(documentId) {
    const doc = this.documents.get(documentId);
    if (doc) {
      doc.destroy();
      this.documents.delete(documentId);
      this._metadata.delete(documentId);
      logger.info(`[YjsCRDTEngine] Closed document: ${documentId}`);
    }
  }

  /**
   * Get list of active documents
   * @returns {Array}
   */
  getActiveDocuments() {
    return Array.from(this.documents.keys()).map((id) => ({
      documentId: id,
      ...this._metadata.get(id),
      contentLength: this.getMarkdown(id).length,
    }));
  }

  /**
   * Check document size
   * @param {string} documentId
   * @returns {number} Size in bytes
   */
  getDocumentSize(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc || !Y) {
      return 0;
    }

    const state = Y.encodeStateAsUpdate(doc);
    return state.length;
  }

  _updateMetadata(documentId) {
    const meta = this._metadata.get(documentId);
    if (meta) {
      meta.lastModified = Date.now();
      meta.updateCount = (meta.updateCount || 0) + 1;
    }
  }

  /**
   * Destroy all documents and clean up
   */
  destroy() {
    for (const [id, doc] of this.documents) {
      doc.destroy();
    }
    this.documents.clear();
    this._metadata.clear();
    this.removeAllListeners();
    logger.info("[YjsCRDTEngine] Destroyed");
  }
}

module.exports = { YjsCRDTEngine };

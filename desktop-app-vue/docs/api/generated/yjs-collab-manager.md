# yjs-collab-manager

**Source**: `src/main/collaboration/yjs-collab-manager.js`

**Generated**: 2026-02-21T20:04:16.260Z

---

## const

```javascript
const
```

* Yjs Collaboration Manager
 *
 * Manages real-time collaborative editing using Yjs CRDT.
 * Integrates with the existing P2P network for document synchronization.
 *
 * Features:
 * - Real-time document synchronization
 * - Conflict-free concurrent editing
 * - Cursor position tracking
 * - Presence awareness (who's editing)
 * - Offline support with automatic sync
 * - Version history integration

---

## _initializeProtocolHandlers()

```javascript
_initializeProtocolHandlers()
```

* Initialize P2P protocol handlers for Yjs sync

---

## getDocument(docId)

```javascript
getDocument(docId)
```

* Get or create a Yjs document for the given ID

---

## getAwareness(docId)

```javascript
getAwareness(docId)
```

* Get or create awareness state for a document

---

## async openDocument(docId, organizationId = null)

```javascript
async openDocument(docId, organizationId = null)
```

* Open a document for collaborative editing

---

## async closeDocument(docId)

```javascript
async closeDocument(docId)
```

* Close a document and clean up resources

---

## async updateCursor(docId, cursor, selection = null)

```javascript
async updateCursor(docId, cursor, selection = null)
```

* Update cursor position for local user

---

## getActiveUsers(docId)

```javascript
getActiveUsers(docId)
```

* Get all users currently editing a document

---

## async createSnapshot(docId, metadata =

```javascript
async createSnapshot(docId, metadata =
```

* Create a snapshot of the current document state

---

## async restoreSnapshot(docId, snapshotId)

```javascript
async restoreSnapshot(docId, snapshotId)
```

* Restore document from a snapshot

---

## async getVersionHistory(docId, limit = 50)

```javascript
async getVersionHistory(docId, limit = 50)
```

* Get version history for a document

---

## async _broadcastUpdate(docId, update)

```javascript
async _broadcastUpdate(docId, update)
```

* Broadcast document update to all connected peers

---

## async _broadcastAwareness(docId, organizationId = null)

```javascript
async _broadcastAwareness(docId, organizationId = null)
```

* Broadcast awareness update to peers

---

## async _connectToPeers(docId, organizationId = null)

```javascript
async _connectToPeers(docId, organizationId = null)
```

* Connect to peers editing the same document

---

## async _saveUpdate(docId, update)

```javascript
async _saveUpdate(docId, update)
```

* Save document update to database

---

## async _loadDocument(docId, ydoc)

```javascript
async _loadDocument(docId, ydoc)
```

* Load document from database

---

## async _readFromStream(stream)

```javascript
async _readFromStream(stream)
```

* Helper: Read data from libp2p stream

---

## async _writeToStream(stream, data)

```javascript
async _writeToStream(stream, data)
```

* Helper: Write data to libp2p stream

---

## _encodeAwarenessUpdate(awareness)

```javascript
_encodeAwarenessUpdate(awareness)
```

* Helper: Encode awareness update

---

## _applyAwarenessUpdate(awareness, update, peerId)

```javascript
_applyAwarenessUpdate(awareness, update, peerId)
```

* Helper: Apply awareness update

---

## async _getUserName()

```javascript
async _getUserName()
```

* Helper: Get current user's name

---

## async _getUserDID()

```javascript
async _getUserDID()
```

* Helper: Get current user's DID

---

## _generateUserColor()

```javascript
_generateUserColor()
```

* Helper: Generate random color for user cursor

---

## destroy()

```javascript
destroy()
```

* Clean up resources

---


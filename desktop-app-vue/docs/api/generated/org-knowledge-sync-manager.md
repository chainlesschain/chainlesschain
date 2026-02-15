# org-knowledge-sync-manager

**Source**: `src/main/collaboration/org-knowledge-sync-manager.js`

**Generated**: 2026-02-15T08:42:37.250Z

---

## const

```javascript
const
```

* Organization Knowledge Sync Manager
 *
 * Manages knowledge base synchronization across organization members using P2P network.
 * Integrates with Yjs CRDT for real-time collaboration and conflict-free merging.
 *
 * Features:
 * - P2P knowledge base synchronization
 * - Folder-based permissions
 * - Real-time knowledge updates
 * - Conflict resolution
 * - Activity tracking
 * - Offline support with sync queue

---

## _initializeMessageHandlers()

```javascript
_initializeMessageHandlers()
```

* Initialize message handlers for knowledge sync

---

## async initialize(orgId)

```javascript
async initialize(orgId)
```

* Initialize knowledge sync for an organization

---

## async createFolder(orgId, folderData)

```javascript
async createFolder(orgId, folderData)
```

* Create a shared folder in the organization

---

## async shareKnowledge(orgId, knowledgeId, options =

```javascript
async shareKnowledge(orgId, knowledgeId, options =
```

* Share a knowledge item with the organization

---

## async updateKnowledge(orgId, knowledgeId, updates)

```javascript
async updateKnowledge(orgId, knowledgeId, updates)
```

* Update shared knowledge

---

## async deleteKnowledge(orgId, knowledgeId)

```javascript
async deleteKnowledge(orgId, knowledgeId)
```

* Delete shared knowledge

---

## async getOrganizationKnowledge(orgId, options =

```javascript
async getOrganizationKnowledge(orgId, options =
```

* Get all shared knowledge in organization

---

## async getOrganizationFolders(orgId, parentFolderId = null)

```javascript
async getOrganizationFolders(orgId, parentFolderId = null)
```

* Get organization folders

---

## async getActivityLog(orgId, options =

```javascript
async getActivityLog(orgId, options =
```

* Get knowledge activity log

---

## async _handleKnowledgeCreate(orgId, payload, from)

```javascript
async _handleKnowledgeCreate(orgId, payload, from)
```

* Handle incoming knowledge create message

---

## async _handleKnowledgeUpdate(orgId, payload, from)

```javascript
async _handleKnowledgeUpdate(orgId, payload, from)
```

* Handle incoming knowledge update message

---

## async _handleKnowledgeDelete(orgId, payload, from)

```javascript
async _handleKnowledgeDelete(orgId, payload, from)
```

* Handle incoming knowledge delete message

---

## async _handleFolderCreate(orgId, payload, from)

```javascript
async _handleFolderCreate(orgId, payload, from)
```

* Handle incoming folder create message

---

## async _handleYjsUpdate(orgId, payload, from)

```javascript
async _handleYjsUpdate(orgId, payload, from)
```

* Handle Yjs update message

---

## async _handleYjsAwareness(orgId, payload, from)

```javascript
async _handleYjsAwareness(orgId, payload, from)
```

* Handle Yjs awareness message

---

## async _requestInitialSync(orgId)

```javascript
async _requestInitialSync(orgId)
```

* Request initial sync from peers

---

## async _handleSyncRequest(orgId, payload, from)

```javascript
async _handleSyncRequest(orgId, payload, from)
```

* Handle sync request from peer

---

## async _checkPermission(orgId, knowledgeId, action)

```javascript
async _checkPermission(orgId, knowledgeId, action)
```

* Check if user has permission for an action

---

## async _logActivity(orgId, knowledgeId, activityType, metadata =

```javascript
async _logActivity(orgId, knowledgeId, activityType, metadata =
```

* Log activity

---

## async _getUserDID()

```javascript
async _getUserDID()
```

* Get current user's DID

---

## async _getUserName()

```javascript
async _getUserName()
```

* Get current user's name

---

## destroy()

```javascript
destroy()
```

* Clean up resources

---


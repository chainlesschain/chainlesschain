# permission-manager

**Source**: `src/main/collaboration/permission-manager.js`

**Generated**: 2026-02-21T20:04:16.260Z

---

## const

```javascript
const
```

* Permission Manager
 *
 * Manages role-based permissions for organization knowledge folders and items.
 *
 * Permission Levels:
 * - owner: Full control (create, edit, delete, share, manage permissions)
 * - admin: Manage content (create, edit, delete, share)
 * - editor: Edit content (create, edit)
 * - member/viewer: View only
 *
 * Permission Types:
 * - view: Can view content
 * - edit: Can modify content
 * - delete: Can delete content
 * - share: Can share with others
 * - manage: Can manage permissions

---

## async checkPermission(orgId, userDID, resourceType, resourceId, action)

```javascript
async checkPermission(orgId, userDID, resourceType, resourceId, action)
```

* Check if user has permission for an action

---

## async getUserRole(orgId, userDID)

```javascript
async getUserRole(orgId, userDID)
```

* Get user's role in organization

---

## async getFolderPermissions(folderId)

```javascript
async getFolderPermissions(folderId)
```

* Get folder permissions

---

## async getKnowledgePermissions(knowledgeId)

```javascript
async getKnowledgePermissions(knowledgeId)
```

* Get knowledge item permissions

---

## async updateFolderPermissions(orgId, folderId, userDID, newPermissions)

```javascript
async updateFolderPermissions(orgId, folderId, userDID, newPermissions)
```

* Update folder permissions

---

## async updateKnowledgePermissions(

```javascript
async updateKnowledgePermissions(
```

* Update knowledge item permissions

---

## validatePermissions(permissions)

```javascript
validatePermissions(permissions)
```

* Validate permissions structure

---

## async getEffectivePermissions(orgId, userDID, resourceType, resourceId)

```javascript
async getEffectivePermissions(orgId, userDID, resourceType, resourceId)
```

* Get effective permissions for user on a resource

---

## async canAccessFolder(orgId, userDID, folderId)

```javascript
async canAccessFolder(orgId, userDID, folderId)
```

* Check if user can access folder

---

## async canAccessKnowledge(orgId, userDID, knowledgeId)

```javascript
async canAccessKnowledge(orgId, userDID, knowledgeId)
```

* Check if user can access knowledge item

---

## async getAccessibleFolders(orgId, userDID)

```javascript
async getAccessibleFolders(orgId, userDID)
```

* Get all accessible folders for user

---

## async getAccessibleKnowledge(orgId, userDID, options =

```javascript
async getAccessibleKnowledge(orgId, userDID, options =
```

* Get all accessible knowledge items for user

---

## getPermissionPreset(presetName)

```javascript
getPermissionPreset(presetName)
```

* Create permission preset

---

## async bulkUpdatePermissions(orgId, userDID, updates)

```javascript
async bulkUpdatePermissions(orgId, userDID, updates)
```

* Bulk update permissions for multiple resources

---

## async inheritFolderPermissions(childFolderId, parentFolderId)

```javascript
async inheritFolderPermissions(childFolderId, parentFolderId)
```

* Inherit permissions from parent folder

---

## async getPermissionSummary(orgId)

```javascript
async getPermissionSummary(orgId)
```

* Get permission summary for organization

---

## _analyzePermissionDistribution(folders, knowledge)

```javascript
_analyzePermissionDistribution(folders, knowledge)
```

* Analyze permission distribution

---

## destroy()

```javascript
destroy()
```

* Clean up resources

---


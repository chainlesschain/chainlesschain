# permission-ipc

**Source**: `src/main/organization/permission-ipc.js`

**Generated**: 2026-02-22T01:23:36.703Z

---

## const

```javascript
const
```

* Permission Management IPC Handlers
 *
 * Provides IPC endpoints for managing permissions in the enterprise version.
 *
 * Endpoints:
 * - permission:check - Check if user has specific permission
 * - permission:get-effective - Get all effective permissions for user
 * - permission:update-resource - Update permissions for a resource
 * - permission:create-override - Create permission override for user
 * - permission:delete-override - Delete permission override
 * - permission:get-audit-log - Get permission audit log
 * - permission:create-template - Create permission template
 * - permission:apply-template - Apply permission template
 * - permission:create-group - Create permission group
 * - permission:assign-group - Assign permission group to role

---

## convertToResourcePermissions(permissions)

```javascript
convertToResourcePermissions(permissions)
```

* Convert permission array to resource permissions object

---

## async logActivity(orgId, userDID, action, targetType, targetId, details)

```javascript
async logActivity(orgId, userDID, action, targetType, targetId, details)
```

* Log activity

---

## destroy()

```javascript
destroy()
```

* Clean up

---


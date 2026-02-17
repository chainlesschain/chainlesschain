# permission-middleware

**Source**: `src/main/organization/permission-middleware.js`

**Generated**: 2026-02-17T10:13:18.218Z

---

## const

```javascript
const
```

* Permission Middleware
 *
 * Provides middleware functions for permission checking in IPC handlers and API routes.
 * Implements fine-grained access control for enterprise features.
 *
 * Features:
 * - Role-based access control (RBAC)
 * - Resource-level permissions
 * - Permission inheritance
 * - Audit logging
 * - Rate limiting for sensitive operations

---

## requirePermission(requiredPermission, options =

```javascript
requirePermission(requiredPermission, options =
```

* Create middleware for IPC handler
   * @param {string} requiredPermission - Required permission string
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function

---

## requireAllPermissions(requiredPermissions, options =

```javascript
requireAllPermissions(requiredPermissions, options =
```

* Create middleware for multiple permissions (AND logic)
   * @param {string[]} requiredPermissions - Array of required permissions
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function

---

## requireAnyPermission(requiredPermissions, options =

```javascript
requireAnyPermission(requiredPermissions, options =
```

* Create middleware for multiple permissions (OR logic)
   * @param {string[]} requiredPermissions - Array of required permissions
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function

---

## requireRole(allowedRoles, options =

```javascript
requireRole(allowedRoles, options =
```

* Create middleware for role-based access
   * @param {string[]} allowedRoles - Array of allowed roles
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function

---

## requireOwnership(resourceType, resourceIdExtractor, options =

```javascript
requireOwnership(resourceType, resourceIdExtractor, options =
```

* Create middleware for resource ownership check
   * @param {string} resourceType - Type of resource (folder, knowledge, etc.)
   * @param {Function} resourceIdExtractor - Function to extract resource ID from args
   * @param {Object} options - Middleware options
   * @returns {Function} Middleware function

---

## rateLimit(operation, limits =

```javascript
rateLimit(operation, limits =
```

* Create middleware with rate limiting
   * @param {string} operation - Operation name
   * @param {Object} limits - Rate limit configuration
   * @returns {Function} Middleware function

---

## async checkPermission(orgId, userDID, permission, options =

```javascript
async checkPermission(orgId, userDID, permission, options =
```

* Check permission with caching
   * @param {string} orgId - Organization ID
   * @param {string} userDID - User DID
   * @param {string} permission - Permission string
   * @param {Object} options - Check options
   * @returns {Promise<boolean>}

---

## async checkOrgPermission(orgId, userDID, action)

```javascript
async checkOrgPermission(orgId, userDID, action)
```

* Check organization-level permission

---

## async checkMemberPermission(orgId, userDID, action)

```javascript
async checkMemberPermission(orgId, userDID, action)
```

* Check member management permission

---

## async checkKnowledgePermission(orgId, userDID, action, options =

```javascript
async checkKnowledgePermission(orgId, userDID, action, options =
```

* Check knowledge base permission

---

## async checkProjectPermission(orgId, userDID, action, options =

```javascript
async checkProjectPermission(orgId, userDID, action, options =
```

* Check project permission

---

## async checkGenericPermission(orgId, userDID, permission)

```javascript
async checkGenericPermission(orgId, userDID, permission)
```

* Check generic permission

---

## async checkOwnership(orgId, userDID, resourceType, resourceId)

```javascript
async checkOwnership(orgId, userDID, resourceType, resourceId)
```

* Check resource ownership

---

## extractContext(args)

```javascript
extractContext(args)
```

* Extract context from IPC arguments

---

## async logPermissionGrant(orgId, userDID, permission, context)

```javascript
async logPermissionGrant(orgId, userDID, permission, context)
```

* Log permission grant

---

## async logPermissionDenial(orgId, userDID, permission, context)

```javascript
async logPermissionDenial(orgId, userDID, permission, context)
```

* Log permission denial

---

## async logRoleDenial(orgId, userDID, requiredRoles, userRole, context)

```javascript
async logRoleDenial(orgId, userDID, requiredRoles, userRole, context)
```

* Log role denial

---

## async logOwnershipDenial(orgId, userDID, resourceType, resourceId, context)

```javascript
async logOwnershipDenial(orgId, userDID, resourceType, resourceId, context)
```

* Log ownership denial

---

## async logRateLimitExceeded(orgId, userDID, operation, context)

```javascript
async logRateLimitExceeded(orgId, userDID, operation, context)
```

* Log rate limit exceeded

---

## clearCache(orgId = null, userDID = null)

```javascript
clearCache(orgId = null, userDID = null)
```

* Clear permission cache

---

## async getAuditLog(orgId, options =

```javascript
async getAuditLog(orgId, options =
```

* Get audit log

---

## destroy()

```javascript
destroy()
```

* Clean up resources

---


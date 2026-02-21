# mcp-security-policy

**Source**: `src/main/mcp/mcp-security-policy.js`

**Generated**: 2026-02-21T20:04:16.235Z

---

## const

```javascript
const
```

* MCP Security Policy
 *
 * Enforces security controls for MCP server operations.
 * Implements path restrictions, user consent, and audit logging.
 *
 * @module MCPSecurityPolicy

---

## function normalizeSecurityPath(inputPath)

```javascript
function normalizeSecurityPath(inputPath)
```

* Normalize a path for security comparison
 * Handles both Windows and Unix path formats
 * @param {string} inputPath - Path to normalize
 * @returns {string} Normalized path

---

## function pathMatchesPattern(testPath, pattern)

```javascript
function pathMatchesPattern(testPath, pattern)
```

* Check if a path matches a pattern (supports wildcards)
 * @param {string} testPath - Path to test
 * @param {string} pattern - Pattern to match against
 * @returns {boolean}

---

## class SecurityError extends Error

```javascript
class SecurityError extends Error
```

* Security error class

---

## class MCPSecurityPolicy extends EventEmitter

```javascript
class MCPSecurityPolicy extends EventEmitter
```

* MCP Security Policy

---

## setMainWindow(window)

```javascript
setMainWindow(window)
```

* Set main window reference for IPC communication
   * @param {BrowserWindow} window - Electron BrowserWindow

---

## setServerPermissions(serverName, permissions)

```javascript
setServerPermissions(serverName, permissions)
```

* Set permissions for a specific server
   * @param {string} serverName - Server identifier
   * @param {Object} permissions - Permission configuration

---

## async validateToolExecution(serverName, toolName, params)

```javascript
async validateToolExecution(serverName, toolName, params)
```

* Validate tool execution
   * @param {string} serverName - Server identifier
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @throws {SecurityError} If validation fails

---

## _validatePathAccess(serverName, operation, targetPath)

```javascript
_validatePathAccess(serverName, operation, targetPath)
```

* Validate path access
   * Uses cross-platform path normalization for consistent security checks
   * @param {string} serverName - Server identifier
   * @param {string} operation - Operation type (read/write/delete)
   * @param {string} targetPath - Path to validate
   * @throws {SecurityError} If access denied

---

## _validateWritePermission(serverName, operation)

```javascript
_validateWritePermission(serverName, operation)
```

* Validate write permission
   * @private

---

## _validateTrustedServer(serverName)

```javascript
_validateTrustedServer(serverName)
```

* Validate trusted server
   * @private

---

## _detectOperation(toolName, _params)

```javascript
_detectOperation(toolName, _params)
```

* Detect operation type from tool name and params
   * @private

---

## _assessRiskLevel(toolName, params, operation)

```javascript
_assessRiskLevel(toolName, params, operation)
```

* Assess risk level of operation
   * @private

---

## async _requestUserConsent(serverName, toolName, params, riskLevel)

```javascript
async _requestUserConsent(serverName, toolName, params, riskLevel)
```

* Request user consent for high-risk operations
   * @private
   * @returns {Promise<void>} Resolves if allowed, rejects if denied

---

## async _requestConsentViaIPC(consentRequest, cacheKey)

```javascript
async _requestConsentViaIPC(consentRequest, cacheKey)
```

* Request consent via IPC to renderer process
   * @private

---

## async _requestConsentViaEvent(consentRequest, cacheKey)

```javascript
async _requestConsentViaEvent(consentRequest, cacheKey)
```

* Request consent via event emission (fallback)
   * @private

---

## handleConsentResponse(requestId, decision)

```javascript
handleConsentResponse(requestId, decision)
```

* Handle consent response from user
   * @param {string} requestId - Consent request ID
   * @param {string} decision - User decision: 'allow', 'deny', 'always_allow', 'always_deny'

---

## getPendingConsentRequests()

```javascript
getPendingConsentRequests()
```

* Get pending consent requests
   * @returns {Object[]} List of pending requests

---

## cancelConsentRequest(requestId)

```javascript
cancelConsentRequest(requestId)
```

* Cancel a pending consent request
   * @param {string} requestId - Request ID to cancel

---

## _generateConsentKey(serverName, toolName, params)

```javascript
_generateConsentKey(serverName, toolName, params)
```

* Generate consent cache key
   * @private

---

## _logAudit(decision, serverName, toolName, params, details)

```javascript
_logAudit(decision, serverName, toolName, params, details)
```

* Log to audit trail
   * @private

---

## getAuditLog(filters =

```javascript
getAuditLog(filters =
```

* Get audit log
   * @param {Object} filters - Optional filters
   * @returns {Object[]} Audit log entries

---

## clearConsentCache()

```javascript
clearConsentCache()
```

* Clear consent cache

---

## getServerPermissions(serverName)

```javascript
getServerPermissions(serverName)
```

* Get server permissions
   * @param {string} serverName - Server identifier
   * @returns {Object|null} Server permissions or null if not found

---

## async requestUserConsent(request)

```javascript
async requestUserConsent(request)
```

* Request user consent for server connection (public method for IPC)
   * @param {Object} request - Consent request details
   * @param {string} request.operation - Operation type (e.g., 'connect-server')
   * @param {string} request.serverName - Server name
   * @param {string} request.securityLevel - Security level (e.g., 'high')
   * @param {string[]} request.permissions - Required permissions
   * @returns {Promise<boolean>} True if consent granted, false otherwise

---

## validateToolCall(serverName, toolName, args)

```javascript
validateToolCall(serverName, toolName, args)
```

* Validate a tool call (synchronous check for IPC)
   * @param {string} serverName - Server name
   * @param {string} toolName - Tool name
   * @param {Object} args - Tool arguments
   * @returns {Object} { permitted: boolean, reason?: string }

---

## validateResourceAccess(serverName, resourceUri)

```javascript
validateResourceAccess(serverName, resourceUri)
```

* Validate resource access (synchronous check for IPC)
   * @param {string} serverName - Server name
   * @param {string} resourceUri - Resource URI
   * @returns {Object} { permitted: boolean, reason?: string }

---

## getStatistics()

```javascript
getStatistics()
```

* Get security statistics

---


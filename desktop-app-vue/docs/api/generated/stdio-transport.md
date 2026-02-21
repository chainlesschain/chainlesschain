# stdio-transport

**Source**: `src/main/mcp/transports/stdio-transport.js`

**Generated**: 2026-02-21T22:04:25.817Z

---

## const

```javascript
const
```

* Stdio Transport for MCP
 *
 * Provides stdio-based communication with MCP servers.
 * Handles process lifecycle, message serialization, and error recovery.
 * Supports cross-platform operation (Windows, macOS, Linux).
 *
 * @module StdioTransport

---

## const PLATFORM =

```javascript
const PLATFORM =
```

* Platform detection

---

## function getPlatformSpawnOptions(config)

```javascript
function getPlatformSpawnOptions(config)
```

* Get platform-specific spawn options
 * @param {Object} config - Configuration object
 * @returns {Object} Spawn options

---

## function normalizePath(inputPath)

```javascript
function normalizePath(inputPath)
```

* Normalize a path for the current platform
 * @param {string} inputPath - Input path
 * @returns {string} Normalized path

---

## function getKillSignal()

```javascript
function getKillSignal()
```

* Get the appropriate kill signal for the platform
 * @returns {string} Kill signal

---

## class StdioTransport extends EventEmitter

```javascript
class StdioTransport extends EventEmitter
```

* @typedef {Object} TransportConfig
 * @property {string} command - Command to execute
 * @property {string[]} args - Command arguments
 * @property {Object} env - Environment variables
 * @property {string} cwd - Working directory
 * @property {number} timeout - Operation timeout in ms

---

## async start(config =

```javascript
async start(config =
```

* Start the MCP server process
   * @param {TransportConfig} config - Transport configuration
   * @returns {Promise<void>}

---

## async send(message)

```javascript
async send(message)
```

* Send a message to the MCP server
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Response from server

---

## _handleMessage(line)

```javascript
_handleMessage(line)
```

* Handle incoming message from server
   * @private
   * @param {string} line - Raw JSON line

---

## _handleProcessExit(code, signal)

```javascript
_handleProcessExit(code, signal)
```

* Handle process exit
   * @private
   * @param {number} code - Exit code
   * @param {string} signal - Exit signal

---

## async stop()

```javascript
async stop()
```

* Stop the MCP server process
   * @returns {Promise<void>}

---

## _windowsKill()

```javascript
_windowsKill()
```

* Windows-specific process termination
   * @private

---

## _forceKill()

```javascript
_forceKill()
```

* Force kill the process
   * @private

---

## isReady()

```javascript
isReady()
```

* Check if transport is connected
   * @returns {boolean}

---


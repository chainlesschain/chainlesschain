# http-sse-transport

**Source**: `src/main/mcp/transports/http-sse-transport.js`

**Generated**: 2026-02-21T22:04:25.817Z

---

## const

```javascript
const
```

* HTTP+SSE Transport for MCP
 *
 * Provides HTTP+Server-Sent Events based communication with MCP servers.
 * More suitable for remote servers and web-based MCP services.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat keep-alive mechanism
 * - Health check monitoring
 * - Authentication token refresh
 * - Connection state management
 * - Circuit breaker pattern for fault tolerance
 *
 * @module HttpSseTransport

---

## const ConnectionState =

```javascript
const ConnectionState =
```

* @typedef {Object} HttpSseTransportConfig
 * @property {string} baseURL - Base URL of the MCP server
 * @property {string} apiKey - Optional API key for authentication
 * @property {Object} headers - Additional HTTP headers
 * @property {number} timeout - Request timeout in ms
 * @property {boolean} useSSL - Use HTTPS
 * @property {number} maxRetries - Maximum retry attempts
 * @property {number} retryDelay - Initial retry delay in ms
 * @property {number} heartbeatInterval - Heartbeat interval in ms (default: 30000)
 * @property {number} healthCheckInterval - Health check interval in ms (default: 60000)
 * @property {boolean} enableHeartbeat - Enable heartbeat mechanism (default: true)
 * @property {boolean} enableHealthCheck - Enable health check (default: true)
 * @property {Function} onTokenRefresh - Callback for token refresh

---

## const ConnectionState =

```javascript
const ConnectionState =
```

* Connection states

---

## const CircuitState =

```javascript
const CircuitState =
```

* Circuit breaker states

---

## async start()

```javascript
async start()
```

* Start the HTTP+SSE connection
   * @returns {Promise<void>}

---

## async _connectSSE()

```javascript
async _connectSSE()
```

* Establish SSE connection for server-to-client messages
   * @private

---

## async _reconnectSSE()

```javascript
async _reconnectSSE()
```

* Reconnect SSE with exponential backoff
   * @private

---

## async send(message)

```javascript
async send(message)
```

* Send a message to the MCP server via HTTP POST
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<Object>} Response from server

---

## async _sendHttpRequest(message)

```javascript
async _sendHttpRequest(message)
```

* Send HTTP POST request
   * @private
   * @param {Object} message - JSON-RPC message
   * @returns {Promise<void>}

---

## _handleMessage(message)

```javascript
_handleMessage(message)
```

* Handle incoming message from SSE
   * @private
   * @param {Object} message - JSON-RPC message

---

## async stop()

```javascript
async stop()
```

* Stop the HTTP+SSE connection
   * @returns {Promise<void>}

---

## _startHeartbeat()

```javascript
_startHeartbeat()
```

* Start heartbeat mechanism
   * @private

---

## _stopHeartbeat()

```javascript
_stopHeartbeat()
```

* Stop heartbeat mechanism
   * @private

---

## async _sendHeartbeat()

```javascript
async _sendHeartbeat()
```

* Send heartbeat ping
   * @private

---

## _startHealthCheck()

```javascript
_startHealthCheck()
```

* Start health check mechanism
   * @private

---

## _stopHealthCheck()

```javascript
_stopHealthCheck()
```

* Stop health check mechanism
   * @private

---

## async checkHealth()

```javascript
async checkHealth()
```

* Perform health check
   * @returns {Promise<Object>} Health check result

---

## getHealthStatus()

```javascript
getHealthStatus()
```

* Get health status summary
   * @returns {Object}

---

## _handleConnectionFailure(error)

```javascript
_handleConnectionFailure(error)
```

* Handle connection failure for circuit breaker
   * @private

---

## _openCircuit()

```javascript
_openCircuit()
```

* Open the circuit breaker
   * @private

---

## _resetCircuitBreaker()

```javascript
_resetCircuitBreaker()
```

* Reset circuit breaker after successful operation
   * @private

---

## async refreshToken()

```javascript
async refreshToken()
```

* Refresh authentication token
   * @returns {Promise<void>}

---

## updateApiKey(apiKey)

```javascript
updateApiKey(apiKey)
```

* Update API key
   * @param {string} apiKey - New API key

---

## isReady()

```javascript
isReady()
```

* Check if transport is connected
   * @returns {boolean}

---

## async ping()

```javascript
async ping()
```

* Send a ping to check connection health
   * @returns {Promise<number>} Round-trip time in ms

---

## getStats()

```javascript
getStats()
```

* Get transport statistics
   * @returns {Object}

---

## resetStats()

```javascript
resetStats()
```

* Reset statistics

---

## async waitForConnection(timeout = 30000)

```javascript
async waitForConnection(timeout = 30000)
```

* Wait for connection to be ready
   * @param {number} timeout - Maximum wait time in ms
   * @returns {Promise<void>}

---

## async retryWithBackoff(fn, options =

```javascript
async retryWithBackoff(fn, options =
```

* Retry a function with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {Object} options - Retry options
   * @returns {Promise<any>}

---


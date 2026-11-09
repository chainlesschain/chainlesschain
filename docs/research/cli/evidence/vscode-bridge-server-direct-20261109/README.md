# Direct VS Code bridge server probe (2026-11-09)

The repository's production `src/mcp-http-server.js` was started on a real Windows loopback port with a bearer token and exercised through an HTTP `initialize` request. The probe completed with a live TCP connection, HTTP 200, a session header, and valid JSON response. This isolates the live-host failure from the HTTP server implementation and the machine loopback stack; the unresolved boundary remains the production extension lifecycle inside VS Code Extension Host.

No provider calls or credentials were used.

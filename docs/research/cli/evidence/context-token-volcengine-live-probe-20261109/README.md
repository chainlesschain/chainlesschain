# Volcengine context-token live probe (2026-11-09)

With the authorized key supplied through the process environment and an isolated temporary config, the bounded probe completed **4/4** generated requests against the built-in Volcengine endpoint using `deepseek-v4-1-flash-economy-261017`. All four returned HTTP 200 with captured usage (`prompt_tokens`: 698, 842, 1037, and 2071; `completion_tokens`: 8 each), response and request hashes, and no persisted response text or credentials.

The calibration receipt records 4 samples and observed provider input totals. `unknownCostRequests: 4`, `invoiceAssessed: false`, and `outputLimitEnforcementVerified: false` remain explicit: this proves transport and usage capture, not billing, provider price reconciliation, output-cap enforcement, or production paid readiness.
The earlier unprivileged sandbox failure remains preserved as `failed-unprivileged-receipt.json`; it recorded no successful response and was not overwritten as a pass.


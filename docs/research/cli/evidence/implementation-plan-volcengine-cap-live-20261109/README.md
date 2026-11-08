# Volcengine live output-cap diagnostic (2026-11-09)

The bounded live diagnostic ran against the configured Volcengine endpoint and model with an isolated pricing override and the authorized key supplied only through `VOLCENGINE_API_KEY`. All five checks passed across six admitted requests. The dedicated cap check asked for a long list while sending `maxOutputTokens=1`; the provider reported `output_tokens=1`. The cancellation request remains `usageUnknown:true`, so this is observed provider-cap evidence, not invoice reconciliation or formal paid admission.

The final receipt is `receipt-v4.json`, bound to source commit `e3714c33e`. Earlier failed or superseded receipts remain in this directory for audit history.

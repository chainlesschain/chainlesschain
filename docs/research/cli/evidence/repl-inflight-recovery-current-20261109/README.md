# Current-HEAD REPL concurrent-input recovery (2026-11-09)

The real CLI/readline/Evolution/JSONL and loopback journey passed on current `main` commit `fb1cfe3a4352867ea99a9918d6a8271b729e98cf`:

`npx vitest run --config vitest.e2e.config.js __tests__/e2e/repl-inflight-recovery-e2e.test.js --reporter=dot`

The suite passed 2/2. The journey killed the original process while its model request was unsettled, immediately supplied new input to the resumed process while startup/recovery overlapped, admitted exactly one new provider request, replayed the old request zero times, preserved the unknown settlement and emitted a visible recovery notice. The test uses an emulated stdin rather than an OS PTY and a loopback provider fixture; it does not prove dual-IDE or cross-entry recovery.

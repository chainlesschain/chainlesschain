# Worktree registry formatting delta

Prettier completed successfully for worktree-isolator.js. Archived bytes changed from 994ca6ed32086c493b8731fa8ffed8dd12e1c8f802d696c10cb92f6971333f2b to 0978ed3c1b8a756b67365c9d98d052b851b771f242a0bfe02cc35a7d5c51f84b. Independent Acorn parsing confirms identical serialized ASTs after removing start/end/loc/raw fields; original before/after bytes, formatter output and script are preserved. This comparison is not a runtime test or a general behavioral proof.

The final test-file hash remains 83921b021049893fa6f5ef561a3b782dcd2b2ab4a7ef242cdbd7bb580b480a57. The earlier 10-test pass is not transferred to the new formatted harness bytes, and the unchanged 52-test suite was not rerun. Final exact-commit CI must validate formatted source. This archival action did not run the formatter, edit source or mutate Git. See [summary.json](./summary.json) and [manifest.json](./manifest.json).

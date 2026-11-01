# Second repaired-engine candidate: 0/5, not published

Execution and independent checker: `95567903c800001de9793c804580a1157808fcf3`. Candidate engine and maintained project: `b7498521795702515cf8c24b9842da6ae3bed5db`, built by Actions 41275646986; all five installations verified 13 source hashes and immutable package locks. Versions .137 / .174 / .190 remain unpublished.

All five samples ran and failed. There were **77 physical requests, 77 complete broker usage records, zero unknown request usage**. The known token-only estimate is **$2.3827944**; cache-write TTL and actual billing remain unknown. CLI pricing flags missing cache-write TTL evidence rather than assigning a fabricated price.

| Sample | Requests | Actual terminal | Independent candidate result |
| --- | ---: | --- | --- |
| verify-08 | 13 | Repeated-read no-progress guard | Placeholder has no executed test cases |
| verify-13 | 20 | Iteration budget exhausted | Runner exhausts the Node heap; tests remain pending; candidate includes a deep comparison of 20 MiB buffers |
| verify-19 | 20 | Iteration budget exhausted | 8 candidate tests pass but miss a behavioral mutant |
| verify-36 | 12 | Repeated-read no-progress guard | 6 candidate tests pass but miss a behavioral mutant |
| first-run-darwin-vscode | 12 | Repeated-read no-progress guard | Candidate regression fails |

The original-task binding repair survives real compactions and every request still contains its original task. No new task-context-loss or OpenAI/provider error occurred. A new shared defect is reproduced in actual broker inputs: complete valid JavaScript source with object/array trailing commas is replaced by `Text omitted` before model dispatch. The model repeatedly halves pages, then exhausts guard or iteration limits. Minimal valid source `const a = ["one", "two",];` reproduces the preview omission. A source-specific repair must retain strict JSON, nested data, credential and budget checks; removing the loop guard or enlarging budgets is not a repair.

The original candidate files, model protocol, all broker requests/responses/usage receipts, independent setup/check receipts, package locks and build proofs are retained unchanged. Large workspace-tree inventories are retained in the original download, with their enclosing artifact identities recorded here; they are not duplicated in this source archive. The five-task gate was independently recomputed and remains false. Historical 41/45 and all preceding rounds remain separate.

The owned temporary secret was deleted and absence verified at 2026-11-01T05:49:42.624Z; local user configuration was unchanged. Six Strict Sandbox jobs passed on this exact source; the incomplete CLI CI matrix was cancelled after establishing the new source defect. Neither transfers to a future repaired release commit.

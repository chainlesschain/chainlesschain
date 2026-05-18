import { createWorktreeRecord } from "../../runtime/contracts/worktree-record.js";
import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
  createCodingAgentEvent,
  CODING_AGENT_EVENT_TYPES,
} from "../../runtime/runtime-events.js";

function envelopeResponse(type, id, payload) {
  return createCodingAgentEvent(type, payload || {}, {
    requestId: id,
    source: "cli-runtime",
  });
}

function envelopeError(id, code, message) {
  return createCodingAgentEvent(
    CODING_AGENT_EVENT_TYPES.ERROR,
    { code, message },
    { requestId: id, source: "cli-runtime" },
  );
}

export async function handleWorktreeDiff(server, id, ws, message) {
  try {
    const { diffWorktree } = await import("../../lib/worktree-isolator.js");
    const { branch, baseBranch, filePath } = message;
    if (!branch) {
      server._send(ws, envelopeError(id, "NO_BRANCH", "branch required"));
      return;
    }
    const result = diffWorktree(process.cwd(), branch, {
      baseBranch,
      filePath,
    });
    server._send(
      ws,
      envelopeResponse(CODING_AGENT_EVENT_TYPES.WORKTREE_DIFF, id, {
        filePath: result.filePath || filePath || null,
        files: result.files,
        summary: result.summary,
        diff: result.diff,
        record: createWorktreeRecord({
          branch,
          baseBranch,
          summary: result.summary,
          previewEntrypoints: [
            {
              type: "worktree-diff",
              branch,
            },
          ],
        }),
      }),
    );
    server.emit(
      RUNTIME_EVENTS.WORKTREE_DIFF_READY,
      createRuntimeEvent(
        RUNTIME_EVENTS.WORKTREE_DIFF_READY,
        {
          requestId: id,
          filePath: result.filePath || filePath || null,
          diff: result.diff,
          record: createWorktreeRecord({
            branch,
            baseBranch,
            summary: result.summary,
            previewEntrypoints: [
              {
                type: "worktree-diff",
                branch,
              },
            ],
          }),
        },
        { kind: "server" },
      ),
    );
  } catch (err) {
    server._send(ws, envelopeError(id, "WORKTREE_DIFF_FAILED", err.message));
  }
}

export async function handleWorktreeMerge(server, id, ws, message) {
  try {
    const { mergeWorktree } = await import("../../lib/worktree-isolator.js");
    const { branch, strategy, commitMessage } = message;
    if (!branch) {
      server._send(ws, envelopeError(id, "NO_BRANCH", "branch required"));
      return;
    }
    const result = mergeWorktree(process.cwd(), branch, {
      strategy: strategy || "merge",
      message: commitMessage,
    });
    server._send(
      ws,
      envelopeResponse(CODING_AGENT_EVENT_TYPES.WORKTREE_MERGED, id, {
        ...result,
        record: createWorktreeRecord(
          {
            branch,
            summary: result.summary || null,
            conflicts: result.conflicts || [],
            previewEntrypoints: result.previewEntrypoints || [],
          },
          {
            strategy: strategy || "merge",
            success: result.success,
          },
        ),
      }),
    );
    server.emit(
      RUNTIME_EVENTS.WORKTREE_MERGED,
      createRuntimeEvent(
        RUNTIME_EVENTS.WORKTREE_MERGED,
        {
          requestId: id,
          suggestions: result.suggestions || [],
          record: createWorktreeRecord(
            {
              branch,
              summary: result.summary || null,
              conflicts: result.conflicts || [],
              previewEntrypoints: result.previewEntrypoints || [],
            },
            {
              strategy: strategy || "merge",
              success: result.success,
            },
          ),
        },
        { kind: "server" },
      ),
    );
  } catch (err) {
    server._send(ws, envelopeError(id, "WORKTREE_MERGE_FAILED", err.message));
  }
}

export async function handleWorktreeMergePreview(server, id, ws, message) {
  try {
    const { previewWorktreeMerge } =
      await import("../../lib/worktree-isolator.js");
    const { branch, baseBranch, strategy } = message;
    if (!branch) {
      server._send(ws, envelopeError(id, "NO_BRANCH", "branch required"));
      return;
    }

    const result = previewWorktreeMerge(process.cwd(), branch, {
      baseBranch,
      strategy: strategy || "merge",
    });
    server._send(
      ws,
      envelopeResponse(CODING_AGENT_EVENT_TYPES.WORKTREE_MERGE_PREVIEW, id, {
        ...result,
        record: createWorktreeRecord(
          {
            branch,
            baseBranch: result.baseBranch || baseBranch || null,
            summary: result.summary || null,
            conflicts: result.conflicts || [],
            previewEntrypoints: result.previewEntrypoints || [],
          },
          {
            strategy: strategy || "merge",
            success: result.success,
            previewOnly: true,
          },
        ),
      }),
    );
  } catch (err) {
    server._send(
      ws,
      envelopeError(id, "WORKTREE_MERGE_PREVIEW_FAILED", err.message),
    );
  }
}

export async function handleWorktreeAutomationApply(server, id, ws, message) {
  try {
    const { applyWorktreeAutomationCandidate } =
      await import("../../lib/worktree-isolator.js");
    const { branch, baseBranch, filePath, candidateId, conflictType } = message;
    if (!branch) {
      server._send(ws, envelopeError(id, "NO_BRANCH", "branch required"));
      return;
    }
    if (!filePath || !candidateId) {
      server._send(
        ws,
        envelopeError(
          id,
          "INVALID_WORKTREE_AUTOMATION",
          "filePath and candidateId are required",
        ),
      );
      return;
    }

    const result = applyWorktreeAutomationCandidate(process.cwd(), branch, {
      baseBranch,
      filePath,
      candidateId,
      conflictType,
    });

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.WORKTREE_AUTOMATION_APPLIED,
        id,
        {
          ...result,
          record: createWorktreeRecord(
            {
              branch,
              baseBranch: result.baseBranch || baseBranch || null,
              hasChanges: (result.summary?.filesChanged || 0) > 0,
              summary: result.summary || null,
              conflicts: [],
              previewEntrypoints:
                result.filePath && (result.summary?.filesChanged || 0) > 0
                  ? [
                      {
                        type: "worktree-diff",
                        branch,
                        filePath: result.filePath,
                      },
                    ]
                  : [],
            },
            {
              candidateId,
              filePath,
              conflictType: conflictType || null,
              success: true,
            },
          ),
        },
      ),
    );
  } catch (err) {
    server._send(
      ws,
      envelopeError(id, "WORKTREE_AUTOMATION_FAILED", err.message),
    );
  }
}

export async function handleWorktreeList(server, id, ws) {
  try {
    const { listWorktrees } = await import("../../lib/worktree-isolator.js");
    const worktrees = listWorktrees(process.cwd()).filter(
      (wt) => wt.branch && wt.branch.startsWith("agent/"),
    );
    server._send(
      ws,
      envelopeResponse(CODING_AGENT_EVENT_TYPES.WORKTREE_LIST, id, {
        worktrees,
      }),
    );
  } catch (err) {
    server._send(ws, envelopeError(id, "WORKTREE_LIST_FAILED", err.message));
  }
}

export async function handleCompressionStats(server, id, ws, message) {
  try {
    const { getCompressionTelemetrySummary } =
      await import("../../lib/compression-telemetry.js");
    const summary = getCompressionTelemetrySummary({
      limit: message.limit,
      windowMs: message.windowMs,
      provider: message.provider,
      model: message.model,
    });
    server._send(ws, { id, type: "compression-stats", summary });
    server.emit(
      RUNTIME_EVENTS.COMPRESSION_SUMMARY,
      createRuntimeEvent(
        RUNTIME_EVENTS.COMPRESSION_SUMMARY,
        {
          requestId: id,
          summary,
          filters: {
            limit: message.limit ?? null,
            windowMs: message.windowMs ?? null,
            provider: message.provider ?? null,
            model: message.model ?? null,
          },
        },
        { kind: "server" },
      ),
    );
  } catch (err) {
    server._send(ws, {
      id,
      type: "error",
      code: "COMPRESSION_STATS_FAILED",
      message: err.message,
    });
  }
}

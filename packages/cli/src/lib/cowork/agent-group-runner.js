/**
 * agent-group-runner — thin orchestration helper that wraps any N-peer cowork
 * flow (debate reviewers, A/B variants, analyzers) with session-core's
 * AgentGroup + SharedTaskList.
 *
 * Managed Agents parity Phase G item #1: cowork debate/compare/analyze must
 * stop hand-writing team/subagent semantics. All three flows now share this
 * runner, which makes team(peer) vs coordinator(parent) explicit and gives us
 * a unified task list snapshot for audit/UI.
 *
 * Semantics:
 *   - peers[]     → added to the AgentGroup as RELATIONSHIPS.PEER members
 *   - coordinator → optional parent (moderator / judge), stored as
 *                   `parentAgentId` so peer↔coordinator messages are visible
 *                   per AgentGroup's rules
 *   - Each peer gets a task in the SharedTaskList: `claim → run → complete`
 *     (or `blocked` on error). Errors are captured per peer and do NOT abort
 *     the group — matches pre-existing debate/compare behavior.
 */

import {
  AgentGroup,
  SharedTaskList,
  RELATIONSHIPS,
  TASK_STATUS,
} from "@chainlesschain/session-core";

/**
 * Run N peer members in parallel (default) or serial, each claiming a
 * SharedTaskList entry.
 *
 * @param {object} params
 * @param {Array<{agentId, sessionId?, role?, taskTitle, taskDescription?, payload?}>} params.peers
 * @param {{agentId, sessionId?, role?}} [params.coordinator]
 *        Optional moderator/judge — recorded on the group as parentAgentId.
 * @param {(peer, task, ctx) => Promise<any>} params.runPeer
 *        Called once per peer after its task is claimed. Return value is
 *        captured into `results[]`. Throwing marks the task `BLOCKED`.
 * @param {object} [params.metadata]         Stored on the AgentGroup.
 * @param {"parallel"|"serial"} [params.mode="parallel"]
 *
 * @returns {Promise<{
 *   groupId: string,
 *   parentAgentId: string|null,
 *   members: Array<object>,
 *   tasks: Array<object>,
 *   results: Array<{peer, ok, value?, error?}>,
 *   taskList: SharedTaskList,
 *   group: AgentGroup,
 * }>}
 */
export async function runPeerGroup({
  peers,
  coordinator = null,
  runPeer,
  metadata = {},
  mode = "parallel",
} = {}) {
  if (!Array.isArray(peers) || peers.length === 0) {
    throw new Error("runPeerGroup: peers[] required");
  }
  if (typeof runPeer !== "function") {
    throw new Error("runPeerGroup: runPeer function required");
  }

  const taskList = new SharedTaskList();
  const group = new AgentGroup({
    parentAgentId: coordinator?.agentId || null,
    sharedTaskList: taskList,
    metadata,
  });
  taskList.groupId = group.groupId;

  // Register peers + create one task per peer (keyed by agentId).
  const taskByAgent = new Map();
  for (const peer of peers) {
    group.addMember({
      agentId: peer.agentId,
      sessionId: peer.sessionId || `sess_${peer.agentId}`,
      relationship: RELATIONSHIPS.PEER,
      role: peer.role || null,
    });
    const task = taskList.add({
      title: peer.taskTitle || `${peer.agentId} task`,
      description: peer.taskDescription || "",
      assignee: peer.agentId,
      createdBy: coordinator?.agentId || peer.agentId,
    });
    taskByAgent.set(peer.agentId, task);
  }

  const runOne = async (peer) => {
    const task = taskByAgent.get(peer.agentId);
    let claimed;
    try {
      claimed = taskList.claim(task.id, { agentId: peer.agentId });
    } catch (err) {
      return { peer, ok: false, error: err };
    }
    try {
      const value = await runPeer(peer, claimed || task, {
        group,
        taskList,
        coordinator,
      });
      taskList.complete(claimed.id, { actor: peer.agentId });
      return { peer, ok: true, value };
    } catch (err) {
      // Mark task blocked so the group snapshot reflects failure mode.
      const current = taskList.get(claimed.id);
      try {
        taskList.update(claimed.id, {
          rev: current.rev,
          patch: { status: TASK_STATUS.BLOCKED },
          actor: peer.agentId,
        });
      } catch (_e) {
        /* swallow — best effort */
      }
      return { peer, ok: false, error: err };
    }
  };

  let results;
  if (mode === "serial") {
    results = [];
    for (const peer of peers) {
      results.push(await runOne(peer));
    }
  } else {
    results = await Promise.all(peers.map(runOne));
  }

  return {
    groupId: group.groupId,
    parentAgentId: group.parentAgentId,
    members: group.listMembers(),
    tasks: taskList.list(),
    results,
    taskList,
    group,
  };
}

export { AgentGroup, SharedTaskList, RELATIONSHIPS, TASK_STATUS };

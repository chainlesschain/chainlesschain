/**
 * AgentGroup — 多 Agent 协作容器
 *
 * Phase C of Managed Agents parity plan.
 *
 * 对标 Managed Agents 的两种关系语义:
 *   peer  — Team 成员,平级,互相可见消息,共享 task list
 *   child — Subagent,层级,结果仅回父 agent
 *
 * 一个 AgentGroup 代表一次协作任务的参与者集合,包含:
 *   - groupId
 *   - parentAgentId (可空,仅 child 关系下有意义)
 *   - members: Map<agentId, { sessionId, relationship, role? }>
 *   - 可选绑定 SharedTaskList(对 peer team)
 *   - 可选绑定 message bus(方向受 relationship 限制)
 */

const crypto = require("crypto");

const RELATIONSHIPS = Object.freeze({
  PEER: "peer",
  CHILD: "child",
});

function generateGroupId() {
  return `grp_${crypto.randomBytes(8).toString("hex")}`;
}

function validateRelationship(rel) {
  if (rel !== RELATIONSHIPS.PEER && rel !== RELATIONSHIPS.CHILD) {
    throw new Error(
      `AgentGroup: invalid relationship "${rel}", must be "peer" or "child"`
    );
  }
}

class AgentGroup {
  constructor({
    groupId,
    parentAgentId = null,
    sharedTaskList = null,
    metadata = {},
  } = {}) {
    this.groupId = groupId || generateGroupId();
    this.parentAgentId = parentAgentId;
    this.sharedTaskList = sharedTaskList;
    this.metadata = { ...metadata };
    this._members = new Map(); // agentId → member record
    this.createdAt = Date.now();
  }

  /**
   * 加入 agent
   */
  addMember({ agentId, sessionId, relationship, role = null }) {
    if (!agentId) throw new Error("addMember: agentId required");
    if (!sessionId) throw new Error("addMember: sessionId required");
    validateRelationship(relationship);

    if (relationship === RELATIONSHIPS.CHILD && !this.parentAgentId) {
      throw new Error(
        "addMember: child relationship requires parentAgentId on group"
      );
    }
    if (relationship === RELATIONSHIPS.CHILD && agentId === this.parentAgentId) {
      throw new Error("addMember: parent agent cannot also be its own child");
    }
    if (this._members.has(agentId)) {
      throw new Error(`addMember: agentId ${agentId} already in group`);
    }

    const record = Object.freeze({
      agentId,
      sessionId,
      relationship,
      role,
      joinedAt: Date.now(),
    });
    this._members.set(agentId, record);
    return record;
  }

  removeMember(agentId) {
    return this._members.delete(agentId);
  }

  getMember(agentId) {
    return this._members.get(agentId) || null;
  }

  hasMember(agentId) {
    return this._members.has(agentId);
  }

  listMembers({ relationship } = {}) {
    const all = Array.from(this._members.values());
    return relationship ? all.filter((m) => m.relationship === relationship) : all;
  }

  listPeers() {
    return this.listMembers({ relationship: RELATIONSHIPS.PEER });
  }

  listChildren() {
    return this.listMembers({ relationship: RELATIONSHIPS.CHILD });
  }

  size() {
    return this._members.size;
  }

  /**
   * 消息可见性规则:
   *   peer → peer:     可见(team 广播)
   *   child → parent:  可见(下属汇报)
   *   parent → child:  可见(下派指令)
   *   child → child:   不可见(除非显式)
   *   peer → child:    不可见
   *   child → peer:    不可见
   */
  canSeeMessage({ fromAgentId, toAgentId }) {
    if (fromAgentId === toAgentId) return true;
    const from = this._members.get(fromAgentId);
    const to = this._members.get(toAgentId);

    // parent (not a member, but groupId.parentAgentId) interactions
    const fromIsParent = fromAgentId === this.parentAgentId;
    const toIsParent = toAgentId === this.parentAgentId;

    // child ↔ parent
    if (fromIsParent && to?.relationship === RELATIONSHIPS.CHILD) return true;
    if (toIsParent && from?.relationship === RELATIONSHIPS.CHILD) return true;

    // peer ↔ peer
    if (
      from?.relationship === RELATIONSHIPS.PEER &&
      to?.relationship === RELATIONSHIPS.PEER
    ) {
      return true;
    }

    return false;
  }

  /**
   * 关闭 group(清空成员,解除 task list 绑定)
   */
  close() {
    this._members.clear();
    this.sharedTaskList = null;
  }

  toJSON() {
    return {
      groupId: this.groupId,
      parentAgentId: this.parentAgentId,
      createdAt: this.createdAt,
      metadata: this.metadata,
      members: Array.from(this._members.values()),
    };
  }
}

module.exports = {
  AgentGroup,
  RELATIONSHIPS,
  generateGroupId,
  validateRelationship,
};

/**
 * TeammateTool 单元测试
 */

const { TeammateTool, TeamStatus, AgentStatus } = require('../teammate-tool');

describe('TeammateTool', () => {
  let teammateTool;

  beforeEach(() => {
    teammateTool = new TeammateTool({
      dataDir: require('os').tmpdir() + '/cowork-test',
    });
  });

  afterEach(() => {
    // 清理
    teammateTool.teams.clear();
    teammateTool.agents.clear();
    teammateTool.messageQueues.clear();
  });

  // ==========================================
  // spawnTeam 测试
  // ==========================================

  describe('spawnTeam', () => {
    test('应该成功创建团队', async () => {
      const team = await teammateTool.spawnTeam('test-team', {
        maxAgents: 5,
        allowDynamicJoin: true,
      });

      expect(team).toBeDefined();
      expect(team.id).toBeTruthy();
      expect(team.name).toBe('test-team');
      expect(team.status).toBe(TeamStatus.ACTIVE);
      expect(team.maxAgents).toBe(5);
      expect(team.agents).toEqual([]);
      expect(team.tasks).toEqual([]);
    });

    test('应该限制最大团队数', async () => {
      const tool = new TeammateTool({ maxTeams: 2 });

      await tool.spawnTeam('team-1');
      await tool.spawnTeam('team-2');

      await expect(tool.spawnTeam('team-3')).rejects.toThrow('已达到最大团队数限制');
    });

    test('应该生成唯一的团队ID', async () => {
      const team1 = await teammateTool.spawnTeam('team-1');
      const team2 = await teammateTool.spawnTeam('team-2');

      expect(team1.id).not.toBe(team2.id);
    });
  });

  // ==========================================
  // discoverTeams 测试
  // ==========================================

  describe('discoverTeams', () => {
    beforeEach(async () => {
      await teammateTool.spawnTeam('team-active', { status: TeamStatus.ACTIVE });
      await teammateTool.spawnTeam('team-paused', { status: TeamStatus.PAUSED });
      await teammateTool.spawnTeam('team-dynamic', { allowDynamicJoin: true });
    });

    test('应该返回所有团队', async () => {
      const teams = await teammateTool.discoverTeams();
      expect(teams.length).toBe(3);
    });

    test('应该按状态过滤', async () => {
      const teams = await teammateTool.discoverTeams({ status: TeamStatus.ACTIVE });
      expect(teams.length).toBeGreaterThanOrEqual(2);
      teams.forEach(t => {
        if (t.name.includes('active') || t.name.includes('dynamic')) {
          expect(t.status).toBe(TeamStatus.ACTIVE);
        }
      });
    });

    test('应该按 allowDynamicJoin 过滤', async () => {
      const teams = await teammateTool.discoverTeams({ allowDynamicJoin: true });
      expect(teams.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // requestJoin 测试
  // ==========================================

  describe('requestJoin', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team', {
        maxAgents: 3,
        allowDynamicJoin: true,
      });
    });

    test('应该成功加入团队', async () => {
      const result = await teammateTool.requestJoin(team.id, 'agent-1', {
        name: 'Test Agent',
        capabilities: ['task_execution'],
      });

      expect(result.success).toBe(true);
      expect(result.agent.id).toBe('agent-1');
      expect(result.agent.teamId).toBe(team.id);
      expect(result.agent.status).toBe(AgentStatus.IDLE);

      const updatedTeam = teammateTool.teams.get(team.id);
      expect(updatedTeam.agents.length).toBe(1);
    });

    test('应该拒绝不允许动态加入的团队', async () => {
      const restrictedTeam = await teammateTool.spawnTeam('restricted-team', {
        allowDynamicJoin: false,
      });

      await expect(
        teammateTool.requestJoin(restrictedTeam.id, 'agent-1', {})
      ).rejects.toThrow('不允许动态加入');
    });

    test('应该拒绝重复加入', async () => {
      await teammateTool.requestJoin(team.id, 'agent-1', {});

      await expect(
        teammateTool.requestJoin(team.id, 'agent-1', {})
      ).rejects.toThrow('已在团队中');
    });

    test('应该限制最大代理数', async () => {
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      await teammateTool.requestJoin(team.id, 'agent-2', {});
      await teammateTool.requestJoin(team.id, 'agent-3', {});

      await expect(
        teammateTool.requestJoin(team.id, 'agent-4', {})
      ).rejects.toThrow('团队已满');
    });
  });

  // ==========================================
  // assignTask 测试
  // ==========================================

  describe('assignTask', () => {
    let team;
    let agentId;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team', { maxAgents: 3 });
      await teammateTool.requestJoin(team.id, 'agent-1', {
        name: 'Worker Agent',
        capabilities: ['data_processing'],
      });
      agentId = 'agent-1';
    });

    test('应该成功分配任务', async () => {
      const result = await teammateTool.assignTask(team.id, agentId, {
        description: '测试任务',
        type: 'data_processing',
        priority: 1,
      });

      expect(result.success).toBe(true);
      expect(result.taskId).toBeTruthy();
      expect(result.agentId).toBe(agentId);

      const agent = teammateTool.agents.get(agentId);
      expect(agent.status).toBe(AgentStatus.BUSY);
      expect(agent.assignedTask).toBe(result.taskId);

      const updatedTeam = teammateTool.teams.get(team.id);
      expect(updatedTeam.tasks.length).toBe(1);
    });

    test('应该自动选择空闲代理', async () => {
      await teammateTool.requestJoin(team.id, 'agent-2', {});

      const result = await teammateTool.assignTask(team.id, null, {
        description: '自动分配任务',
      });

      expect(result.success).toBe(true);
      expect(result.agentId).toBeTruthy();
    });

    test('应该拒绝不存在的团队', async () => {
      await expect(
        teammateTool.assignTask('invalid-team', agentId, {})
      ).rejects.toThrow('团队不存在');
    });

    test('应该拒绝不存在的代理', async () => {
      await expect(
        teammateTool.assignTask(team.id, 'invalid-agent', {})
      ).rejects.toThrow('代理不存在');
    });
  });

  // ==========================================
  // broadcastMessage 测试
  // ==========================================

  describe('broadcastMessage', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team');
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      await teammateTool.requestJoin(team.id, 'agent-2', {});
    });

    test('应该成功广播消息', async () => {
      const result = await teammateTool.broadcastMessage(team.id, 'agent-1', {
        content: 'Hello team!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
      expect(result.recipientCount).toBe(1); // 排除发送者

      const messages = teammateTool.messageQueues.get(team.id);
      expect(messages.length).toBe(1);
      expect(messages[0].from).toBe('agent-1');
      expect(messages[0].to).toBeNull(); // null 表示广播
    });
  });

  // ==========================================
  // sendMessage 测试
  // ==========================================

  describe('sendMessage', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team');
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      await teammateTool.requestJoin(team.id, 'agent-2', {});
    });

    test('应该成功发送点对点消息', async () => {
      const result = await teammateTool.sendMessage('agent-1', 'agent-2', {
        content: 'Hello agent-2!',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();

      const messages = teammateTool.messageQueues.get(team.id);
      expect(messages.length).toBe(1);
      expect(messages[0].from).toBe('agent-1');
      expect(messages[0].to).toBe('agent-2');
    });

    test('应该拒绝不在同一团队的代理通信', async () => {
      const team2 = await teammateTool.spawnTeam('team-2');
      await teammateTool.requestJoin(team2.id, 'agent-3', {});

      await expect(
        teammateTool.sendMessage('agent-1', 'agent-3', {})
      ).rejects.toThrow('不在同一团队');
    });
  });

  // ==========================================
  // voteOnDecision 测试
  // ==========================================

  describe('voteOnDecision', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team', {
        votingThreshold: 0.6,
      });
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      await teammateTool.requestJoin(team.id, 'agent-2', {});
      await teammateTool.requestJoin(team.id, 'agent-3', {});
    });

    test('应该通过投票（达到阈值）', async () => {
      const votes = [
        { agentId: 'agent-1', vote: 'approve' },
        { agentId: 'agent-2', vote: 'approve' },
        { agentId: 'agent-3', vote: 'reject' },
      ];

      const result = await teammateTool.voteOnDecision(
        team.id,
        { id: 'decision-1', description: '测试决策' },
        votes
      );

      expect(result.passed).toBe(true);
      expect(result.approvalRate).toBeGreaterThanOrEqual(0.6);
      expect(result.votes.approve).toBe(2);
      expect(result.votes.reject).toBe(1);
    });

    test('应该拒绝投票（未达到阈值）', async () => {
      const votes = [
        { agentId: 'agent-1', vote: 'approve' },
        { agentId: 'agent-2', vote: 'reject' },
        { agentId: 'agent-3', vote: 'reject' },
      ];

      const result = await teammateTool.voteOnDecision(
        team.id,
        { id: 'decision-2', description: '测试决策' },
        votes
      );

      expect(result.passed).toBe(false);
      expect(result.approvalRate).toBeLessThan(0.6);
    });
  });

  // ==========================================
  // getTeamStatus 测试
  // ==========================================

  describe('getTeamStatus', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team');
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      await teammateTool.assignTask(team.id, 'agent-1', {
        description: '任务1',
      });
    });

    test('应该返回详细的团队状态', async () => {
      const status = await teammateTool.getTeamStatus(team.id);

      expect(status.id).toBe(team.id);
      expect(status.name).toBe('test-team');
      expect(status.agents.length).toBe(1);
      expect(status.tasks.length).toBe(1);
      expect(status.agentStats).toBeDefined();
      expect(status.taskStats).toBeDefined();
      expect(status.agentStats.total).toBe(1);
      expect(status.taskStats.total).toBe(1);
    });
  });

  // ==========================================
  // terminateAgent 测试
  // ==========================================

  describe('terminateAgent', () => {
    let team;
    let agentId;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team');
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      agentId = 'agent-1';
    });

    test('应该成功终止代理', async () => {
      const result = await teammateTool.terminateAgent(agentId, '测试终止');

      expect(result.success).toBe(true);

      const agent = teammateTool.agents.get(agentId);
      expect(agent.status).toBe(AgentStatus.TERMINATED);
      expect(agent.metadata.terminationReason).toBe('测试终止');
    });

    test('应该标记未完成的任务为失败', async () => {
      const taskResult = await teammateTool.assignTask(team.id, agentId, {
        description: '测试任务',
      });

      await teammateTool.terminateAgent(agentId, '代理崩溃');

      const updatedTeam = teammateTool.teams.get(team.id);
      const task = updatedTeam.tasks.find(t => t.id === taskResult.taskId);
      expect(task.status).toBe('failed');
    });
  });

  // ==========================================
  // mergeResults 测试
  // ==========================================

  describe('mergeResults', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team');
    });

    test('应该使用 aggregate 策略合并结果', async () => {
      const results = [{ value: 1 }, { value: 2 }, { value: 3 }];

      const merged = await teammateTool.mergeResults(team.id, results, {
        type: 'aggregate',
      });

      expect(merged.type).toBe('aggregate');
      expect(merged.results).toEqual(results);
      expect(merged.count).toBe(3);
    });

    test('应该使用 vote 策略选择最佳结果', async () => {
      const results = [
        { answer: 'A' },
        { answer: 'A' },
        { answer: 'B' },
      ];

      const merged = await teammateTool.mergeResults(team.id, results, {
        type: 'vote',
      });

      expect(merged.type).toBe('vote');
      expect(merged.result.answer).toBe('A');
      expect(merged.votes).toBe(2);
    });

    test('应该使用 average 策略计算平均值', async () => {
      const results = [10, 20, 30];

      const merged = await teammateTool.mergeResults(team.id, results, {
        type: 'average',
      });

      expect(merged.type).toBe('average');
      expect(merged.result).toBe(20);
    });

    test('应该使用 concatenate 策略连接结果', async () => {
      const results = [
        { result: 'Part 1' },
        { result: 'Part 2' },
        { result: 'Part 3' },
      ];

      const merged = await teammateTool.mergeResults(team.id, results, {
        type: 'concatenate',
      });

      expect(merged.type).toBe('concatenate');
      expect(merged.result).toContain('Part 1');
      expect(merged.result).toContain('Part 2');
      expect(merged.result).toContain('Part 3');
    });
  });

  // ==========================================
  // createCheckpoint & listMembers & updateTeamConfig 测试
  // ==========================================

  describe('其他操作', () => {
    let team;

    beforeEach(async () => {
      team = await teammateTool.spawnTeam('test-team');
      await teammateTool.requestJoin(team.id, 'agent-1', {});
    });

    test('createCheckpoint 应该创建检查点', async () => {
      const checkpoint = await teammateTool.createCheckpoint(team.id, {
        reason: 'manual',
      });

      expect(checkpoint.id).toBeTruthy();
      expect(checkpoint.teamId).toBe(team.id);

      const updatedTeam = teammateTool.teams.get(team.id);
      expect(updatedTeam.checkpoints.length).toBe(1);
    });

    test('listMembers 应该列出所有成员', async () => {
      await teammateTool.requestJoin(team.id, 'agent-2', {});

      const members = await teammateTool.listMembers(team.id);

      expect(members.length).toBe(2);
      expect(members[0].id).toBeTruthy();
      expect(members[0].name).toBeTruthy();
    });

    test('updateTeamConfig 应该更新配置', async () => {
      const result = await teammateTool.updateTeamConfig(team.id, {
        votingThreshold: 0.75,
        maxAgents: 10,
      });

      expect(result.success).toBe(true);

      const updatedTeam = teammateTool.teams.get(team.id);
      expect(updatedTeam.config.votingThreshold).toBe(0.75);
      expect(updatedTeam.config.maxAgents).toBe(10);
    });
  });

  // ==========================================
  // getStats 测试
  // ==========================================

  describe('getStats', () => {
    test('应该返回统计信息', async () => {
      await teammateTool.spawnTeam('team-1');
      await teammateTool.spawnTeam('team-2');

      const stats = teammateTool.getStats();

      expect(stats.totalTeams).toBe(2);
      expect(stats.activeTeams).toBeGreaterThanOrEqual(0);
      expect(stats.totalAgents).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================
  // destroyTeam 测试
  // ==========================================

  describe('destroyTeam', () => {
    test('应该销毁团队并终止所有代理', async () => {
      const team = await teammateTool.spawnTeam('test-team');
      await teammateTool.requestJoin(team.id, 'agent-1', {});
      await teammateTool.requestJoin(team.id, 'agent-2', {});

      const result = await teammateTool.destroyTeam(team.id);

      expect(result.success).toBe(true);
      expect(teammateTool.teams.has(team.id)).toBe(false);
      expect(teammateTool.agents.has('agent-1')).toBe(false);
      expect(teammateTool.agents.has('agent-2')).toBe(false);
    });
  });
});

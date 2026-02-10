/**
 * Agent Pool Unit Tests
 *
 * 测试代理池的核心功能
 */

const {
  AgentPool,
  AgentStatus,
} = require("../../src/main/ai-engine/cowork/agent-pool.js");
const assert = require("assert");

describe("AgentPool", () => {
  let pool;

  afterEach(async () => {
    if (pool) {
      await pool.clear();
      pool = null;
    }
  });

  describe("初始化", () => {
    it("应该创建代理池并预热", async () => {
      pool = new AgentPool({
        minSize: 3,
        maxSize: 10,
        warmupOnInit: true,
      });

      await pool.initialize();

      const status = pool.getStatus();
      assert.strictEqual(status.available, 3, "预热后应有3个可用代理");
      assert.strictEqual(status.busy, 0, "初始时应无忙碌代理");
      assert.strictEqual(pool.initialized, true, "初始化标志应为true");
    });

    it("应该支持禁用预热", async () => {
      pool = new AgentPool({
        minSize: 3,
        maxSize: 10,
        warmupOnInit: false,
      });

      await pool.initialize();

      const status = pool.getStatus();
      assert.strictEqual(status.available, 0, "禁用预热时应无可用代理");
      assert.strictEqual(pool.initialized, true, "初始化标志应为true");
    });
  });

  describe("获取代理", () => {
    beforeEach(async () => {
      pool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: true,
      });
      await pool.initialize();
    });

    it("应该从可用池中获取代理", async () => {
      const agent = await pool.acquireAgent({ role: "worker" });

      assert.ok(agent, "应该返回代理对象");
      assert.strictEqual(agent.status, AgentStatus.BUSY, "代理状态应为BUSY");
      assert.strictEqual(agent.role, "worker", "角色应为worker");

      const status = pool.getStatus();
      assert.strictEqual(status.available, 1, "可用代理应减少1个");
      assert.strictEqual(status.busy, 1, "忙碌代理应增加1个");
    });

    it("应该创建新代理（当池未满）", async () => {
      // 获取所有预热的代理
      await pool.acquireAgent();
      await pool.acquireAgent();

      // 此时池为空，应创建新代理
      const agent = await pool.acquireAgent({ role: "worker" });

      assert.ok(agent, "应该返回新创建的代理");
      const status = pool.getStatus();
      assert.strictEqual(status.total, 3, "总代理数应为3");
    });

    it("应该等待可用代理（当池满）", async () => {
      // 获取所有5个代理（maxSize=5）
      const agents = [];
      for (let i = 0; i < 5; i++) {
        agents.push(await pool.acquireAgent());
      }

      // 尝试获取第6个代理（应等待）
      const acquirePromise = pool.acquireAgent({}, 1000); // 1秒超时

      // 500ms后释放一个代理
      setTimeout(() => {
        pool.releaseAgent(agents[0].id);
      }, 500);

      const agent = await acquirePromise;
      assert.ok(agent, "应该在释放后获取到代理");
    });

    it("应该在等待超时后抛出错误", async () => {
      // 获取所有5个代理
      for (let i = 0; i < 5; i++) {
        await pool.acquireAgent();
      }

      // 尝试获取第6个代理（应超时）
      try {
        await pool.acquireAgent({}, 500); // 500ms超时
        assert.fail("应该抛出超时错误");
      } catch (error) {
        assert.ok(error.message.includes("超时"), '错误消息应包含"超时"');
      }
    });
  });

  describe("释放代理", () => {
    beforeEach(async () => {
      pool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: true,
      });
      await pool.initialize();
    });

    it("应该将代理放回可用池", async () => {
      const agent = await pool.acquireAgent();
      const agentId = agent.id;

      pool.releaseAgent(agentId);

      const status = pool.getStatus();
      assert.strictEqual(status.available, 2, "可用代理应恢复到2个");
      assert.strictEqual(status.busy, 0, "忙碌代理应为0");
    });

    it("应该优先分配给等待者", async () => {
      // 获取所有代理
      const agents = [];
      for (let i = 0; i < 5; i++) {
        agents.push(await pool.acquireAgent());
      }

      // 创建等待者
      const waitPromise = pool.acquireAgent({}, 2000);

      // 释放一个代理（应立即分配给等待者）
      pool.releaseAgent(agents[0].id);

      const agent = await waitPromise;
      assert.ok(agent, "等待者应获取到代理");

      const status = pool.getStatus();
      assert.strictEqual(status.busy, 5, "忙碌代理应保持5个（分配给等待者）");
    });

    it("应该销毁多余代理", async () => {
      // 创建3个额外代理（超过minSize）
      const agents = [];
      for (let i = 0; i < 3; i++) {
        agents.push(await pool.acquireAgent());
      }

      const stats1 = pool.getStats();
      const created = stats1.created;

      // 释放代理（应触发销毁）
      for (const agent of agents) {
        pool.releaseAgent(agent.id);
      }

      const status = pool.getStatus();
      const stats2 = pool.getStats();

      assert.strictEqual(status.available, 2, "应保持minSize=2个代理");
      assert.ok(stats2.destroyed > 0, "应有代理被销毁");
    });
  });

  describe("状态隔离", () => {
    beforeEach(async () => {
      pool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: true,
      });
      await pool.initialize();
    });

    it("应该重置代理状态", async () => {
      // 第一次获取
      const agent1 = await pool.acquireAgent({
        role: "worker",
        capabilities: ["task1"],
      });
      const initialReuseCount = agent1.reuseCount;
      agent1.metadata.customData = "test";
      agent1.taskQueue = ["task1", "task2"];

      pool.releaseAgent(agent1.id);

      // 第二次获取（应该是重置后的状态）
      const agent2 = await pool.acquireAgent({
        role: "leader",
        capabilities: ["task2"],
      });

      assert.strictEqual(agent2.id, agent1.id, "应该是同一个代理对象");
      assert.strictEqual(agent2.role, "leader", "角色应被重置为新值");
      assert.deepStrictEqual(agent2.capabilities, ["task2"], "能力应被重置");
      assert.strictEqual(agent2.taskQueue.length, 0, "任务队列应被清空");
      assert.deepStrictEqual(agent2.metadata, {}, "元数据应被清空");
      assert.strictEqual(
        agent2.reuseCount,
        initialReuseCount + 1,
        "复用次数应增加",
      );
    });
  });

  describe("空闲超时", () => {
    it("应该自动销毁空闲代理", async () => {
      pool = new AgentPool({
        minSize: 1,
        maxSize: 5,
        idleTimeout: 500, // 500ms空闲超时
        warmupOnInit: true,
      });
      await pool.initialize();

      // 初始化后有1个可用代理
      const status0 = pool.getStatus();
      assert.strictEqual(status0.available, 1, "初始化后应有1个可用代理");

      // 获取代理
      const agent = await pool.acquireAgent();
      assert.strictEqual(pool.getStatus().available, 0, "获取后应有0个可用代理");

      // 释放代理
      pool.releaseAgent(agent.id);
      const status1 = pool.getStatus();
      assert.strictEqual(status1.available, 1, "释放后应有1个可用代理");

      // 等待超时 - 空闲定时器会销毁空闲代理（不考虑minSize）
      await new Promise((resolve) => setTimeout(resolve, 600));

      const status2 = pool.getStatus();
      // 空闲超时后代理被销毁
      assert.strictEqual(status2.available, 0, "超时后空闲代理被销毁");
    });
  });

  describe("统计信息", () => {
    beforeEach(async () => {
      pool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: true,
      });
      await pool.initialize();
    });

    it("应该跟踪统计信息", async () => {
      const agent1 = await pool.acquireAgent();
      const agent2 = await pool.acquireAgent();

      pool.releaseAgent(agent1.id);
      pool.releaseAgent(agent2.id);

      const agent3 = await pool.acquireAgent(); // 复用
      pool.releaseAgent(agent3.id);

      const stats = pool.getStats();

      assert.ok(stats.created >= 2, "应至少创建2个代理");
      assert.strictEqual(stats.acquisitions, 3, "应有3次获取请求");
      assert.strictEqual(stats.releases, 3, "应有3次释放");
      assert.ok(stats.reused > 0, "应有复用次数");
      assert.ok(parseFloat(stats.reuseRate) > 0, "复用率应大于0");
    });
  });

  describe("清空代理池", () => {
    beforeEach(async () => {
      pool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: true,
      });
      await pool.initialize();
    });

    it("应该清空所有代理和资源", async () => {
      const agent = await pool.acquireAgent();

      await pool.clear();

      const status = pool.getStatus();
      assert.strictEqual(status.available, 0, "可用代理应为0");
      assert.strictEqual(status.busy, 0, "忙碌代理应为0");
      assert.strictEqual(pool.initialized, false, "初始化标志应为false");
    });

    it("应该拒绝所有等待请求", async () => {
      // 获取所有代理
      for (let i = 0; i < 5; i++) {
        await pool.acquireAgent();
      }

      // 创建等待请求
      const waitPromise = pool.acquireAgent({}, 5000);

      // 清空池
      await pool.clear();

      // 等待请求应被拒绝
      try {
        await waitPromise;
        assert.fail("应该抛出错误");
      } catch (error) {
        assert.ok(error.message.includes("已清空"), '错误消息应包含"已清空"');
      }
    });
  });

  describe("事件发射", () => {
    beforeEach(async () => {
      pool = new AgentPool({
        minSize: 2,
        maxSize: 5,
        warmupOnInit: false, // 禁用预热以测试事件
      });
    });

    it("应该发射agent-created事件", async () => {
      let eventFired = false;

      pool.on("agent-created", ({ agentId }) => {
        assert.ok(agentId, "事件应包含agentId");
        eventFired = true;
      });

      await pool.initialize();
      await pool.acquireAgent(); // 触发创建

      assert.ok(eventFired, "应该发射agent-created事件");
    });

    it("应该发射agent-acquired事件", async () => {
      let eventFired = false;

      pool.on("agent-acquired", ({ agentId, reused }) => {
        assert.ok(agentId, "事件应包含agentId");
        assert.strictEqual(typeof reused, "boolean", "事件应包含reused标志");
        eventFired = true;
      });

      await pool.initialize();
      await pool.acquireAgent();

      assert.ok(eventFired, "应该发射agent-acquired事件");
    });

    it("应该发射agent-released事件", async () => {
      let eventFired = false;

      pool.on("agent-released", ({ agentId }) => {
        assert.ok(agentId, "事件应包含agentId");
        eventFired = true;
      });

      await pool.initialize();
      const agent = await pool.acquireAgent();
      pool.releaseAgent(agent.id);

      assert.ok(eventFired, "应该发射agent-released事件");
    });
  });
});

// 运行测试（如果直接执行）
if (require.main === module) {
  console.log("请使用测试框架运行此测试文件 (如 npm test)");
}

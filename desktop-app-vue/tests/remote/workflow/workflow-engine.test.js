/**
 * WorkflowEngine 单元测试 — 对接真实实现
 *
 * 之前本文件用内联 mock 的 WorkflowEngine/ExecutionContext（stub-tests-stub，
 * describe.skip + "TODO align API"），对生产代码零保证。现已重写为直接 require
 * 真实 `src/main/remote/workflow/workflow-engine.js`，覆盖其真实 API：
 *   - execute(workflow, initialVariables) → {success, workflowId, status, results[], duration}
 *   - 内置动作 system.* / control.if|forEach|while
 *   - 变量解析 ${var}、step.condition 跳过、未知动作失败、onError、retry、timeout
 *   - registerAction 自定义动作、commandExecutor 命令动作回退
 *   - validateWorkflow、cancelWorkflow（shouldReturn 截断后续步骤）、状态查询
 *
 * CJS + vitest globals（globals:true），与被测 CJS 模块及 replay-attack 邻居一致。
 */

const {
  WorkflowEngine,
  ExecutionContext,
  STEP_STATUS,
  WORKFLOW_STATUS,
} = require("../../../src/main/remote/workflow/workflow-engine");

describe("WorkflowEngine (real implementation)", () => {
  let engine;
  let records; // 自定义动作的外部副作用收集器，便于确定性断言

  beforeEach(() => {
    engine = new WorkflowEngine();
    records = [];
    // 一个把 params.tag（或当前 item）记录下来的确定性动作
    engine.registerAction("test.record", async (params, context) => {
      const tag =
        params.tag !== undefined ? params.tag : context.getVariable("item");
      records.push(tag);
      return { recorded: tag };
    });
  });

  describe("execute — 基础", () => {
    test("执行简单工作流返回成功 + results 数组 + 时长", async () => {
      const workflow = {
        id: "wf-basic",
        name: "basic",
        steps: [
          { action: "system.setVariable", params: { name: "x", value: "1" } },
          { action: "test.record", params: { tag: "a" } },
        ],
      };

      const result = await engine.execute(workflow);

      expect(result.success).toBe(true);
      expect(result.workflowId).toBe("wf-basic");
      expect(result.status).toBe(WORKFLOW_STATUS.COMPLETED);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(
        result.results.every((r) => r.status === STEP_STATUS.COMPLETED),
      ).toBe(true);
      expect(typeof result.duration).toBe("number");
      expect(records).toEqual(["a"]);
    });

    test("空步骤工作流也成功且 results 为空数组", async () => {
      const result = await engine.execute({ name: "empty", steps: [] });
      expect(result.success).toBe(true);
      expect(result.results).toEqual([]);
    });

    test("未提供 id 时自动生成 workflowId", async () => {
      const result = await engine.execute({ steps: [] });
      expect(typeof result.workflowId).toBe("string");
      expect(result.workflowId).toMatch(/^wf-/);
    });
  });

  describe("变量与解析", () => {
    test("setVariable 后续步骤可解析 ${var}", async () => {
      const result = await engine.execute({
        steps: [
          {
            action: "system.setVariable",
            params: { name: "who", value: "World" },
          },
          { action: "system.log", params: { message: "Hi ${who}" } },
        ],
      });
      // system.log 返回 { logged: resolvedMessage }
      expect(result.results[1].result.logged).toBe("Hi World");
    });

    test("execute 的 initialVariables 注入上下文", async () => {
      const result = await engine.execute(
        { steps: [{ action: "system.log", params: { message: "v=${seed}" } }] },
        { seed: 42 },
      );
      expect(result.results[0].result.logged).toBe("v=42");
    });
  });

  describe("控制流 control.*", () => {
    test("control.if 条件为真走 then 分支", async () => {
      await engine.execute({
        steps: [
          {
            action: "control.if",
            params: {
              condition: true,
              then: [{ action: "test.record", params: { tag: "then" } }],
              else: [{ action: "test.record", params: { tag: "else" } }],
            },
          },
        ],
      });
      expect(records).toEqual(["then"]);
    });

    test("control.if 条件为假走 else 分支", async () => {
      await engine.execute({
        steps: [
          {
            action: "control.if",
            params: {
              condition: false,
              then: [{ action: "test.record", params: { tag: "then" } }],
              else: [{ action: "test.record", params: { tag: "else" } }],
            },
          },
        ],
      });
      expect(records).toEqual(["else"]);
    });

    test("control.forEach 遍历数组每项执行步骤", async () => {
      const result = await engine.execute({
        steps: [
          {
            action: "control.forEach",
            params: {
              items: [10, 20, 30],
              steps: [{ action: "test.record" }], // 记录当前 item
            },
          },
        ],
      });
      expect(records).toEqual([10, 20, 30]);
      expect(result.results[0].result.iterations).toBe(3);
    });

    test("control.while 在对象条件为真时循环到上限", async () => {
      const e = new WorkflowEngine();
      e.registerAction("test.tick", async (params, context) => {
        const cur = context.getVariable("i");
        context.setVariable("i", cur + 1);
        return { i: cur + 1 };
      });
      const result = await e.execute(
        {
          steps: [
            {
              action: "control.while",
              params: {
                condition: { variable: "i", operator: "<", value: 3 },
                steps: [{ action: "test.tick" }],
              },
            },
          ],
        },
        { i: 0 },
      );
      expect(result.results[0].result.iterations).toBe(3);
    });

    test("step.condition 为假时步骤被跳过", async () => {
      const result = await engine.execute({
        steps: [
          { action: "test.record", params: { tag: "x" }, condition: false },
        ],
      });
      expect(result.results[0].status).toBe(STEP_STATUS.SKIPPED);
      expect(records).toEqual([]);
    });
  });

  describe("错误处理与韧性", () => {
    test("未知动作 → 工作流失败并标记 failedStep", async () => {
      const result = await engine.execute({
        steps: [{ id: "s1", action: "no.such.action" }],
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe(WORKFLOW_STATUS.FAILED);
      expect(result.error).toMatch(/Unknown action/);
      expect(result.failedStep).toBe("s1");
    });

    test("onError:'continue' → 失败步骤不中断工作流", async () => {
      engine.registerAction("test.boom", async () => {
        throw new Error("boom");
      });
      const result = await engine.execute({
        steps: [
          { action: "test.boom", onError: "continue" },
          { action: "test.record", params: { tag: "after" } },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.results[0].status).toBe(STEP_STATUS.FAILED);
      expect(records).toEqual(["after"]); // 后续步骤仍执行
    });

    test("retry 使瞬时失败的步骤最终成功", async () => {
      let attempts = 0;
      engine.registerAction("test.flaky", async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("transient");
        }
        return { ok: true, attempts };
      });
      const result = await engine.execute({
        steps: [{ action: "test.flaky", retry: 1 }],
      });
      expect(result.success).toBe(true);
      expect(attempts).toBe(2); // 首次失败 + 1 次重试成功
      expect(result.results[0].result.ok).toBe(true);
    });

    test("步骤超时 → 工作流失败", async () => {
      const result = await engine.execute({
        steps: [{ action: "system.delay", params: { ms: 300 }, timeout: 50 }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout/i);
    });
  });

  describe("自定义动作与命令动作", () => {
    test("registerAction 注册的动作被调用", async () => {
      const handler = vi.fn().mockResolvedValue({ custom: true });
      engine.registerAction("my.action", handler);
      const result = await engine.execute({
        steps: [{ action: "my.action", params: { foo: "bar" } }],
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.results[0].result.custom).toBe(true);
    });

    test("含点号的未知动作回退到 commandExecutor", async () => {
      const commandExecutor = vi.fn().mockResolvedValue({ clicked: true });
      const e = new WorkflowEngine(commandExecutor);
      const result = await e.execute({
        steps: [{ action: "device.click", params: { x: 1 } }],
      });
      expect(commandExecutor).toHaveBeenCalledWith("device.click", { x: 1 });
      expect(result.results[0].result.clicked).toBe(true);
    });
  });

  describe("validateWorkflow", () => {
    test("合法工作流通过校验", () => {
      const { valid, errors } = engine.validateWorkflow({
        steps: [{ action: "system.log", params: { message: "hi" } }],
      });
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    test("null / 缺 steps / step 缺 action 均不合法", () => {
      expect(engine.validateWorkflow(null).valid).toBe(false);
      expect(engine.validateWorkflow({}).valid).toBe(false);

      const missingAction = engine.validateWorkflow({ steps: [{}] });
      expect(missingAction.valid).toBe(false);
      expect(missingAction.errors.join(" ")).toMatch(/action/i);
    });
  });

  describe("取消与状态查询", () => {
    test("cancelWorkflow / getWorkflowStatus 对未知 id 返回 false / null", () => {
      expect(engine.cancelWorkflow("nope")).toBe(false);
      expect(engine.getWorkflowStatus("nope")).toBeNull();
    });

    test("空闲时无运行中的工作流", () => {
      expect(engine.getRunningWorkflows()).toEqual([]);
    });

    test("cancelWorkflow 置 shouldReturn → 截断后续步骤", async () => {
      engine.registerAction("test.cancelSelf", async (params, context) => {
        engine.cancelWorkflow("wf-cancel");
        return { cancelled: true };
      });
      await engine.execute({
        id: "wf-cancel",
        steps: [
          { action: "test.cancelSelf" },
          { action: "test.record", params: { tag: "should-not-run" } },
        ],
      });
      expect(records).toEqual([]); // 第二步被 shouldReturn 截断
    });
  });

  describe("ExecutionContext", () => {
    test("set/getVariable + ${var} 解析", () => {
      const ctx = new ExecutionContext({ name: "John", age: 30 });
      expect(ctx.getVariable("name")).toBe("John");
      ctx.setVariable("city", "NYC");
      expect(ctx.resolveVariables("${name} in ${city}")).toBe("John in NYC");
    });

    test("evaluateCondition 支持字符串表达式与对象条件", () => {
      const ctx = new ExecutionContext({ x: 10 });
      expect(ctx.evaluateCondition("${x} > 5")).toBe(true);
      expect(ctx.evaluateCondition("${x} < 5")).toBe(false);
      expect(
        ctx.evaluateCondition({ variable: "x", operator: ">=", value: 10 }),
      ).toBe(true);
    });

    test("无法解析的变量引用保持原样", () => {
      const ctx = new ExecutionContext({});
      expect(ctx.resolveVariables("${missing}")).toBe("${missing}");
    });
  });
});

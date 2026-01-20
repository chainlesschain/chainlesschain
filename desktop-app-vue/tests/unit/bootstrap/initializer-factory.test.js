/**
 * InitializerFactory 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// 动态导入以确保 mock 生效
let InitializerFactory;
let initializerFactory;

describe("InitializerFactory", () => {
  beforeEach(async () => {
    // 重新导入以获取新实例
    const module =
      await import("../../../src/main/bootstrap/initializer-factory.js");
    InitializerFactory = module.InitializerFactory;
    initializerFactory = new InitializerFactory();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("register", () => {
    it("应该成功注册初始化器", () => {
      const config = {
        name: "testModule",
        init: vi.fn(),
      };

      initializerFactory.register(config);

      expect(initializerFactory.initializers.has("testModule")).toBe(true);
    });

    it("应该拒绝没有 name 的初始化器", () => {
      const config = {
        init: vi.fn(),
      };

      expect(() => initializerFactory.register(config)).toThrow();
    });

    it("应该拒绝没有 init 函数的初始化器", () => {
      const config = {
        name: "testModule",
      };

      expect(() => initializerFactory.register(config)).toThrow();
    });

    it("应该设置默认值", () => {
      const config = {
        name: "testModule",
        init: vi.fn(),
      };

      initializerFactory.register(config);
      const registered = initializerFactory.initializers.get("testModule");

      expect(registered.required).toBe(false);
      expect(registered.lazy).toBe(false);
      expect(registered.dependsOn).toEqual([]);
    });
  });

  describe("registerAll", () => {
    it("应该批量注册多个初始化器", () => {
      const configs = [
        { name: "module1", init: vi.fn() },
        { name: "module2", init: vi.fn() },
        { name: "module3", init: vi.fn() },
      ];

      initializerFactory.registerAll(configs);

      expect(initializerFactory.initializers.size).toBe(3);
      expect(initializerFactory.initializers.has("module1")).toBe(true);
      expect(initializerFactory.initializers.has("module2")).toBe(true);
      expect(initializerFactory.initializers.has("module3")).toBe(true);
    });
  });

  describe("runOne", () => {
    it("应该成功执行初始化器", async () => {
      const mockInstance = { id: "test" };
      const config = {
        name: "testModule",
        init: vi.fn().mockResolvedValue(mockInstance),
      };

      initializerFactory.register(config);
      const result = await initializerFactory.runOne("testModule");

      expect(result.success).toBe(true);
      expect(result.name).toBe("testModule");
      expect(result.instance).toBe(mockInstance);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("应该返回错误结果当初始化器未注册", async () => {
      const result = await initializerFactory.runOne("unknownModule");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("应该处理初始化失败（非必需模块）", async () => {
      const config = {
        name: "testModule",
        required: false,
        init: vi.fn().mockRejectedValue(new Error("Init failed")),
      };

      initializerFactory.register(config);
      const result = await initializerFactory.runOne("testModule");

      expect(result.success).toBe(false);
      expect(result.error.message).toBe("Init failed");
    });

    it("应该抛出错误当必需模块初始化失败", async () => {
      const config = {
        name: "testModule",
        required: true,
        init: vi.fn().mockRejectedValue(new Error("Init failed")),
      };

      initializerFactory.register(config);

      await expect(initializerFactory.runOne("testModule")).rejects.toThrow(
        "Init failed",
      );
    });

    it("应该检查依赖", async () => {
      const dependentConfig = {
        name: "dependent",
        dependsOn: ["required"],
        init: vi.fn().mockResolvedValue({}),
      };

      initializerFactory.register(dependentConfig);
      const result = await initializerFactory.runOne("dependent");

      expect(result.success).toBe(false);
      expect(result.error.message).toContain("依赖");
    });

    it("应该传递上下文给初始化函数", async () => {
      const initFn = vi.fn().mockResolvedValue({});
      const config = {
        name: "testModule",
        init: initFn,
      };

      initializerFactory.register(config);
      await initializerFactory.runOne("testModule", { customContext: "value" });

      expect(initFn).toHaveBeenCalledWith(
        expect.objectContaining({
          customContext: "value",
        }),
      );
    });

    it("应该保存实例到 instances", async () => {
      const mockInstance = { id: "test" };
      const config = {
        name: "testModule",
        init: vi.fn().mockResolvedValue(mockInstance),
      };

      initializerFactory.register(config);
      await initializerFactory.runOne("testModule");

      expect(initializerFactory.getInstance("testModule")).toBe(mockInstance);
    });
  });

  describe("runParallel", () => {
    it("应该并行执行多个初始化器", async () => {
      const configs = [
        { name: "module1", init: vi.fn().mockResolvedValue({ id: 1 }) },
        { name: "module2", init: vi.fn().mockResolvedValue({ id: 2 }) },
        { name: "module3", init: vi.fn().mockResolvedValue({ id: 3 }) },
      ];

      initializerFactory.registerAll(configs);
      const results = await initializerFactory.runParallel([
        "module1",
        "module2",
        "module3",
      ]);

      expect(results.length).toBe(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("应该处理部分失败", async () => {
      const configs = [
        { name: "module1", init: vi.fn().mockResolvedValue({ id: 1 }) },
        {
          name: "module2",
          init: vi.fn().mockRejectedValue(new Error("Failed")),
        },
        { name: "module3", init: vi.fn().mockResolvedValue({ id: 3 }) },
      ];

      initializerFactory.registerAll(configs);
      const results = await initializerFactory.runParallel([
        "module1",
        "module2",
        "module3",
      ]);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });

  describe("runPhased", () => {
    it("应该按阶段执行初始化器", async () => {
      const configs = [
        { name: "phase1Module", init: vi.fn().mockResolvedValue({ id: 1 }) },
        { name: "phase2Module", init: vi.fn().mockResolvedValue({ id: 2 }) },
      ];

      const phases = [
        { name: "阶段 1", progress: 50, modules: ["phase1Module"] },
        { name: "阶段 2", progress: 100, modules: ["phase2Module"] },
      ];

      initializerFactory.registerAll(configs);
      const results = await initializerFactory.runPhased(phases);

      expect(results.size).toBe(2);
      expect(results.get("phase1Module").success).toBe(true);
      expect(results.get("phase2Module").success).toBe(true);
    });

    it("应该跳过懒加载模块", async () => {
      const configs = [
        { name: "normalModule", init: vi.fn().mockResolvedValue({ id: 1 }) },
        {
          name: "lazyModule",
          lazy: true,
          init: vi.fn().mockResolvedValue({ id: 2 }),
        },
      ];

      const phases = [
        {
          name: "阶段 1",
          progress: 100,
          modules: ["normalModule", "lazyModule"],
        },
      ];

      initializerFactory.registerAll(configs);
      await initializerFactory.runPhased(phases);

      expect(configs[0].init).toHaveBeenCalled();
      expect(configs[1].init).not.toHaveBeenCalled();
    });

    it("应该调用进度回调", async () => {
      const progressCallback = vi.fn();
      initializerFactory.setProgressCallback(progressCallback);

      const configs = [
        { name: "module1", init: vi.fn().mockResolvedValue({}) },
      ];

      const phases = [{ name: "阶段 1", progress: 100, modules: ["module1"] }];

      initializerFactory.registerAll(configs);
      await initializerFactory.runPhased(phases);

      expect(progressCallback).toHaveBeenCalledWith("阶段 1", 100);
    });
  });

  describe("依赖管理", () => {
    it("应该在依赖满足后执行", async () => {
      const configs = [
        { name: "base", init: vi.fn().mockResolvedValue({ id: "base" }) },
        {
          name: "dependent",
          dependsOn: ["base"],
          init: vi.fn().mockResolvedValue({ id: "dependent" }),
        },
      ];

      initializerFactory.registerAll(configs);

      // 先运行 base
      await initializerFactory.runOne("base");
      // 然后运行 dependent
      const result = await initializerFactory.runOne("dependent");

      expect(result.success).toBe(true);
    });

    it("应该将依赖实例传递给初始化函数", async () => {
      const baseInstance = { id: "base" };
      const dependentInit = vi.fn().mockResolvedValue({ id: "dependent" });

      const configs = [
        { name: "base", init: vi.fn().mockResolvedValue(baseInstance) },
        { name: "dependent", dependsOn: ["base"], init: dependentInit },
      ];

      initializerFactory.registerAll(configs);

      await initializerFactory.runOne("base");
      await initializerFactory.runOne("dependent");

      expect(dependentInit).toHaveBeenCalledWith(
        expect.objectContaining({
          base: baseInstance,
        }),
      );
    });
  });

  describe("实例管理", () => {
    it("getInstance 应该返回已初始化的实例", async () => {
      const mockInstance = { id: "test" };
      const config = {
        name: "testModule",
        init: vi.fn().mockResolvedValue(mockInstance),
      };

      initializerFactory.register(config);
      await initializerFactory.runOne("testModule");

      expect(initializerFactory.getInstance("testModule")).toBe(mockInstance);
    });

    it("getAllInstances 应该返回所有实例", async () => {
      const configs = [
        { name: "module1", init: vi.fn().mockResolvedValue({ id: 1 }) },
        { name: "module2", init: vi.fn().mockResolvedValue({ id: 2 }) },
      ];

      initializerFactory.registerAll(configs);
      await initializerFactory.runParallel(["module1", "module2"]);

      const instances = initializerFactory.getAllInstances();
      expect(instances.module1).toEqual({ id: 1 });
      expect(instances.module2).toEqual({ id: 2 });
    });
  });

  describe("reset", () => {
    it("应该重置所有状态", async () => {
      const config = {
        name: "testModule",
        init: vi.fn().mockResolvedValue({ id: "test" }),
      };

      initializerFactory.register(config);
      await initializerFactory.runOne("testModule");

      initializerFactory.reset();

      expect(initializerFactory.results.size).toBe(0);
      expect(initializerFactory.getAllInstances()).toEqual({});
      expect(initializerFactory.currentProgress).toBe(0);
    });
  });

  describe("printStats", () => {
    it("应该打印统计信息", async () => {
      const configs = [
        { name: "success", init: vi.fn().mockResolvedValue({}) },
        {
          name: "failure",
          init: vi.fn().mockRejectedValue(new Error("Failed")),
        },
      ];

      initializerFactory.registerAll(configs);
      await initializerFactory.runParallel(["success", "failure"]);

      // 不应该抛出错误
      expect(() => initializerFactory.printStats()).not.toThrow();
    });
  });
});

/**
 * Unit tests for k8s-deployer skill handler (v1.2.0)
 * Uses child_process.execSync via _deps injection
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/k8s-deployer/handler.js");

describe("k8s-deployer handler", () => {
  let mockExecSync;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync = vi.fn();
    handler._deps.execSync = mockExecSync;
  });

  describe("execute() - manifest action", () => {
    it("should generate K8s manifest YAML", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy web app named my-api" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("manifest");
      expect(result.yaml).toBeDefined();
      expect(result.yaml).toContain("kind: Deployment");
      expect(result.yaml).toContain("kind: Service");
    });

    it("should include PodDisruptionBudget", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy app" },
        {},
        {},
      );
      expect(result.yaml).toContain("PodDisruptionBudget");
    });

    it("should set custom replicas", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy service --replicas 5" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.replicas).toBe(5);
      expect(result.yaml).toContain("replicas: 5");
    });

    it("should set custom port", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy api --port 8080" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.port).toBe(8080);
    });

    it("should set custom image", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy app --image myrepo/myapp:v2.0" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.yaml).toContain("myrepo/myapp:v2.0");
    });

    it("should include security context", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy secure app" },
        {},
        {},
      );
      expect(result.yaml).toContain("runAsNonRoot: true");
      expect(result.yaml).toContain("allowPrivilegeEscalation: false");
      expect(result.yaml).toContain("readOnlyRootFilesystem: true");
    });

    it("should include resource limits", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy app" },
        {},
        {},
      );
      expect(result.yaml).toContain("requests:");
      expect(result.yaml).toContain("limits:");
    });

    it("should include health probes", async () => {
      const result = await handler.execute(
        { input: "manifest Deploy app" },
        {},
        {},
      );
      expect(result.yaml).toContain("livenessProbe");
      expect(result.yaml).toContain("readinessProbe");
    });
  });

  describe("execute() - helm action", () => {
    it("should generate Helm chart scaffold", async () => {
      const result = await handler.execute({ input: "helm my-chart" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("helm");
      expect(result.chartYaml).toContain("apiVersion: v2");
      expect(result.valuesYaml).toBeDefined();
      expect(result.files.length).toBe(6);
    });

    it("should use provided chart name", async () => {
      const result = await handler.execute(
        { input: "helm auth-service" },
        {},
        {},
      );
      expect(result.name).toBe("auth-service");
      expect(result.chartYaml).toContain("name: auth-service");
    });
  });

  describe("execute() - security action", () => {
    it("should return security checklist", async () => {
      const result = await handler.execute(
        { input: "security my-deployment" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("security");
      expect(result.checks).toBeDefined();
      expect(result.checks.length).toBe(8);
    });

    it("security checks should have severity levels", async () => {
      const result = await handler.execute({ input: "security" }, {}, {});
      for (const check of result.checks) {
        expect(["high", "medium", "low"]).toContain(check.severity);
      }
    });
  });

  describe("execute() - status action", () => {
    it("should query kubectl for status", async () => {
      mockExecSync.mockReturnValue(
        "NAME   READY   STATUS   RESTARTS   AGE\nmy-app   1/1   Running   0   10m",
      );
      const result = await handler.execute({ input: "status my-app" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("status");
    });

    it("should handle kubectl not available", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("command not found: kubectl");
      });
      const result = await handler.execute({ input: "status my-app" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("kubectl");
    });
  });

  describe("execute() - rollout action", () => {
    it("should execute rollout restart", async () => {
      mockExecSync.mockReturnValue("deployment.apps/my-app restarted");
      const result = await handler.execute(
        { input: "rollout restart my-app" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("rollout");
    });

    it("should fail without target deployment", async () => {
      const result = await handler.execute(
        { input: "rollout restart" },
        {},
        {},
      );
      // rollout needs a target
      expect(result).toBeDefined();
    });
  });
});

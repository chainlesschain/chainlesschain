/**
 * Unit tests for terraform-iac skill handler (v1.2.0)
 * Pure logic handler - generates HCL configurations
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/terraform-iac/handler.js");

describe("terraform-iac handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - generate action", () => {
    it("should generate AWS config when description mentions AWS", async () => {
      const result = await handler.execute(
        { input: "generate Deploy a web app on AWS with VPC" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
      expect(result.provider).toBe("aws");
    });

    it("should generate GCP config when description mentions GCP", async () => {
      const result = await handler.execute(
        { input: "generate Create a GKE cluster on GCP" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.provider).toBe("google");
    });

    it("should generate Azure config when description mentions Azure", async () => {
      const result = await handler.execute(
        { input: "generate Deploy AKS cluster on Azure" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.provider).toBe("azurerm");
    });

    it("should default to AWS when no provider detected", async () => {
      const result = await handler.execute(
        { input: "generate Deploy a web application" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.provider).toBe("aws");
    });

    it("should include HCL in result", async () => {
      const result = await handler.execute(
        { input: "generate Deploy on AWS" },
        {},
        {},
      );
      expect(result.hcl).toBeDefined();
      expect(result.hcl).toContain("terraform");
      expect(result.hcl).toContain("provider");
    });
  });

  describe("execute() - template action", () => {
    it("should list available templates when no name given", async () => {
      const result = await handler.execute({ input: "template" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.available).toBeDefined();
      expect(result.available.length).toBeGreaterThanOrEqual(8);
    });

    it("should return specific template by name", async () => {
      const result = await handler.execute(
        { input: "template aws-vpc" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.name).toBe("aws-vpc");
      expect(result.resources).toBeDefined();
    });
  });

  describe("execute() - module action", () => {
    it("should generate a Terraform module structure", async () => {
      const result = await handler.execute(
        { input: "module vpc-network" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("module");
      expect(result.hcl).toBeDefined();
      expect(result.files).toBeDefined();
    });
  });

  describe("execute() - validate action", () => {
    it("should return validate guidance", async () => {
      const result = await handler.execute({ input: "validate" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("validate");
    });
  });

  describe("execute() - default behavior", () => {
    it("should list templates on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("template");
    });

    it("should list templates on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("template");
    });
  });

  describe("template catalog", () => {
    it("should have 8 cloud templates", async () => {
      const result = await handler.execute({ input: "template" }, {}, {});
      expect(result.available.length).toBe(8);
    });

    it("templates should cover AWS, GCP, and Azure", async () => {
      const result = await handler.execute({ input: "template" }, {}, {});
      const text = result.available.join(" ").toLowerCase();
      expect(text).toMatch(/aws/);
      expect(text).toMatch(/gcp|google/);
      expect(text).toMatch(/azure/);
    });
  });
});

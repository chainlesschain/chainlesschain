/**
 * 提示词模板测试
 */

import { describe, it, expect } from "vitest";
import { weatherPrompts, getPromptContent } from "../prompts/weather-prompts.js";

describe("Weather Prompts", () => {
  describe("Prompt Definitions", () => {
    it("should have correct number of prompts", () => {
      expect(weatherPrompts).toHaveLength(3);
    });

    it("should have weather_report prompt", () => {
      const prompt = weatherPrompts.find((p) => p.name === "weather_report");
      expect(prompt).toBeDefined();
      expect(prompt?.description).toBe("生成一份详细的天气报告");
      expect(prompt?.arguments).toHaveLength(2);
      expect(prompt?.arguments?.[0].name).toBe("city");
      expect(prompt?.arguments?.[0].required).toBe(true);
      expect(prompt?.arguments?.[1].name).toBe("language");
      expect(prompt?.arguments?.[1].required).toBe(false);
    });

    it("should have travel_advice prompt", () => {
      const prompt = weatherPrompts.find((p) => p.name === "travel_advice");
      expect(prompt).toBeDefined();
      expect(prompt?.description).toBe("基于天气情况提供旅行建议");
      expect(prompt?.arguments).toHaveLength(2);
      expect(prompt?.arguments?.[0].name).toBe("destination");
      expect(prompt?.arguments?.[0].required).toBe(true);
      expect(prompt?.arguments?.[1].name).toBe("date");
      expect(prompt?.arguments?.[1].required).toBe(false);
    });

    it("should have weather_comparison prompt", () => {
      const prompt = weatherPrompts.find((p) => p.name === "weather_comparison");
      expect(prompt).toBeDefined();
      expect(prompt?.description).toBe("比较两个城市的天气情况");
      expect(prompt?.arguments).toHaveLength(2);
      expect(prompt?.arguments?.[0].name).toBe("city1");
      expect(prompt?.arguments?.[0].required).toBe(true);
      expect(prompt?.arguments?.[1].name).toBe("city2");
      expect(prompt?.arguments?.[1].required).toBe(true);
    });
  });

  describe("getPromptContent", () => {
    describe("weather_report", () => {
      it("should generate Chinese weather report prompt", () => {
        const messages = getPromptContent("weather_report", { city: "北京" });

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe("user");
        expect(messages[0].content.type).toBe("text");
        expect(messages[0].content.text).toContain("北京");
        expect(messages[0].content.text).toContain("当前天气状况");
        expect(messages[0].content.text).toContain("穿衣建议");
      });

      it("should generate English weather report prompt", () => {
        const messages = getPromptContent("weather_report", {
          city: "Beijing",
          language: "en",
        });

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe("user");
        expect(messages[0].content.text).toContain("Beijing");
        expect(messages[0].content.text).toContain("Current weather conditions");
        expect(messages[0].content.text).toContain("Clothing recommendations");
      });

      it("should default to Chinese language", () => {
        const messages = getPromptContent("weather_report", { city: "上海" });

        expect(messages[0].content.text).toContain("请为上海生成一份详细的天气报告");
      });
    });

    describe("travel_advice", () => {
      it("should generate travel advice prompt without date", () => {
        const messages = getPromptContent("travel_advice", {
          destination: "杭州",
        });

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe("user");
        expect(messages[0].content.text).toContain("杭州");
        expect(messages[0].content.text).toContain("近期出行");
        expect(messages[0].content.text).toContain("是否适合出行");
      });

      it("should generate travel advice prompt with date", () => {
        const messages = getPromptContent("travel_advice", {
          destination: "成都",
          date: "2026-02-15",
        });

        expect(messages).toHaveLength(1);
        expect(messages[0].content.text).toContain("成都");
        expect(messages[0].content.text).toContain("2026-02-15");
      });
    });

    describe("weather_comparison", () => {
      it("should generate weather comparison prompt", () => {
        const messages = getPromptContent("weather_comparison", {
          city1: "北京",
          city2: "上海",
        });

        expect(messages).toHaveLength(1);
        expect(messages[0].role).toBe("user");
        expect(messages[0].content.text).toContain("北京");
        expect(messages[0].content.text).toContain("上海");
        expect(messages[0].content.text).toContain("当前温度对比");
        expect(messages[0].content.text).toContain("表格形式");
      });
    });

    describe("Error Handling", () => {
      it("should throw error for unknown prompt", () => {
        expect(() => getPromptContent("unknown_prompt", {})).toThrow(
          "Unknown prompt: unknown_prompt",
        );
      });
    });
  });
});

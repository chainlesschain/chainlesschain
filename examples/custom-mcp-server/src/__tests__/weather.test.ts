/**
 * Weather Tools Unit Tests
 *
 * 使用 Vitest 测试天气工具的各项功能
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { weatherTools, handleWeatherTool } from "../tools/weather.js";

describe("Weather Tools", () => {
  describe("Tool Definitions", () => {
    it("should have correct number of tools", () => {
      expect(weatherTools).toHaveLength(3);
    });

    it("should define weather_current tool correctly", () => {
      const tool = weatherTools.find((t) => t.name === "weather_current");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("当前天气");
      expect(tool?.inputSchema.required).toContain("city");
    });

    it("should define weather_forecast tool correctly", () => {
      const tool = weatherTools.find((t) => t.name === "weather_forecast");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("天气预报");
      expect(tool?.inputSchema.required).toContain("city");
    });

    it("should define weather_air_quality tool correctly", () => {
      const tool = weatherTools.find((t) => t.name === "weather_air_quality");
      expect(tool).toBeDefined();
      expect(tool?.description).toContain("空气质量");
      expect(tool?.inputSchema.required).toContain("city");
    });
  });

  describe("handleWeatherTool", () => {
    describe("weather_current", () => {
      it("should return current weather for a city", async () => {
        const result = await handleWeatherTool("weather_current", {
          city: "北京",
        });

        expect(result).toHaveProperty("content");
        expect(result.content).toHaveLength(2);
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toContain("北京");
        expect(result.content[0].text).toContain("当前天气");
      });

      it("should respect units parameter", async () => {
        const metricResult = await handleWeatherTool("weather_current", {
          city: "上海",
          units: "metric",
        });

        expect(metricResult.content[0].text).toContain("°C");

        const imperialResult = await handleWeatherTool("weather_current", {
          city: "上海",
          units: "imperial",
        });

        expect(imperialResult.content[0].text).toContain("°F");
      });

      it("should include JSON data as second content item", async () => {
        const result = await handleWeatherTool("weather_current", {
          city: "广州",
        });

        const jsonContent = result.content[1];
        expect(jsonContent.type).toBe("text");

        const data = JSON.parse(jsonContent.text);
        expect(data).toHaveProperty("city", "广州");
        expect(data).toHaveProperty("temperature");
        expect(data).toHaveProperty("condition");
        expect(data).toHaveProperty("humidity");
      });
    });

    describe("weather_forecast", () => {
      it("should return forecast for default 3 days", async () => {
        const result = await handleWeatherTool("weather_forecast", {
          city: "成都",
        });

        expect(result.content[0].text).toContain("成都");
        expect(result.content[0].text).toContain("未来3天");

        const jsonContent = result.content[1];
        const data = JSON.parse(jsonContent.text);
        expect(data.forecast).toHaveLength(3);
      });

      it("should respect days parameter", async () => {
        const result = await handleWeatherTool("weather_forecast", {
          city: "杭州",
          days: 5,
        });

        const jsonContent = result.content[1];
        const data = JSON.parse(jsonContent.text);
        expect(data.forecast).toHaveLength(5);
      });

      it("should include temperature range in forecast", async () => {
        const result = await handleWeatherTool("weather_forecast", {
          city: "深圳",
          days: 1,
        });

        const jsonContent = result.content[1];
        const data = JSON.parse(jsonContent.text);
        const firstDay = data.forecast[0];

        expect(firstDay).toHaveProperty("tempHigh");
        expect(firstDay).toHaveProperty("tempLow");
        expect(firstDay).toHaveProperty("condition");
        expect(firstDay).toHaveProperty("date");
      });
    });

    describe("weather_air_quality", () => {
      it("should return air quality index", async () => {
        const result = await handleWeatherTool("weather_air_quality", {
          city: "武汉",
        });

        expect(result.content[0].text).toContain("武汉");
        expect(result.content[0].text).toContain("空气质量");
        expect(result.content[0].text).toContain("AQI");
      });

      it("should include PM2.5 and PM10 data", async () => {
        const result = await handleWeatherTool("weather_air_quality", {
          city: "西安",
        });

        const jsonContent = result.content[1];
        const data = JSON.parse(jsonContent.text);

        expect(data).toHaveProperty("aqi");
        expect(data).toHaveProperty("pm25");
        expect(data).toHaveProperty("pm10");
        expect(data).toHaveProperty("level");
      });

      it("should have valid AQI level", async () => {
        const result = await handleWeatherTool("weather_air_quality", {
          city: "南京",
        });

        const jsonContent = result.content[1];
        const data = JSON.parse(jsonContent.text);

        expect(["优", "良", "轻度污染", "中度污染"]).toContain(data.level);
      });
    });

    describe("Error Handling", () => {
      it("should throw error for unknown tool", async () => {
        await expect(
          handleWeatherTool("weather_unknown", { city: "北京" }),
        ).rejects.toThrow("Unknown weather tool");
      });
    });
  });
});

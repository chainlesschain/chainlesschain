/**
 * Unit tests for weather skill handler (v1.2.0)
 * Uses _deps injection for https mocking
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/weather/handler.js");

function createMockResponse(statusCode, body) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  process.nextTick(() => {
    res.emit("data", typeof body === "string" ? body : JSON.stringify(body));
    res.emit("end");
  });
  return res;
}

function createMockRequest(response) {
  const req = new EventEmitter();
  req.end = vi.fn();
  req.destroy = vi.fn();
  req.setTimeout = vi.fn();
  process.nextTick(() => {
    if (response instanceof Error) {
      req.emit("error", response);
    }
  });
  return req;
}

describe("weather handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (handler._deps) {
      handler._deps.https = {
        request: vi.fn((opts, cb) => {
          const weatherData = {
            current_condition: [{
              temp_C: "22", temp_F: "72", FeelsLikeC: "20", FeelsLikeF: "68",
              weatherDesc: [{ value: "Sunny" }], humidity: "45",
              windspeedKmph: "15", windspeedMiles: "9", winddir16Point: "NW",
              winddirDegree: "315", visibility: "10", cloudcover: "20",
              pressure: "1015", uvIndex: "5", precipMM: "0",
              observation_time: "12:00 PM",
            }],
            nearest_area: [{ areaName: [{ value: "London" }], country: [{ value: "UK" }], region: [{ value: "London" }] }],
            weather: [{
              date: "2026-03-06", maxtempC: "25", maxtempF: "77", mintempC: "15", mintempF: "59",
              uvIndex: "5", totalSnow_cm: "0",
              astronomy: [{ sunrise: "06:30", sunset: "18:30" }],
              hourly: [
                {}, {}, {}, {},
                { weatherDesc: [{ value: "Partly cloudy" }], humidity: "50", windspeedKmph: "12", winddir16Point: "N", chanceofrain: "20", chanceofsnow: "0", uvIndex: "4" },
              ],
            }],
          };
          const res = createMockResponse(200, weatherData);
          if (cb) cb(res);
          const req = createMockRequest(null);
          return req;
        }),
      };
    }
  });

  describe("execute() - current action", () => {
    it("should fetch current weather", async () => {
      const result = await handler.execute({ input: "current London" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("current");
      expect(result.weather.temperature_c).toBe(22);
      expect(result.weather.description).toBe("Sunny");
    });

    it("should return error without location", async () => {
      const result = await handler.execute({ input: "current" }, {}, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain("Location required");
    });

    it("should include message field in error responses", async () => {
      if (handler._deps) {
        handler._deps.https.request = vi.fn((opts, cb) => {
          const res = createMockResponse(404, "Not Found");
          if (cb) cb(res);
          return createMockRequest(null);
        });
      }
      const result = await handler.execute({ input: "current InvalidPlace" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should parse wind and humidity data", async () => {
      const result = await handler.execute({ input: "current London" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.weather.humidity).toBe(45);
      expect(result.weather.wind_speed_kmh).toBe(15);
      expect(result.weather.wind_direction).toBe("NW");
    });
  });

  describe("execute() - forecast action", () => {
    it("should fetch forecast", async () => {
      const result = await handler.execute({ input: "forecast London --days 3" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("forecast");
      expect(result.forecast).toBeDefined();
      expect(Array.isArray(result.forecast)).toBe(true);
    });

    it("should return error without location", async () => {
      const result = await handler.execute({ input: "forecast" }, {}, {});
      expect(result.success).toBe(false);
    });

    it("should include sunrise/sunset in forecast", async () => {
      const result = await handler.execute({ input: "forecast London" }, {}, {});
      expect(result.success).toBe(true);
      if (result.forecast && result.forecast.length > 0) {
        expect(result.forecast[0].sunrise).toBeDefined();
        expect(result.forecast[0].sunset).toBeDefined();
      }
    });
  });

  describe("execute() - default behavior", () => {
    it("should treat unrecognized first word as location for current weather", async () => {
      // weather handler defaults unrecognized words to location, not unknown action
      const result = await handler.execute({ input: "Tokyo" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("current");
    });
  });

  describe("parseInput edge cases", () => {
    it("should auto-detect forecast when --days is specified", async () => {
      const result = await handler.execute({ input: "London --days 5" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("forecast");
    });
  });
});

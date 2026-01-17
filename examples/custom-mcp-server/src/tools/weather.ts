/**
 * 天气查询工具
 *
 * 提供当前天气、天气预报等功能
 * 支持响应缓存以减少重复请求
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import { getCache, type CacheStats } from "../utils/cache.js";

/**
 * 天气工具列表
 */
export const weatherTools: Tool[] = [
  {
    name: "weather_current",
    description: "获取指定城市的当前天气",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称（如：北京、上海）",
        },
        units: {
          type: "string",
          enum: ["metric", "imperial"],
          default: "metric",
          description: "单位系统：metric(摄氏度) 或 imperial(华氏度)",
        },
        skipCache: {
          type: "boolean",
          default: false,
          description: "跳过缓存，强制获取最新数据",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "weather_forecast",
    description: "获取指定城市的天气预报（未来3天）",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称",
        },
        days: {
          type: "number",
          minimum: 1,
          maximum: 7,
          default: 3,
          description: "预报天数（1-7天）",
        },
        skipCache: {
          type: "boolean",
          default: false,
          description: "跳过缓存，强制获取最新数据",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "weather_air_quality",
    description: "获取指定城市的空气质量指数（AQI）",
    inputSchema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称",
        },
        skipCache: {
          type: "boolean",
          default: false,
          description: "跳过缓存，强制获取最新数据",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "weather_cache_stats",
    description: "获取天气数据缓存统计信息",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "weather_cache_clear",
    description: "清除天气数据缓存",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["current", "forecast", "airQuality", "all"],
          default: "all",
          description: "要清除的缓存类型",
        },
        city: {
          type: "string",
          description: "要清除的城市（可选，不指定则清除该类型所有缓存）",
        },
      },
      required: [],
    },
  },
];

/**
 * 模拟天气数据（用于演示）
 */
function getMockCurrentWeather(city: string, units: string = "metric") {
  const tempUnit = units === "metric" ? "°C" : "°F";
  const temp = units === "metric" ? 22 : 72;

  return {
    city,
    temperature: temp,
    unit: tempUnit,
    condition: "晴",
    humidity: 65,
    windSpeed: 12,
    pressure: 1013,
    timestamp: new Date().toISOString(),
  };
}

function getMockForecast(city: string, days: number = 3) {
  const forecast = [];
  const baseTemp = 20;

  for (let i = 1; i <= days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    forecast.push({
      date: date.toISOString().split("T")[0],
      tempHigh: baseTemp + Math.floor(Math.random() * 10),
      tempLow: baseTemp - Math.floor(Math.random() * 5),
      condition: i % 2 === 0 ? "多云" : "晴",
      precipitation: Math.floor(Math.random() * 30),
    });
  }

  return {
    city,
    forecast,
  };
}

function getMockAirQuality(city: string) {
  const aqi = Math.floor(Math.random() * 150) + 20; // 20-170
  let level = "优";

  if (aqi > 50) level = "良";
  if (aqi > 100) level = "轻度污染";
  if (aqi > 150) level = "中度污染";

  return {
    city,
    aqi,
    level,
    pm25: Math.floor(aqi * 0.7),
    pm10: Math.floor(aqi * 1.2),
    timestamp: new Date().toISOString(),
  };
}

/**
 * 处理天气工具调用
 */
export async function handleWeatherTool(
  name: string,
  args: Record<string, unknown>,
) {
  logger.info("Executing weather tool", { name, args });
  const cache = getCache();

  switch (name) {
    case "weather_current": {
      const { city, units = "metric", skipCache = false } = args as {
        city: string;
        units?: string;
        skipCache?: boolean;
      };

      const cacheKey = cache.generateKey("current", { city, units });
      let data;
      let fromCache = false;

      // 尝试从缓存获取
      if (!skipCache) {
        const cached = cache.get<ReturnType<typeof getMockCurrentWeather>>(cacheKey);
        if (cached) {
          data = cached;
          fromCache = true;
        }
      }

      // 缓存未命中，获取新数据
      if (!data) {
        data = getMockCurrentWeather(city, units);
        cache.set(cacheKey, data, "current");
      }

      return {
        content: [
          {
            type: "text",
            text:
              `**${data.city}** 当前天气${fromCache ? " (缓存)" : ""}\\n\\n` +
              `🌡️ 温度: ${data.temperature}${data.unit}\\n` +
              `☁️ 天气: ${data.condition}\\n` +
              `💧 湿度: ${data.humidity}%\\n` +
              `💨 风速: ${data.windSpeed} km/h\\n` +
              `⏱️ 更新时间: ${new Date(data.timestamp).toLocaleString("zh-CN")}`,
          },
          {
            type: "text",
            text: JSON.stringify({ ...data, fromCache }, null, 2),
            isError: false,
            annotations: {
              type: "data",
            },
          },
        ],
      };
    }

    case "weather_forecast": {
      const { city, days = 3, skipCache = false } = args as {
        city: string;
        days?: number;
        skipCache?: boolean;
      };

      const cacheKey = cache.generateKey("forecast", { city, days });
      let data;
      let fromCache = false;

      if (!skipCache) {
        const cached = cache.get<ReturnType<typeof getMockForecast>>(cacheKey);
        if (cached) {
          data = cached;
          fromCache = true;
        }
      }

      if (!data) {
        data = getMockForecast(city, days);
        cache.set(cacheKey, data, "forecast");
      }

      let forecastText = `**${data.city}** 未来${days}天天气预报${fromCache ? " (缓存)" : ""}\\n\\n`;

      for (const day of data.forecast) {
        forecastText +=
          `📅 ${day.date}\\n` +
          `  🌡️ 温度: ${day.tempLow}°C - ${day.tempHigh}°C\\n` +
          `  ☁️ 天气: ${day.condition}\\n` +
          `  🌧️ 降水概率: ${day.precipitation}%\\n\\n`;
      }

      return {
        content: [
          {
            type: "text",
            text: forecastText.trim(),
          },
          {
            type: "text",
            text: JSON.stringify({ ...data, fromCache }, null, 2),
          },
        ],
      };
    }

    case "weather_air_quality": {
      const { city, skipCache = false } = args as {
        city: string;
        skipCache?: boolean;
      };

      const cacheKey = cache.generateKey("airQuality", { city });
      let data;
      let fromCache = false;

      if (!skipCache) {
        const cached = cache.get<ReturnType<typeof getMockAirQuality>>(cacheKey);
        if (cached) {
          data = cached;
          fromCache = true;
        }
      }

      if (!data) {
        data = getMockAirQuality(city);
        cache.set(cacheKey, data, "airQuality");
      }

      let emoji = "🟢";
      if (data.aqi > 50) emoji = "🟡";
      if (data.aqi > 100) emoji = "🟠";
      if (data.aqi > 150) emoji = "🔴";

      return {
        content: [
          {
            type: "text",
            text:
              `**${data.city}** 空气质量 ${emoji}${fromCache ? " (缓存)" : ""}\\n\\n` +
              `AQI: ${data.aqi} (${data.level})\\n` +
              `PM2.5: ${data.pm25} μg/m³\\n` +
              `PM10: ${data.pm10} μg/m³\\n` +
              `更新时间: ${new Date(data.timestamp).toLocaleString("zh-CN")}`,
          },
          {
            type: "text",
            text: JSON.stringify({ ...data, fromCache }, null, 2),
          },
        ],
      };
    }

    case "weather_cache_stats": {
      const stats = cache.getStats();
      const keys = cache.keys();

      return {
        content: [
          {
            type: "text",
            text:
              `📊 **缓存统计**\\n\\n` +
              `命中次数: ${stats.hits}\\n` +
              `未命中次数: ${stats.misses}\\n` +
              `命中率: ${(stats.hitRate * 100).toFixed(1)}%\\n` +
              `缓存键数量: ${stats.keys}\\n\\n` +
              `**缓存键列表:**\\n${keys.length > 0 ? keys.map(k => `- ${k}`).join("\\n") : "(空)"}`,
          },
          {
            type: "text",
            text: JSON.stringify({ stats, keys }, null, 2),
          },
        ],
      };
    }

    case "weather_cache_clear": {
      const { type = "all", city } = args as {
        type?: string;
        city?: string;
      };

      let cleared = 0;

      if (type === "all") {
        const keysBefore = cache.keys().length;
        cache.flush();
        cleared = keysBefore;
      } else {
        const pattern = city ? `${type}:city=${city}*` : `${type}:*`;
        cleared = cache.delByPattern(pattern);
      }

      return {
        content: [
          {
            type: "text",
            text: `✅ 已清除 ${cleared} 条缓存记录`,
          },
          {
            type: "text",
            text: JSON.stringify({ type, city, cleared }, null, 2),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown weather tool: ${name}`);
  }
}

/**
 * 获取缓存统计（供外部使用）
 */
export function getCacheStats(): CacheStats {
  return getCache().getStats();
}

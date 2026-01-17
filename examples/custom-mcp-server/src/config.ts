/**
 * 服务器配置
 */

/**
 * 缓存配置
 */
export interface CacheConfig {
  /** 是否启用缓存 */
  enabled: boolean;
  /** 默认 TTL（秒） */
  defaultTTL: number;
  /** 当前天气 TTL（秒） */
  currentTTL: number;
  /** 天气预报 TTL（秒） */
  forecastTTL: number;
  /** 空气质量 TTL（秒） */
  airQualityTTL: number;
}

export interface WeatherServerConfig {
  apiKey?: string;
  timeout: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logPath: string;
  cache: CacheConfig;
}

/**
 * 从环境变量或默认值加载配置
 */
export const config: WeatherServerConfig = {
  apiKey: process.env.WEATHER_API_KEY,
  timeout: parseInt(process.env.WEATHER_TIMEOUT || "30000", 10),
  logLevel: (process.env.LOG_LEVEL as WeatherServerConfig["logLevel"]) || "info",
  logPath: process.env.LOG_PATH || ".logs/weather-mcp-server.log",
  cache: {
    enabled: process.env.CACHE_ENABLED !== "false",
    defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || "600", 10),
    currentTTL: parseInt(process.env.CACHE_CURRENT_TTL || "300", 10),
    forecastTTL: parseInt(process.env.CACHE_FORECAST_TTL || "1800", 10),
    airQualityTTL: parseInt(process.env.CACHE_AIR_QUALITY_TTL || "600", 10),
  },
};

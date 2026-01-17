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

/**
 * 速率限制配置
 */
export interface RateLimitConfig {
  /** 是否启用速率限制 */
  enabled: boolean;
  /** 最大并发请求数 */
  maxConcurrent: number;
  /** 请求最小间隔时间（毫秒） */
  minTime: number;
  /** 每个时间窗口最大请求数 */
  reservoir: number;
  /** 时间窗口刷新间隔（毫秒） */
  reservoirRefreshInterval: number;
  /** 刷新时补充的请求数 */
  reservoirRefreshAmount: number;
}

export interface WeatherServerConfig {
  apiKey?: string;
  timeout: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logPath: string;
  cache: CacheConfig;
  rateLimit: RateLimitConfig;
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
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    maxConcurrent: parseInt(process.env.RATE_LIMIT_MAX_CONCURRENT || "5", 10),
    minTime: parseInt(process.env.RATE_LIMIT_MIN_TIME || "100", 10),
    reservoir: parseInt(process.env.RATE_LIMIT_RESERVOIR || "60", 10),
    reservoirRefreshInterval: parseInt(
      process.env.RATE_LIMIT_REFRESH_INTERVAL || "60000",
      10,
    ),
    reservoirRefreshAmount: parseInt(
      process.env.RATE_LIMIT_REFRESH_AMOUNT || "60",
      10,
    ),
  },
};

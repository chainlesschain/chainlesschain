# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-17

### Added

- **Tools**: Complete weather query functionality
  - `weather_current` - Get current weather for a city
  - `weather_forecast` - Get weather forecast (1-7 days)
  - `weather_air_quality` - Get air quality index (AQI)

- **Resources**: Server data access
  - `weather://cities` - List of supported cities
  - `weather://api-status` - API status information

- **Prompts**: Pre-defined prompt templates
  - `weather_report` - Generate detailed weather report (zh/en)
  - `travel_advice` - Travel recommendations based on weather
  - `weather_comparison` - Compare weather between two cities

- **Utilities**:
  - `validation.ts` - Ajv-based parameter validation with `ToolError` class
  - `logger.ts` - Logging utility with file and console output

- **Configuration**:
  - Environment variable support (API key, timeout, log level)
  - Configuration schema for ChainlessChain integration

- **Development**:
  - Unit tests with Vitest (weather tools, config, prompts)
  - ESLint configuration for TypeScript
  - TypeScript strict mode enabled

- **Documentation**:
  - Comprehensive README with usage examples
  - MIT License
  - Project structure documentation

### Technical Details

- Built with `@modelcontextprotocol/sdk` v0.5.0
- TypeScript 5.3 with ES Modules
- Node.js 18+ required
- Vitest for testing
- Ajv for JSON Schema validation

## [Unreleased]

### Planned

- Real weather API integration (OpenWeatherMap)
- Rate limiting with `bottleneck`
- HTTP+SSE transport support
- Progress notifications for long operations

## [1.1.0] - 2026-01-17

### Added

- **Response Caching**: Smart caching system for weather data
  - `weather_cache_stats` tool - View cache hit rate and statistics
  - `weather_cache_clear` tool - Clear cache by type or city
  - `skipCache` parameter for all weather tools to bypass cache
  - Type-specific TTL configuration:
    - Current weather: 5 minutes (configurable via `CACHE_CURRENT_TTL`)
    - Weather forecast: 30 minutes (configurable via `CACHE_FORECAST_TTL`)
    - Air quality: 10 minutes (configurable via `CACHE_AIR_QUALITY_TTL`)

- **Cache Utility Module** (`src/utils/cache.ts`):
  - Singleton pattern for cache instance
  - Consistent cache key generation
  - Pattern-based cache deletion
  - Cache statistics tracking (hits, misses, hit rate)
  - Type-safe generic get/set methods

- **Configuration**:
  - `CACHE_ENABLED` - Enable/disable caching (default: true)
  - `CACHE_DEFAULT_TTL` - Default cache TTL in seconds (default: 600)
  - `CACHE_CURRENT_TTL` - Current weather TTL (default: 300)
  - `CACHE_FORECAST_TTL` - Forecast TTL (default: 1800)
  - `CACHE_AIR_QUALITY_TTL` - Air quality TTL (default: 600)

- **Tests**:
  - 23 comprehensive cache tests
  - Tests for singleton pattern, key generation, CRUD operations, statistics

### Technical Details

- Added `node-cache` dependency for in-memory caching
- Total tests: 50 (14 weather + 23 cache + 11 prompts + 2 config)

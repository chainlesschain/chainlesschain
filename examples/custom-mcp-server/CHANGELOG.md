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
- Response caching with `node-cache`
- Rate limiting with `bottleneck`
- HTTP+SSE transport support
- Progress notifications for long operations

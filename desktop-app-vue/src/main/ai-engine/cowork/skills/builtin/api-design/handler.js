/**
 * API Design Skill Handler
 *
 * Design RESTful APIs with best practices: design, review,
 * openapi, versioning, errors.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── Mode definitions ─────────────────────────────────────────────
const MODES = {
  design: "design",
  review: "review",
  openapi: "openapi",
  versioning: "versioning",
  errors: "errors",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const ROUTE_PATTERNS = [
  {
    pattern:
      /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    type: "express",
  },
  {
    pattern: /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*['"]([^'"]+)['"]/gi,
    type: "spring",
  },
  {
    pattern: /@app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi,
    type: "fastapi",
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function parseInput(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { mode: MODES.design, description: "" };
  }

  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (MODES[firstWord]) {
    return {
      mode: firstWord,
      description: input.slice(firstWord.length).trim(),
    };
  }
  return { mode: MODES.design, description: input };
}

function generateDesign(description) {
  const resource = description.split(/\s+/)[0] || "resource";
  const resourcePlural = resource.endsWith("s") ? resource : resource + "s";
  const lines = [
    `# API Design: ${description}`,
    "",
    "## Base URL",
    `\`/api/v1/${resourcePlural.toLowerCase()}\``,
    "",
    "## Endpoints",
    "",
    "| Method | Path | Description | Auth |",
    "|--------|------|-------------|------|",
    `| GET | /${resourcePlural.toLowerCase()} | List all ${resourcePlural.toLowerCase()} | Yes |`,
    `| GET | /${resourcePlural.toLowerCase()}/:id | Get single ${resource.toLowerCase()} | Yes |`,
    `| POST | /${resourcePlural.toLowerCase()} | Create ${resource.toLowerCase()} | Yes |`,
    `| PUT | /${resourcePlural.toLowerCase()}/:id | Update ${resource.toLowerCase()} | Yes |`,
    `| DELETE | /${resourcePlural.toLowerCase()}/:id | Delete ${resource.toLowerCase()} | Yes |`,
    "",
    "## Request/Response Schema",
    "",
    "### Create/Update Request",
    "```json",
    "{",
    '  "name": "string",',
    '  "description": "string"',
    "}",
    "```",
    "",
    "### Response",
    "```json",
    "{",
    '  "id": "string",',
    '  "name": "string",',
    '  "description": "string",',
    '  "createdAt": "ISO-8601",',
    '  "updatedAt": "ISO-8601"',
    "}",
    "```",
    "",
    "### List Response",
    "```json",
    "{",
    `  "data": [{ "id": "...", "name": "..." }],`,
    '  "pagination": {',
    '    "page": 1,',
    '    "pageSize": 20,',
    '    "totalItems": 100,',
    '    "totalPages": 5',
    "  }",
    "}",
    "```",
    "",
    "## Conventions",
    "- Use plural nouns for resource names",
    "- Use kebab-case for multi-word paths",
    "- Return 201 for successful creation",
    "- Return 204 for successful deletion",
    "- Include pagination for list endpoints",
    "- Use ISO-8601 for timestamps",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "design", resource, endpointCount: 5 },
  };
}

function generateReview(description, context) {
  const projectRoot =
    context?.projectRoot || context?.workspaceRoot || process.cwd();
  const targetPath = path.resolve(projectRoot, description);
  const issues = [];
  const endpoints = [];

  try {
    const content = fs.readFileSync(targetPath, "utf-8");

    for (const { pattern, type } of ROUTE_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(content)) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(),
          path: match[2],
          type,
        });
      }
    }

    // Check common issues
    if (endpoints.length === 0) {
      issues.push({
        severity: "info",
        message:
          "No route patterns detected — file may not contain API definitions",
      });
    }

    for (const ep of endpoints) {
      if (/[A-Z]/.test(ep.path)) {
        issues.push({
          severity: "warning",
          message: `Uppercase in path: ${ep.method} ${ep.path} — use lowercase`,
        });
      }
      if (ep.path.includes("_")) {
        issues.push({
          severity: "info",
          message: `Underscore in path: ${ep.method} ${ep.path} — prefer kebab-case`,
        });
      }
      if (
        /\/(get|create|update|delete|fetch|remove)/.test(ep.path.toLowerCase())
      ) {
        issues.push({
          severity: "warning",
          message: `Verb in path: ${ep.method} ${ep.path} — use HTTP method instead`,
        });
      }
    }
  } catch {
    issues.push({
      severity: "info",
      message: `Could not read file: ${description}`,
    });
  }

  const lines = [
    `# API Review: ${description}`,
    "",
    `**Endpoints found:** ${endpoints.length}`,
    "",
  ];

  if (endpoints.length > 0) {
    lines.push("## Endpoints");
    lines.push("| Method | Path |");
    lines.push("|--------|------|");
    for (const ep of endpoints) {
      lines.push(`| ${ep.method} | ${ep.path} |`);
    }
    lines.push("");
  }

  lines.push("## Issues");
  if (issues.length === 0) {
    lines.push("No issues found.");
  } else {
    for (const issue of issues) {
      lines.push(`- [${issue.severity}] ${issue.message}`);
    }
  }

  return {
    output: lines.join("\n"),
    data: {
      method: "review",
      endpointCount: endpoints.length,
      issueCount: issues.length,
      issues,
    },
  };
}

function generateOpenapi(description) {
  const resource = description.split(/\s+/)[0] || "Resource";
  const lines = [
    `# OpenAPI Specification: ${description}`,
    "",
    "```yaml",
    "openapi: 3.0.3",
    "info:",
    `  title: ${description}`,
    "  version: 1.0.0",
    "  description: Auto-generated API specification",
    "paths:",
    `  /${resource.toLowerCase()}s:`,
    "    get:",
    `      summary: List ${resource.toLowerCase()}s`,
    "      responses:",
    "        '200':",
    "          description: Success",
    "    post:",
    `      summary: Create ${resource.toLowerCase()}`,
    "      requestBody:",
    "        required: true",
    "        content:",
    "          application/json:",
    "            schema:",
    `              $ref: '#/components/schemas/${resource}'`,
    "      responses:",
    "        '201':",
    "          description: Created",
    `  /${resource.toLowerCase()}s/{id}:`,
    "    get:",
    `      summary: Get ${resource.toLowerCase()} by ID`,
    "      parameters:",
    "        - name: id",
    "          in: path",
    "          required: true",
    "          schema:",
    "            type: string",
    "      responses:",
    "        '200':",
    "          description: Success",
    "        '404':",
    "          description: Not found",
    "components:",
    "  schemas:",
    `    ${resource}:`,
    "      type: object",
    "      properties:",
    "        id:",
    "          type: string",
    "        name:",
    "          type: string",
    "        createdAt:",
    "          type: string",
    "          format: date-time",
    "```",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "openapi", resource },
  };
}

function generateVersioning(description) {
  const lines = [
    `# API Versioning Strategy: ${description}`,
    "",
    "## Versioning Approaches",
    "",
    "### 1. URL Path Versioning (Recommended)",
    "```",
    "/api/v1/resources",
    "/api/v2/resources",
    "```",
    "**Pros:** Clear, easy to route, cacheable",
    "**Cons:** URL changes between versions",
    "",
    "### 2. Header Versioning",
    "```",
    "Accept: application/vnd.api.v2+json",
    "```",
    "**Pros:** Clean URLs, content negotiation",
    "**Cons:** Harder to test, not visible in URL",
    "",
    "### 3. Query Parameter",
    "```",
    "/api/resources?version=2",
    "```",
    "**Pros:** Simple to implement",
    "**Cons:** Easy to forget, pollutes query string",
    "",
    "## Migration Checklist",
    "1. [ ] Document breaking changes between versions",
    "2. [ ] Set deprecation timeline (e.g., 6 months)",
    "3. [ ] Add `Sunset` and `Deprecation` headers to old version",
    "4. [ ] Provide migration guide for consumers",
    "5. [ ] Monitor old version usage before removal",
    "6. [ ] Set up version-specific rate limiting",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "versioning", description },
  };
}

function generateErrors(description) {
  const lines = [
    `# Error Design: ${description}`,
    "",
    "## Error Response Format",
    "```json",
    "{",
    '  "error": {',
    '    "code": "RESOURCE_NOT_FOUND",',
    '    "message": "The requested resource was not found.",',
    '    "details": [',
    '      { "field": "id", "reason": "No resource with id=abc123" }',
    "    ],",
    '    "requestId": "req-uuid-here"',
    "  }",
    "}",
    "```",
    "",
    "## Error Code Catalog",
    "",
    "| HTTP | Code | Description |",
    "|------|------|-------------|",
    "| 400 | VALIDATION_ERROR | Request body/params validation failed |",
    "| 401 | UNAUTHORIZED | Missing or invalid authentication |",
    "| 403 | FORBIDDEN | Authenticated but not authorized |",
    "| 404 | RESOURCE_NOT_FOUND | Resource does not exist |",
    "| 409 | CONFLICT | Resource state conflict (e.g., duplicate) |",
    "| 422 | UNPROCESSABLE | Valid syntax but semantic errors |",
    "| 429 | RATE_LIMITED | Too many requests |",
    "| 500 | INTERNAL_ERROR | Unexpected server error |",
    "| 503 | SERVICE_UNAVAILABLE | Temporarily unavailable |",
    "",
    "## Best Practices",
    "- Use consistent error format across all endpoints",
    "- Include machine-readable error codes (not just HTTP status)",
    "- Provide human-readable messages for debugging",
    "- Include `requestId` for log correlation",
    "- Never expose stack traces or internal details in production",
    "- Document all error codes in API documentation",
  ];

  return {
    output: lines.join("\n"),
    data: { method: "errors", description },
  };
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[api-design] handler initialized for "${skill?.name || "api-design"}"`,
    );
  },

  async execute(task, context, _skill) {
    const raw = task?.params?.input || task?.input || task?.action || "";
    const { mode, description } = parseInput(raw);

    if (!description) {
      return {
        success: false,
        output:
          "Usage: /api-design [mode] <requirements or file>\nModes: design, review, openapi, versioning, errors",
        error: "No description provided",
      };
    }

    try {
      let result;
      switch (mode) {
        case MODES.review:
          result = generateReview(description, context);
          break;
        case MODES.openapi:
          result = generateOpenapi(description);
          break;
        case MODES.versioning:
          result = generateVersioning(description);
          break;
        case MODES.errors:
          result = generateErrors(description);
          break;
        default:
          result = generateDesign(description);
          break;
      }

      logger.info(
        `[api-design] generated ${mode} for: ${description.slice(0, 60)}`,
      );

      return {
        success: true,
        output: result.output,
        result: result.data,
        message: `Generated ${mode} API design`,
      };
    } catch (err) {
      logger.error("[api-design] Error:", err.message);
      return {
        success: false,
        output: `Error: ${err.message}`,
        error: err.message,
      };
    }
  },
};

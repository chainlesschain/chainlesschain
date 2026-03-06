/**
 * Docker Compose Generator Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");
const fs = require("fs");
const path = require("path");

const SERVICE_TEMPLATES = {
  postgresql: { image: "postgres:16-alpine", ports: ["5432:5432"], environment: { POSTGRES_DB: "app", POSTGRES_USER: "app", POSTGRES_PASSWORD: "app" }, volumes: ["postgres_data:/var/lib/postgresql/data"], healthcheck: { test: "pg_isready -U app", interval: "10s", retries: 5 } },
  mysql: { image: "mysql:8", ports: ["3306:3306"], environment: { MYSQL_ROOT_PASSWORD: "root", MYSQL_DATABASE: "app" }, volumes: ["mysql_data:/var/lib/mysql"] },
  redis: { image: "redis:7-alpine", ports: ["6379:6379"], volumes: ["redis_data:/data"], healthcheck: { test: "redis-cli ping", interval: "10s", retries: 5 } },
  mongodb: { image: "mongo:7", ports: ["27017:27017"], volumes: ["mongo_data:/data/db"] },
  elasticsearch: { image: "elasticsearch:8.12.0", ports: ["9200:9200"], environment: { "discovery.type": "single-node", "xpack.security.enabled": "false" }, volumes: ["es_data:/usr/share/elasticsearch/data"] },
  rabbitmq: { image: "rabbitmq:3-management", ports: ["5672:5672", "15672:15672"] },
  nginx: { image: "nginx:alpine", ports: ["80:80", "443:443"], volumes: ["./nginx.conf:/etc/nginx/nginx.conf:ro"] },
  qdrant: { image: "qdrant/qdrant", ports: ["6333:6333"], volumes: ["qdrant_data:/qdrant/storage"] },
  ollama: { image: "ollama/ollama", ports: ["11434:11434"], volumes: ["ollama_data:/root/.ollama"] },
  minio: { image: "minio/minio", ports: ["9000:9000", "9001:9001"], command: 'server /data --console-address ":9001"', volumes: ["minio_data:/data"] },
};

module.exports = {
  async init(skill) { logger.info("[DockerCompose] Initialized"); },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "generate": return handleGenerate(parsed.description);
        case "add-service": return handleAddService(parsed.service, context);
        case "validate": return handleValidate(context);
        case "template": return handleTemplate(parsed.template);
        default: return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[DockerCompose] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "generate", description: "" };
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "generate").toLowerCase();
  const rest = parts.slice(1).join(" ").replace(/"/g, "");
  return { action, description: rest, service: parts[1], template: parts[1] };
}

function handleGenerate(description) {
  const lower = (description || "").toLowerCase();
  const services = {};
  const volumes = {};

  // Detect services
  const detections = [
    { keywords: ["postgres", "pg", "postgresql"], name: "postgresql" },
    { keywords: ["mysql", "mariadb"], name: "mysql" },
    { keywords: ["redis", "cache"], name: "redis" },
    { keywords: ["mongo", "mongodb"], name: "mongodb" },
    { keywords: ["elastic", "elasticsearch"], name: "elasticsearch" },
    { keywords: ["rabbit", "rabbitmq", "amqp"], name: "rabbitmq" },
    { keywords: ["nginx", "proxy", "reverse-proxy"], name: "nginx" },
    { keywords: ["qdrant", "vector"], name: "qdrant" },
    { keywords: ["ollama", "llm"], name: "ollama" },
    { keywords: ["minio", "s3", "object-storage"], name: "minio" },
  ];

  for (const d of detections) {
    if (d.keywords.some((k) => lower.includes(k))) {
      const tmpl = SERVICE_TEMPLATES[d.name];
      services[d.name] = { ...tmpl };
      if (tmpl.volumes) {
        for (const v of tmpl.volumes) {
          const volName = v.split(":")[0];
          if (!volName.startsWith(".") && !volName.startsWith("/")) {
            volumes[volName] = null;
          }
        }
      }
    }
  }

  // Add app service if Node/Python detected
  if (lower.includes("node") || lower.includes("express") || lower.includes("next")) {
    services.app = { build: ".", ports: ["3000:3000"], depends_on: Object.keys(services), environment: { NODE_ENV: "development" }, volumes: [".:/app", "/app/node_modules"] };
  } else if (lower.includes("python") || lower.includes("fastapi") || lower.includes("django")) {
    services.app = { build: ".", ports: ["8000:8000"], depends_on: Object.keys(services), volumes: [".:/app"] };
  }

  const compose = { version: "3.8", services };
  if (Object.keys(volumes).length > 0) compose.volumes = volumes;

  const yaml = toYAML(compose);

  return {
    success: true,
    action: "generate",
    yaml,
    serviceCount: Object.keys(services).length,
    services: Object.keys(services),
    message: `Generated docker-compose.yml with ${Object.keys(services).length} service(s): ${Object.keys(services).join(", ")}`,
  };
}

function handleAddService(serviceName, context) {
  const name = (serviceName || "").toLowerCase();
  const tmpl = SERVICE_TEMPLATES[name];
  if (!tmpl) {
    return { success: false, error: `Unknown service: ${name}. Available: ${Object.keys(SERVICE_TEMPLATES).join(", ")}` };
  }
  return { success: true, action: "add-service", service: name, config: tmpl, yaml: toYAML({ [name]: tmpl }) };
}

function handleValidate(context) {
  const cwd = context.cwd || process.cwd();
  const composePath = path.join(cwd, "docker-compose.yml");
  if (!fs.existsSync(composePath)) {
    const altPath = path.join(cwd, "docker-compose.yaml");
    if (!fs.existsSync(altPath)) return { success: false, error: "No docker-compose.yml found." };
  }
  return { success: true, action: "validate", message: "docker-compose.yml found. Run `docker compose config` for full validation." };
}

function handleTemplate(name) {
  const templates = {
    fullstack: "Node.js + PostgreSQL + Redis + Nginx",
    microservice: "Multiple Node.js services + RabbitMQ + Redis + PostgreSQL",
    "data-pipeline": "Python + PostgreSQL + Elasticsearch + Redis",
    "ml-stack": "Python + Ollama + Qdrant + PostgreSQL",
    monitoring: "Prometheus + Grafana + Node Exporter",
  };
  if (!name || !templates[name]) {
    return { success: true, action: "template", templates, message: `Available: ${Object.keys(templates).join(", ")}` };
  }
  return handleGenerate(templates[name]);
}

function toYAML(obj, indent = 0) {
  let yaml = "";
  const prefix = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      yaml += `${prefix}${key}:\n`;
    } else if (Array.isArray(value)) {
      yaml += `${prefix}${key}:\n`;
      for (const item of value) {
        if (typeof item === "object") yaml += `${prefix}  - ${JSON.stringify(item)}\n`;
        else yaml += `${prefix}  - ${JSON.stringify(item)}\n`;
      }
    } else if (typeof value === "object") {
      yaml += `${prefix}${key}:\n${toYAML(value, indent + 1)}`;
    } else {
      yaml += `${prefix}${key}: ${JSON.stringify(value)}\n`;
    }
  }
  return yaml;
}

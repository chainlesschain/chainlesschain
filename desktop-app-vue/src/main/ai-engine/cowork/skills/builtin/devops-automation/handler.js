/**
 * DevOps Automation Skill Handler
 *
 * Generates Dockerfiles, CI/CD pipeline configs (GitHub Actions, GitLab CI),
 * and deployment scripts based on project analysis.
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

module.exports = {
  async init(skill) {
    logger.info("[DevOps] Handler initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { action, options } = parseInput(input, context);

    logger.info(`[DevOps] Action: ${action}`, { options });

    try {
      switch (action) {
        case "dockerfile":
          return handleDockerfile(options.targetDir);
        case "ci-config":
          return handleCIConfig(options.targetDir, options.platform);
        case "deploy":
          return handleDeploy(options.targetDir, options.target);
        case "analyze":
          return handleAnalyze(options.targetDir);
        default:
          return handleAnalyze(options.targetDir);
      }
    } catch (error) {
      logger.error(`[DevOps] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `DevOps automation failed: ${error.message}`,
      };
    }
  },
};

function parseInput(input, context) {
  const parts = (input || "").trim().split(/\s+/);
  const options = {
    targetDir: context.workspacePath || process.cwd(),
    platform: "github",
    target: "production",
  };
  let action = "analyze";

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "dockerfile") {
      action = "dockerfile";
    } else if (p === "ci-config") {
      action = "ci-config";
    } else if (p === "deploy") {
      action = "deploy";
    } else if (p === "analyze") {
      action = "analyze";
    } else if (p === "--platform") {
      options.platform = parts[++i] || "github";
    } else if (p === "--target") {
      options.target = parts[++i] || "production";
    }
  }

  return { action, options };
}

function detectProjectType(dir) {
  const info = {
    type: "unknown",
    language: "unknown",
    framework: null,
    hasDocker: false,
    hasCI: false,
  };

  if (fs.existsSync(path.join(dir, "package.json"))) {
    info.language = "javascript";
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
      );
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.electron) {
        info.type = "electron";
        info.framework = "electron";
      } else if (deps.next) {
        info.type = "nextjs";
        info.framework = "next.js";
      } else if (deps.nuxt) {
        info.type = "nuxtjs";
        info.framework = "nuxt.js";
      } else if (deps.vue) {
        info.type = "vue";
        info.framework = "vue";
      } else if (deps.react) {
        info.type = "react";
        info.framework = "react";
      } else if (deps.express || deps.fastify) {
        info.type = "node-api";
        info.framework = deps.express ? "express" : "fastify";
      } else {
        info.type = "node";
      }
    } catch {
      /* ignore */
    }
  }

  if (fs.existsSync(path.join(dir, "pom.xml"))) {
    info.type = "java";
    info.language = "java";
    info.framework = "spring-boot";
  }
  if (
    fs.existsSync(path.join(dir, "build.gradle.kts")) ||
    fs.existsSync(path.join(dir, "build.gradle"))
  ) {
    info.type = "android";
    info.language = "kotlin";
  }
  if (fs.existsSync(path.join(dir, "requirements.txt"))) {
    info.type = "python";
    info.language = "python";
  }
  if (fs.existsSync(path.join(dir, "go.mod"))) {
    info.type = "go";
    info.language = "go";
  }
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    info.type = "rust";
    info.language = "rust";
  }

  info.hasDocker =
    fs.existsSync(path.join(dir, "Dockerfile")) ||
    fs.existsSync(path.join(dir, "docker-compose.yml"));
  info.hasCI =
    fs.existsSync(path.join(dir, ".github/workflows")) ||
    fs.existsSync(path.join(dir, ".gitlab-ci.yml")) ||
    fs.existsSync(path.join(dir, "Jenkinsfile"));

  return info;
}

function handleDockerfile(targetDir) {
  const project = detectProjectType(targetDir);

  let dockerfile;
  switch (project.type) {
    case "node":
    case "vue":
    case "react":
    case "nextjs":
      dockerfile = `# Multi-stage build for ${project.framework || "Node.js"} app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm ci --production
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
`;
      break;

    case "python":
      dockerfile = `# Multi-stage build for Python app
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /root/.local /root/.local
COPY . .
ENV PATH=/root/.local/bin:$PATH
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`;
      break;

    case "java":
      dockerfile = `# Multi-stage build for Spring Boot
FROM eclipse-temurin:17-jdk AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN ./mvnw clean package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
`;
      break;

    case "go":
      dockerfile = `# Multi-stage build for Go
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o main .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/main .
EXPOSE 8080
CMD ["./main"]
`;
      break;

    default:
      dockerfile = `# Generic Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["npm", "start"]
`;
  }

  return {
    success: true,
    result: { projectType: project.type, framework: project.framework },
    generatedFiles: [{ path: "Dockerfile", content: dockerfile }],
    message: `Dockerfile Generated (${project.type}/${project.framework || project.language})\n${"=".repeat(40)}\n\n\`\`\`dockerfile\n${dockerfile}\`\`\`\n\nNote: Preview only. Adjust paths and ports as needed.`,
  };
}

function handleCIConfig(targetDir, platform) {
  const project = detectProjectType(targetDir);
  let config, configPath;

  if (platform === "github" || platform === "github-actions") {
    configPath = ".github/workflows/ci.yml";
    config = `name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint --if-present

      - name: Test
        run: npm test --if-present

  build:
    needs: lint-and-test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
`;
  } else if (platform === "gitlab") {
    configPath = ".gitlab-ci.yml";
    config = `stages:
  - lint
  - test
  - build
  - deploy

variables:
  NODE_VERSION: "20"

lint:
  stage: lint
  image: node:\${NODE_VERSION}-alpine
  script:
    - npm ci
    - npm run lint

test:
  stage: test
  image: node:\${NODE_VERSION}-alpine
  script:
    - npm ci
    - npm test
  coverage: /All files[^|]*\\|[^|]*\\s+([\\d.]+)/

build:
  stage: build
  image: node:\${NODE_VERSION}-alpine
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
`;
  } else {
    configPath = "Jenkinsfile";
    config = `pipeline {
    agent any

    stages {
        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }
        stage('Lint') {
            steps {
                sh 'npm run lint'
            }
        }
        stage('Test') {
            steps {
                sh 'npm test'
            }
        }
        stage('Build') {
            steps {
                sh 'npm run build'
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
`;
  }

  return {
    success: true,
    result: { platform, projectType: project.type, configPath },
    generatedFiles: [{ path: configPath, content: config }],
    message: `CI/CD Config Generated (${platform})\n${"=".repeat(35)}\n\nFile: ${configPath}\n\n\`\`\`yaml\n${config.substring(0, 800)}${config.length > 800 ? "..." : ""}\n\`\`\`\n\nNote: Preview only. Customize for your environment.`,
  };
}

function handleDeploy(targetDir, target) {
  const project = detectProjectType(targetDir);

  const deployScript = `#!/bin/bash
# Deployment script for ${target}
# Project: ${project.type}/${project.framework || project.language}
# Generated by DevOps Automation Skill

set -euo pipefail

ENVIRONMENT="${target}"
APP_NAME="${path.basename(targetDir)}"
TIMESTAMP=$(date +%Y%m%d%H%M%S)

echo "Deploying $APP_NAME to $ENVIRONMENT..."

# 1. Pre-deploy checks
echo "Running pre-deploy checks..."
${project.language === "javascript" ? "npm test --if-present" : project.language === "python" ? "pytest" : "echo 'No tests configured'"}

# 2. Build
echo "Building application..."
${project.language === "javascript" ? "npm run build" : project.language === "python" ? "pip install -r requirements.txt" : "echo 'Build step'"}

# 3. Deploy
echo "Deploying to $ENVIRONMENT..."
# TODO: Add deployment commands (docker push, kubectl apply, rsync, etc.)

# 4. Health check
echo "Running health check..."
# TODO: curl -f http://localhost:3000/health || exit 1

echo "Deployment complete: $APP_NAME → $ENVIRONMENT at $TIMESTAMP"
`;

  return {
    success: true,
    result: { target, projectType: project.type },
    generatedFiles: [{ path: `deploy-${target}.sh`, content: deployScript }],
    message: `Deploy Script Generated (${target})\n${"=".repeat(35)}\n\n\`\`\`bash\n${deployScript}\`\`\`\n\nNote: Preview only. Add your actual deployment commands.`,
  };
}

function handleAnalyze(targetDir) {
  const project = detectProjectType(targetDir);

  const suggestions = [];

  if (!project.hasDocker) {
    suggestions.push({
      type: "docker",
      detail:
        "No Dockerfile found. Run '/devops-automation dockerfile' to generate one.",
    });
  }
  if (!project.hasCI) {
    suggestions.push({
      type: "ci",
      detail:
        "No CI/CD config found. Run '/devops-automation ci-config --platform github' to generate.",
    });
  }

  // Check for .env.example
  if (!fs.existsSync(path.join(targetDir, ".env.example"))) {
    suggestions.push({
      type: "env",
      detail:
        "No .env.example found. Consider creating one for team onboarding.",
    });
  }

  // Check for docker-compose
  if (
    project.hasDocker &&
    !fs.existsSync(path.join(targetDir, "docker-compose.yml"))
  ) {
    suggestions.push({
      type: "compose",
      detail:
        "Dockerfile exists but no docker-compose.yml. Consider adding for multi-service setup.",
    });
  }

  const report =
    `DevOps Analysis\n${"=".repeat(20)}\n` +
    `Project: ${project.type} (${project.framework || project.language})\n` +
    `Docker: ${project.hasDocker ? "✅" : "❌"}\n` +
    `CI/CD: ${project.hasCI ? "✅" : "❌"}\n\n` +
    (suggestions.length > 0
      ? `Suggestions:\n` +
        suggestions
          .map((s, i) => `${i + 1}. [${s.type}] ${s.detail}`)
          .join("\n")
      : "✅ DevOps setup looks good!") +
    `\n\nAvailable commands:\n` +
    `  /devops-automation dockerfile\n` +
    `  /devops-automation ci-config --platform github|gitlab|jenkins\n` +
    `  /devops-automation deploy --target staging|production`;

  return {
    success: true,
    result: { project, suggestions },
    message: report,
  };
}

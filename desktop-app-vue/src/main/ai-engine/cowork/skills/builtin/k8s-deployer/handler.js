/**
 * Kubernetes Deployer Skill Handler
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { logger } = require("../../../../../utils/logger.js");
const { execSync } = require("child_process");
/* eslint-enable @typescript-eslint/no-require-imports */

const _deps = { execSync };

module.exports = {
  _deps,
  async init(_skill) {
    logger.info("[K8sDeployer] Initialized");
  },

  async execute(task, _context = {}, _skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "manifest":
          return handleManifest(parsed.description, parsed.options);
        case "helm":
          return handleHelm(parsed.name);
        case "status":
          return handleStatus(parsed.target);
        case "rollout":
          return handleRollout(parsed.subAction, parsed.target);
        case "security":
          return handleSecurity(parsed.target);
        default:
          return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[K8sDeployer] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return {
      action: "manifest",
      description: "",
      name: "",
      target: "",
      subAction: "",
      options: {},
    };
  }
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "manifest").toLowerCase();
  const rest = parts.slice(1).join(" ").replace(/"/g, "");
  const replicasMatch = input.match(/--replicas\s+(\d+)/);
  const portMatch = input.match(/--port\s+(\d+)/);
  const imageMatch = input.match(/--image\s+(\S+)/);

  return {
    action,
    description: rest,
    name: parts[1] || "my-app",
    target: parts[2] || parts[1] || "",
    subAction: parts[1] || "",
    options: {
      replicas: replicasMatch ? parseInt(replicasMatch[1]) : 3,
      port: portMatch ? parseInt(portMatch[1]) : 3000,
      image: imageMatch ? imageMatch[1] : null,
    },
  };
}

function handleManifest(description, options) {
  const lower = (description || "").toLowerCase();
  const name = extractAppName(lower) || "my-app";
  const replicas = options.replicas || 3;
  const port = options.port || 3000;
  const image = options.image || `${name}:latest`;

  const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: ${name}
          image: ${image}
          ports:
            - containerPort: ${port}
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /health
              port: ${port}
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: ${port}
            initialDelaySeconds: 5
            periodSeconds: 5
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app: ${name}
  ports:
    - port: 80
      targetPort: ${port}
  type: ClusterIP
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${name}-pdb
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: ${name}`;

  return {
    success: true,
    action: "manifest",
    yaml,
    name,
    replicas,
    port,
    files: [`${name}-deployment.yaml`],
    message: `K8s manifest generated: Deployment (${replicas} replicas) + Service + PDB for "${name}".`,
  };
}

function handleHelm(name) {
  const chartName = name || "my-chart";

  const chartYaml = `apiVersion: v2
name: ${chartName}
description: A Helm chart for ${chartName}
type: application
version: 0.1.0
appVersion: "1.0.0"`;

  const valuesYaml = `replicaCount: 3

image:
  repository: ${chartName}
  pullPolicy: IfNotPresent
  tag: "latest"

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: false
  className: nginx
  hosts:
    - host: ${chartName}.local
      paths:
        - path: /
          pathType: Prefix

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilization: 80`;

  return {
    success: true,
    action: "helm",
    name: chartName,
    chartYaml,
    valuesYaml,
    files: [
      `${chartName}/Chart.yaml`,
      `${chartName}/values.yaml`,
      `${chartName}/templates/deployment.yaml`,
      `${chartName}/templates/service.yaml`,
      `${chartName}/templates/ingress.yaml`,
      `${chartName}/templates/_helpers.tpl`,
    ],
    message: `Helm chart scaffold generated for "${chartName}" with ${6} template files.`,
  };
}

function handleStatus(target) {
  const results = {};
  try {
    if (target) {
      results.deployment = _deps
        .execSync(`kubectl get deployment ${target} -o wide 2>&1`, {
          encoding: "utf8",
          timeout: 10000,
        })
        .trim();
      results.pods = _deps
        .execSync(`kubectl get pods -l app=${target} -o wide 2>&1`, {
          encoding: "utf8",
          timeout: 10000,
        })
        .trim();
    } else {
      results.deployments = _deps
        .execSync("kubectl get deployments -o wide 2>&1", {
          encoding: "utf8",
          timeout: 10000,
        })
        .trim();
      results.pods = _deps
        .execSync("kubectl get pods -o wide 2>&1", {
          encoding: "utf8",
          timeout: 10000,
        })
        .trim();
    }
    return {
      success: true,
      action: "status",
      target: target || "all",
      results,
      message: "Cluster status retrieved.",
    };
  } catch (error) {
    return {
      success: false,
      error: `kubectl failed: ${error.message}. Ensure kubectl is installed and configured.`,
    };
  }
}

function handleRollout(subAction, target) {
  if (!target) {
    return { success: false, error: "Specify a deployment name." };
  }

  const commands = {
    restart: `kubectl rollout restart deployment/${target}`,
    undo: `kubectl rollout undo deployment/${target}`,
    status: `kubectl rollout status deployment/${target}`,
    history: `kubectl rollout history deployment/${target}`,
  };

  const cmd = commands[subAction] || commands.status;

  try {
    const output = _deps
      .execSync(`${cmd} 2>&1`, { encoding: "utf8", timeout: 30000 })
      .trim();
    return {
      success: true,
      action: "rollout",
      subAction,
      target,
      output,
      command: cmd,
      message: `Rollout ${subAction} completed for ${target}.`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Rollout failed: ${error.message}`,
      command: cmd,
    };
  }
}

function handleSecurity(target) {
  const checks = [
    {
      name: "Non-root container",
      description: "runAsNonRoot: true in securityContext",
      severity: "high",
    },
    {
      name: "Read-only root filesystem",
      description: "readOnlyRootFilesystem: true",
      severity: "medium",
    },
    {
      name: "Drop all capabilities",
      description: "capabilities.drop: [ALL]",
      severity: "high",
    },
    {
      name: "No privilege escalation",
      description: "allowPrivilegeEscalation: false",
      severity: "high",
    },
    {
      name: "Resource limits",
      description: "CPU and memory limits set",
      severity: "medium",
    },
    {
      name: "Image tag pinning",
      description: "Avoid :latest tag, use digest or specific version",
      severity: "medium",
    },
    {
      name: "Network policy",
      description: "NetworkPolicy restricting ingress/egress",
      severity: "medium",
    },
    {
      name: "Pod security standards",
      description: "Apply restricted PodSecurityStandard",
      severity: "high",
    },
  ];

  return {
    success: true,
    action: "security",
    target: target || "general",
    checks,
    message: `${checks.length} security best practices to verify.`,
  };
}

function extractAppName(text) {
  const match = text.match(/(?:for|named?|called?)\s+(\S+)/);
  return match ? match[1].replace(/[^a-z0-9-]/g, "") : null;
}

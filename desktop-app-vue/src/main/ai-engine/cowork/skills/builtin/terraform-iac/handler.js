/**
 * Terraform IaC Skill Handler
 */

const { logger } = require("../../../../../utils/logger.js");

const TEMPLATES = {
  "aws-vpc": { provider: "aws", resources: ["aws_vpc", "aws_subnet", "aws_internet_gateway", "aws_route_table", "aws_security_group"] },
  "aws-ecs": { provider: "aws", resources: ["aws_ecs_cluster", "aws_ecs_task_definition", "aws_ecs_service", "aws_lb", "aws_lb_target_group"] },
  "aws-rds": { provider: "aws", resources: ["aws_db_instance", "aws_db_subnet_group", "aws_security_group"] },
  "aws-lambda": { provider: "aws", resources: ["aws_lambda_function", "aws_iam_role", "aws_api_gateway_rest_api"] },
  "gcp-gke": { provider: "google", resources: ["google_container_cluster", "google_container_node_pool", "google_compute_network"] },
  "gcp-cloudsql": { provider: "google", resources: ["google_sql_database_instance", "google_sql_database", "google_sql_user"] },
  "azure-aks": { provider: "azurerm", resources: ["azurerm_kubernetes_cluster", "azurerm_virtual_network", "azurerm_subnet"] },
  "azure-cosmosdb": { provider: "azurerm", resources: ["azurerm_cosmosdb_account", "azurerm_cosmosdb_sql_database"] },
};

module.exports = {
  async init(skill) { logger.info("[TerraformIaC] Initialized"); },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "generate": return handleGenerate(parsed.description);
        case "module": return handleModule(parsed.name);
        case "template": return handleTemplate(parsed.name);
        case "validate": return handleValidate(context);
        default: return { success: false, error: `Unknown action: ${parsed.action}` };
      }
    } catch (error) {
      logger.error("[TerraformIaC] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "template", name: "" };
  const parts = input.trim().split(/\s+/);
  return { action: (parts[0] || "generate").toLowerCase(), name: parts[1] || "", description: parts.slice(1).join(" ").replace(/"/g, "") };
}

function handleGenerate(description) {
  const lower = (description || "").toLowerCase();
  const provider = lower.includes("gcp") || lower.includes("google") ? "google" : lower.includes("azure") ? "azurerm" : "aws";
  const region = provider === "google" ? "us-central1" : provider === "azurerm" ? "eastus" : "us-east-1";

  const hcl = `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    ${provider} = {
      source  = "hashicorp/${provider}"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "${region}"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

provider "${provider}" {
  region = var.region
}

variable "region" {
  type    = string
  default = "${region}"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "project_name" {
  type    = string
  default = "my-project"
}

# TODO: Add resources for ${description}

locals {
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}
`;

  return { success: true, action: "generate", provider, region, hcl, message: `Terraform config generated for ${provider} (${region}).` };
}

function handleModule(name) {
  const moduleName = name || "example";
  const hcl = `# modules/${moduleName}/main.tf

variable "name" {
  type        = string
  description = "Resource name prefix"
}

variable "environment" {
  type        = string
  description = "Environment (dev/staging/prod)"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Additional tags"
}

# TODO: Add module resources

output "id" {
  value       = ""
  description = "Resource ID"
}

output "arn" {
  value       = ""
  description = "Resource ARN"
}
`;

  return { success: true, action: "module", name: moduleName, hcl, files: [`modules/${moduleName}/main.tf`, `modules/${moduleName}/variables.tf`, `modules/${moduleName}/outputs.tf`] };
}

function handleTemplate(name) {
  const tmpl = TEMPLATES[name];
  if (!tmpl) {
    return { success: true, action: "template", available: Object.keys(TEMPLATES), message: `Available: ${Object.keys(TEMPLATES).join(", ")}` };
  }
  return { success: true, action: "template", name, provider: tmpl.provider, resources: tmpl.resources, message: `Template "${name}" with ${tmpl.resources.length} resources.` };
}

function handleValidate(context) {
  return { success: true, action: "validate", command: "terraform validate", message: "Run `terraform validate` and `terraform plan` to verify." };
}

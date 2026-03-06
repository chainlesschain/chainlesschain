---
name: terraform-iac
display-name: Terraform IaC
description: Terraform and OpenTofu infrastructure as code best practices - generate HCL configurations, module patterns, state management, CI/CD workflows, and cloud provider templates for AWS, GCP, Azure
version: 1.0.0
category: development
user-invocable: true
tags: [terraform, iac, infrastructure, cloud, aws, gcp, azure, opentofu, hcl]
capabilities: [hcl-generation, module-patterns, state-management, cloud-templates, security-hardening]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [terraform-generate, terraform-validate, terraform-template]
instructions: |
  Use this skill for Terraform/OpenTofu infrastructure as code tasks.
  Generates HCL configurations, applies best practices for module patterns,
  state management, and security. Supports AWS, GCP, and Azure providers
  with production-ready templates.
examples:
  - input: "generate terraform for AWS ECS with RDS"
    action: generate
  - input: "create a reusable VPC module"
    action: module
  - input: "template for GCP GKE cluster"
    action: template
author: ChainlessChain
license: MIT
---

# Terraform IaC Skill

Infrastructure as code with Terraform/OpenTofu best practices.

## Usage

```
/terraform-iac generate "<infrastructure description>"
/terraform-iac module <module-name>
/terraform-iac template <cloud>-<service>
/terraform-iac validate [path]
```

## Best Practices Applied

- Remote state with locking (S3+DynamoDB / GCS / Azure Blob)
- Module composition pattern
- Proper variable typing and validation
- Output values for cross-module references
- Security group / IAM least privilege
- Tagging strategy
- Environment separation (dev/staging/prod)

## Cloud Templates

`aws-vpc` `aws-ecs` `aws-rds` `aws-lambda` `gcp-gke` `gcp-cloudsql` `azure-aks` `azure-cosmosdb`

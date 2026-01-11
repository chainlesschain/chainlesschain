# Plugin Marketplace Service - Deployment Guide

## Overview

This guide covers deployment options for the Plugin Marketplace Service, including Docker, Docker Compose, and Kubernetes.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+ (for local deployment)
- Kubernetes 1.24+ (for production deployment)
- kubectl configured
- Helm 3.0+ (optional, for easier K8s deployment)

## Quick Start with Docker Compose

### 1. Clone Repository

```bash
git clone https://github.com/chainlesschain/plugin-marketplace-service.git
cd plugin-marketplace-service
```

### 2. Configure Environment

Copy and edit the environment file:

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start Services

```bash
docker-compose up -d
```

This will start:
- PostgreSQL (port 5432)
- Redis (port 6379)
- MinIO (ports 9000, 9001)
- Marketplace Service (port 8090)
- Prometheus (port 9090)
- Grafana (port 3000)
- Elasticsearch (port 9200)
- Logstash (port 5000)
- Kibana (port 5601)

### 4. Verify Deployment

```bash
# Check service health
curl http://localhost:8090/actuator/health

# View logs
docker-compose logs -f marketplace-service

# Access Grafana dashboard
open http://localhost:3000
# Default credentials: admin/admin123

# Access Kibana
open http://localhost:5601
```

### 5. Initialize Database

The database schema is automatically initialized on first startup.

### 6. Create Admin User

```bash
# Connect to database
docker exec -it marketplace-postgres psql -U marketplace -d plugin_marketplace

# Create admin user
INSERT INTO users (did, username, email, role, created_at)
VALUES ('did:example:admin', 'admin', 'admin@example.com', 'admin', NOW());
```

## Production Deployment with Kubernetes

### 1. Prepare Kubernetes Cluster

Ensure you have a running Kubernetes cluster and kubectl configured.

### 2. Create Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

### 3. Configure Secrets

Edit `k8s/secret.yaml` with your production credentials:

```bash
# Generate base64 encoded secrets
echo -n "your-password" | base64

# Apply secrets
kubectl apply -f k8s/secret.yaml
```

### 4. Deploy Infrastructure

```bash
# Deploy PostgreSQL
kubectl apply -f k8s/postgres.yaml

# Deploy Redis
kubectl apply -f k8s/redis.yaml

# Deploy MinIO
kubectl apply -f k8s/minio.yaml

# Wait for infrastructure to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n plugin-marketplace --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n plugin-marketplace --timeout=300s
kubectl wait --for=condition=ready pod -l app=minio -n plugin-marketplace --timeout=300s
```

### 5. Deploy Application

```bash
# Apply ConfigMap
kubectl apply -f k8s/configmap.yaml

# Deploy application
kubectl apply -f k8s/deployment.yaml

# Wait for deployment
kubectl rollout status deployment/marketplace-service -n plugin-marketplace
```

### 6. Configure Ingress

Edit `k8s/ingress.yaml` with your domain:

```bash
kubectl apply -f k8s/ingress.yaml
```

### 7. Verify Deployment

```bash
# Check pods
kubectl get pods -n plugin-marketplace

# Check services
kubectl get services -n plugin-marketplace

# Check logs
kubectl logs -f deployment/marketplace-service -n plugin-marketplace

# Port forward for testing
kubectl port-forward svc/marketplace-service 8090:8090 -n plugin-marketplace
```

## Monitoring Setup

### Prometheus

Access Prometheus at `http://localhost:9090` (Docker Compose) or configure ingress for K8s.

Key metrics to monitor:
- `http_server_requests_seconds_count` - Request count
- `http_server_requests_seconds_sum` - Response time
- `jvm_memory_used_bytes` - Memory usage
- `process_cpu_usage` - CPU usage
- `hikaricp_connections_active` - Database connections

### Grafana

1. Access Grafana at `http://localhost:3000`
2. Login with admin/admin123
3. Add Prometheus data source: `http://prometheus:9090`
4. Import dashboard from `config/grafana/dashboards/`

### ELK Stack

1. Access Kibana at `http://localhost:5601`
2. Create index pattern: `marketplace-logs-*`
3. View logs in Discover tab

## Scaling

### Horizontal Pod Autoscaling (K8s)

HPA is automatically configured in `k8s/deployment.yaml`:

```yaml
minReplicas: 3
maxReplicas: 10
targetCPUUtilizationPercentage: 70
targetMemoryUtilizationPercentage: 80
```

### Manual Scaling

```bash
# Scale to 5 replicas
kubectl scale deployment marketplace-service --replicas=5 -n plugin-marketplace
```

## Backup and Recovery

### Database Backup

```bash
# Docker Compose
docker exec marketplace-postgres pg_dump -U marketplace plugin_marketplace > backup.sql

# Kubernetes
kubectl exec -n plugin-marketplace postgres-0 -- pg_dump -U marketplace plugin_marketplace > backup.sql
```

### Database Restore

```bash
# Docker Compose
docker exec -i marketplace-postgres psql -U marketplace plugin_marketplace < backup.sql

# Kubernetes
kubectl exec -i -n plugin-marketplace postgres-0 -- psql -U marketplace plugin_marketplace < backup.sql
```

### MinIO Backup

```bash
# Use MinIO client (mc)
mc mirror minio/plugins /backup/plugins
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
docker-compose logs marketplace-service
# or
kubectl logs -f deployment/marketplace-service -n plugin-marketplace

# Common issues:
# 1. Database connection failed - check credentials
# 2. Redis connection failed - check Redis is running
# 3. Port already in use - change port in config
```

### Database Connection Issues

```bash
# Test database connection
docker exec marketplace-postgres pg_isready -U marketplace

# Check database logs
docker-compose logs postgres
```

### High Memory Usage

```bash
# Adjust JVM options in docker-compose.yml or k8s/deployment.yaml
JAVA_OPTS: "-Xms512m -Xmx1024m -XX:+UseG1GC"
```

### Performance Issues

1. Check Prometheus metrics
2. Review slow query logs in PostgreSQL
3. Check Redis cache hit rate
4. Review application logs for errors

## Security Considerations

### Production Checklist

- [ ] Change all default passwords
- [ ] Use strong JWT secret (min 256 bits)
- [ ] Enable HTTPS/TLS
- [ ] Configure firewall rules
- [ ] Enable database encryption
- [ ] Set up regular backups
- [ ] Configure log retention
- [ ] Enable rate limiting
- [ ] Set up monitoring alerts
- [ ] Review security scan results

### SSL/TLS Configuration

For Kubernetes with cert-manager:

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer
kubectl apply -f k8s/cert-issuer.yaml

# Ingress will automatically request certificate
```

## Maintenance

### Update Application

```bash
# Docker Compose
docker-compose pull marketplace-service
docker-compose up -d marketplace-service

# Kubernetes
kubectl set image deployment/marketplace-service \
  marketplace-service=chainlesschain/plugin-marketplace-service:v1.1.0 \
  -n plugin-marketplace
```

### Database Migration

```bash
# Run Flyway migrations
mvn flyway:migrate

# Or use Liquibase
mvn liquibase:update
```

### Log Rotation

Logs are automatically rotated based on configuration in `application-prod.yml`:

```yaml
logging:
  file:
    max-size: 10MB
    max-history: 30
```

## Support

For issues and questions:
- GitHub Issues: https://github.com/chainlesschain/plugin-marketplace-service/issues
- Documentation: https://docs.chainlesschain.com
- Email: support@chainlesschain.com

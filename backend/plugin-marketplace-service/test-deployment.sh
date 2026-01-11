#!/bin/bash

# Plugin Marketplace Service - Docker Deployment Test Script
# This script tests the complete Docker deployment of the plugin marketplace service

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_URL="http://localhost:8090/api"
MINIO_URL="http://localhost:9000"
PROMETHEUS_URL="http://localhost:9090"
GRAFANA_URL="http://localhost:3000"

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a service is healthy
check_service() {
    local service_name=$1
    local url=$2
    local max_attempts=30
    local attempt=1

    print_info "Checking $service_name health..."

    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" > /dev/null 2>&1; then
            print_success "$service_name is healthy"
            return 0
        fi

        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    print_error "$service_name failed to become healthy"
    return 1
}

# Function to check Docker service status
check_docker_service() {
    local service_name=$1

    print_info "Checking Docker service: $service_name"

    if docker-compose ps | grep -q "$service_name.*Up"; then
        print_success "$service_name is running"
        return 0
    else
        print_error "$service_name is not running"
        return 1
    fi
}

# Function to test API endpoint
test_api_endpoint() {
    local endpoint=$1
    local method=${2:-GET}
    local expected_status=${3:-200}

    print_info "Testing $method $endpoint"

    response=$(curl -s -w "\n%{http_code}" -X "$method" "$SERVICE_URL$endpoint")
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$status_code" -eq "$expected_status" ]; then
        print_success "API endpoint $endpoint returned $status_code"
        return 0
    else
        print_error "API endpoint $endpoint returned $status_code (expected $expected_status)"
        echo "Response: $body"
        return 1
    fi
}

# Main test flow
main() {
    print_info "=========================================="
    print_info "Plugin Marketplace Docker Deployment Test"
    print_info "=========================================="
    echo ""

    # Step 1: Check if Docker is running
    print_info "Step 1: Checking Docker..."
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    print_success "Docker is running"
    echo ""

    # Step 2: Build and start services
    print_info "Step 2: Building and starting services..."
    cd "$SCRIPT_DIR"

    # Use docker-compose-test.yml for testing
    if [ -f "docker-compose-test.yml" ]; then
        print_info "Using docker-compose-test.yml for testing"
        docker-compose -f docker-compose-test.yml down -v 2>/dev/null || true
        docker-compose -f docker-compose-test.yml build --no-cache
        docker-compose -f docker-compose-test.yml up -d
    else
        print_info "Using docker-compose.yml"
        docker-compose down -v 2>/dev/null || true
        docker-compose build --no-cache
        docker-compose up -d
    fi

    print_success "Services started"
    echo ""

    # Step 3: Wait for services to be healthy
    print_info "Step 3: Waiting for services to be healthy..."
    sleep 10

    # Check PostgreSQL
    check_docker_service "marketplace-postgres" || exit 1

    # Check Redis
    check_docker_service "marketplace-redis" || exit 1

    # Check MinIO
    check_docker_service "marketplace-minio" || exit 1
    check_service "MinIO" "$MINIO_URL/minio/health/live" || exit 1

    # Check Marketplace Service
    check_docker_service "marketplace-service" || exit 1
    check_service "Marketplace Service" "$SERVICE_URL/actuator/health" || exit 1

    echo ""

    # Step 4: Test API endpoints
    print_info "Step 4: Testing API endpoints..."

    # Test health endpoint
    test_api_endpoint "/actuator/health" "GET" 200 || exit 1

    # Test categories endpoint
    test_api_endpoint "/categories" "GET" 200 || exit 1

    # Test plugins search endpoint
    test_api_endpoint "/plugins/search?keyword=test" "GET" 200 || exit 1

    # Test featured plugins endpoint
    test_api_endpoint "/plugins/featured" "GET" 200 || exit 1

    # Test popular plugins endpoint
    test_api_endpoint "/plugins/popular" "GET" 200 || exit 1

    echo ""

    # Step 5: Check monitoring services (if available)
    print_info "Step 5: Checking monitoring services..."

    if docker-compose ps | grep -q "marketplace-prometheus"; then
        check_service "Prometheus" "$PROMETHEUS_URL/-/healthy" || print_warning "Prometheus not available"
    fi

    if docker-compose ps | grep -q "marketplace-grafana"; then
        check_service "Grafana" "$GRAFANA_URL/api/health" || print_warning "Grafana not available"
    fi

    echo ""

    # Step 6: Display service information
    print_info "Step 6: Service Information"
    echo ""
    echo "=========================================="
    echo "Service URLs:"
    echo "=========================================="
    echo "Marketplace API:    $SERVICE_URL"
    echo "MinIO Console:      http://localhost:9001"
    echo "Prometheus:         $PROMETHEUS_URL"
    echo "Grafana:            $GRAFANA_URL (admin/admin123)"
    echo ""
    echo "=========================================="
    echo "Database Connection:"
    echo "=========================================="
    echo "Host:     localhost"
    echo "Port:     5432"
    echo "Database: plugin_marketplace"
    echo "User:     marketplace"
    echo "Password: marketplace_pwd_2024"
    echo ""
    echo "=========================================="
    echo "Redis Connection:"
    echo "=========================================="
    echo "Host:     localhost"
    echo "Port:     6379"
    echo "Password: marketplace_redis_2024"
    echo ""

    # Step 7: Display logs
    print_info "Step 7: Recent service logs"
    echo ""
    docker-compose logs --tail=20 marketplace-service
    echo ""

    # Final summary
    print_success "=========================================="
    print_success "All tests passed successfully!"
    print_success "=========================================="
    echo ""
    print_info "To view logs: docker-compose logs -f marketplace-service"
    print_info "To stop services: docker-compose down"
    print_info "To stop and remove volumes: docker-compose down -v"
    echo ""
}

# Cleanup function
cleanup() {
    print_warning "Cleaning up..."
    cd "$SCRIPT_DIR"
    if [ -f "docker-compose-test.yml" ]; then
        docker-compose -f docker-compose-test.yml down
    else
        docker-compose down
    fi
}

# Trap Ctrl+C and cleanup
trap cleanup EXIT

# Run main function
main

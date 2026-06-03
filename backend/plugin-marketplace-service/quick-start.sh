#!/bin/bash

# Quick Start Script for Plugin Marketplace Service
# This script provides quick commands for common operations

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Change to script directory
cd "$(dirname "$0")"

case "$1" in
    start)
        print_info "Starting Plugin Marketplace Service..."
        docker-compose -f docker-compose-test.yml up -d
        print_success "Services started. Use './quick-start.sh logs' to view logs"
        ;;

    stop)
        print_info "Stopping Plugin Marketplace Service..."
        docker-compose -f docker-compose-test.yml down
        print_success "Services stopped"
        ;;

    restart)
        print_info "Restarting Plugin Marketplace Service..."
        docker-compose -f docker-compose-test.yml restart marketplace-service
        print_success "Service restarted"
        ;;

    logs)
        docker-compose -f docker-compose-test.yml logs -f marketplace-service
        ;;

    build)
        print_info "Building Plugin Marketplace Service..."
        docker-compose -f docker-compose-test.yml build --no-cache marketplace-service
        print_success "Build completed"
        ;;

    rebuild)
        print_info "Rebuilding and restarting..."
        docker-compose -f docker-compose-test.yml down
        docker-compose -f docker-compose-test.yml build --no-cache marketplace-service
        docker-compose -f docker-compose-test.yml up -d
        print_success "Rebuild completed"
        ;;

    clean)
        print_info "Cleaning up all data..."
        docker-compose -f docker-compose-test.yml down -v
        print_success "All data cleaned"
        ;;

    status)
        print_info "Service Status:"
        docker-compose -f docker-compose-test.yml ps
        ;;

    test)
        print_info "Running deployment tests..."
        ./test-deployment.sh
        ;;

    db)
        print_info "Connecting to PostgreSQL..."
        docker exec -it marketplace-postgres psql -U marketplace -d plugin_marketplace
        ;;

    redis)
        print_info "Connecting to Redis..."
        docker exec -it marketplace-redis redis-cli -a marketplace_redis_2024
        ;;

    *)
        echo "Plugin Marketplace Service - Quick Start"
        echo ""
        echo "Usage: ./quick-start.sh [command]"
        echo ""
        echo "Commands:"
        echo "  start      - Start all services"
        echo "  stop       - Stop all services"
        echo "  restart    - Restart marketplace service"
        echo "  logs       - View service logs"
        echo "  build      - Build marketplace service"
        echo "  rebuild    - Rebuild and restart"
        echo "  clean      - Stop and remove all data"
        echo "  status     - Show service status"
        echo "  test       - Run deployment tests"
        echo "  db         - Connect to PostgreSQL"
        echo "  redis      - Connect to Redis"
        echo ""
        ;;
esac

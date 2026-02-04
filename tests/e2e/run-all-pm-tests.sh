#!/bin/bash

###############################################################################
# Run All Project Management E2E Tests
#
# This script runs all project management related E2E tests including:
# 1. Project Management Journey (33 tests)
# 2. Approval Workflow Journey (20+ tests)
# 3. Error Scenarios (30+ tests)
# 4. Performance & Stress Tests (15+ tests)
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       Project Management E2E Test Suite Runner             ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Test mode
TEST_MODE="${1:-normal}"
FAIL_FAST="${2:-false}"

# Test results tracking
declare -A test_results
declare -A test_durations
total_tests=0
passed_tests=0
failed_tests=0

# Function to run a test suite
run_test_suite() {
    local test_file=$1
    local test_name=$2

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running: ${test_name}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local start_time=$(date +%s)

    if npx playwright test "$test_file" --reporter=line; then
        test_results["$test_name"]="PASS"
        ((passed_tests++))
    else
        test_results["$test_name"]="FAIL"
        ((failed_tests++))

        if [ "$FAIL_FAST" == "true" ]; then
            echo -e "${RED}Test failed. Exiting due to --fail-fast${NC}"
            exit 1
        fi
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    test_durations["$test_name"]=$duration

    ((total_tests++))

    echo ""
}

# Build main process
echo -e "${YELLOW}→ Preparing environment...${NC}"
cd "$PROJECT_ROOT/desktop-app-vue"

if npm run build:main; then
    echo -e "${GREEN}✓ Main process built${NC}"
else
    echo -e "${RED}✗ Failed to build main process${NC}"
    exit 1
fi

# Install Playwright browsers
cd "$PROJECT_ROOT"
echo -e "${YELLOW}→ Installing Playwright browsers...${NC}"
npx playwright install chromium --with-deps --quiet || true

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                  Starting Test Execution                    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Run test suites
run_test_suite "tests/e2e/project-management-journey.e2e.test.ts" "1. Project Management Journey"
run_test_suite "tests/e2e/approval-workflow-journey.e2e.test.ts" "2. Approval Workflow Journey"
run_test_suite "tests/e2e/error-scenarios.e2e.test.ts" "3. Error Scenarios"
run_test_suite "tests/e2e/performance-stress.e2e.test.ts" "4. Performance & Stress Tests"

# Display results
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                     Test Results Summary                    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

for test_name in "${!test_results[@]}"; do
    result=${test_results[$test_name]}
    duration=${test_durations[$test_name]}

    if [ "$result" == "PASS" ]; then
        echo -e "  ${GREEN}✓${NC} $test_name ${CYAN}(${duration}s)${NC}"
    else
        echo -e "  ${RED}✗${NC} $test_name ${CYAN}(${duration}s)${NC}"
    fi
done

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

total_duration=0
for duration in "${test_durations[@]}"; do
    total_duration=$((total_duration + duration))
done

if [ $failed_tests -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo ""
    echo -e "  Total Suites: ${CYAN}${total_tests}${NC}"
    echo -e "  Passed: ${GREEN}${passed_tests}${NC}"
    echo -e "  Failed: ${CYAN}${failed_tests}${NC}"
    echo -e "  Total Duration: ${CYAN}${total_duration}s${NC}"
else
    echo -e "${RED}✗ Some tests failed${NC}"
    echo ""
    echo -e "  Total Suites: ${CYAN}${total_tests}${NC}"
    echo -e "  Passed: ${GREEN}${passed_tests}${NC}"
    echo -e "  Failed: ${RED}${failed_tests}${NC}"
    echo -e "  Total Duration: ${CYAN}${total_duration}s${NC}"
fi

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Test breakdown
echo -e "${YELLOW}Test Suite Breakdown:${NC}"
echo -e "  • Project Management Journey:  ${CYAN}33 tests${NC} (Full lifecycle)"
echo -e "  • Approval Workflow Journey:   ${CYAN}20+ tests${NC} (Sequential, Parallel, Any-One)"
echo -e "  • Error Scenarios:             ${CYAN}30+ tests${NC} (Edge cases, validation)"
echo -e "  • Performance & Stress:        ${CYAN}15+ tests${NC} (Bulk ops, concurrency)"
echo -e "  ${GREEN}Total: ~98+ individual test cases${NC}"
echo ""

# HTML Report
if [ -f "playwright-report/index.html" ]; then
    echo -e "${YELLOW}HTML Report:${NC} playwright-report/index.html"
    echo -e "  View with: ${BLUE}npx playwright show-report${NC}"
    echo ""
fi

# Usage
if [ "$TEST_MODE" == "--help" ] || [ "$1" == "-h" ]; then
    echo -e "${YELLOW}Usage:${NC}"
    echo -e "  ./run-all-pm-tests.sh [mode] [--fail-fast]"
    echo ""
    echo -e "${YELLOW}Modes:${NC}"
    echo -e "  ${BLUE}normal${NC}      - Run all tests in headless mode (default)"
    echo -e "  ${BLUE}headed${NC}      - Run with visible browser"
    echo -e "  ${BLUE}ui${NC}          - Run in interactive UI mode"
    echo ""
    echo -e "${YELLOW}Options:${NC}"
    echo -e "  ${BLUE}--fail-fast${NC} - Stop on first failure"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo -e "  ./run-all-pm-tests.sh"
    echo -e "  ./run-all-pm-tests.sh headed"
    echo -e "  ./run-all-pm-tests.sh normal --fail-fast"
    echo ""
fi

# Exit with appropriate code
if [ $failed_tests -eq 0 ]; then
    exit 0
else
    exit 1
fi

#!/bin/bash

###############################################################################
# Project Management Journey E2E Test Runner
#
# This script runs the comprehensive project management lifecycle test
# with proper setup and reporting.
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Project Management Journey E2E Test${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check Node.js version
echo -e "${YELLOW}→ Checking Node.js version...${NC}"
NODE_VERSION=$(node -v)
echo -e "  Node.js: $NODE_VERSION"

# Check if Playwright is installed
if ! command -v npx &> /dev/null; then
    echo -e "${RED}✗ npx not found. Please install Node.js and npm.${NC}"
    exit 1
fi

# Step 1: Build main process
echo ""
echo -e "${YELLOW}→ Step 1/4: Building Electron main process...${NC}"
cd "$PROJECT_ROOT/desktop-app-vue"

if [ -f "package.json" ]; then
    if npm run build:main; then
        echo -e "${GREEN}✓ Main process built successfully${NC}"
    else
        echo -e "${RED}✗ Failed to build main process${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ desktop-app-vue/package.json not found${NC}"
    exit 1
fi

# Step 2: Install Playwright browsers if needed
echo ""
echo -e "${YELLOW}→ Step 2/4: Checking Playwright browsers...${NC}"
cd "$PROJECT_ROOT"

if npx playwright install --help &> /dev/null; then
    echo -e "  Installing Playwright browsers (if not already installed)..."
    npx playwright install chromium --with-deps --quiet || true
    echo -e "${GREEN}✓ Playwright browsers ready${NC}"
else
    echo -e "${YELLOW}⚠ Playwright install command not available, skipping...${NC}"
fi

# Step 3: Run the test
echo ""
echo -e "${YELLOW}→ Step 3/4: Running E2E test...${NC}"
echo -e "  Test file: tests/e2e/project-management-journey.e2e.test.ts"
echo -e "  Coverage: 33 tests across 8 phases"
echo ""

# Determine test mode
TEST_MODE="${1:-normal}"

case "$TEST_MODE" in
    "ui")
        echo -e "${BLUE}  Mode: UI (Interactive)${NC}"
        npx playwright test tests/e2e/project-management-journey.e2e.test.ts --ui
        ;;
    "headed")
        echo -e "${BLUE}  Mode: Headed (Visible browser)${NC}"
        npx playwright test tests/e2e/project-management-journey.e2e.test.ts --headed
        ;;
    "debug")
        echo -e "${BLUE}  Mode: Debug (Step-by-step)${NC}"
        npx playwright test tests/e2e/project-management-journey.e2e.test.ts --debug
        ;;
    "report")
        echo -e "${BLUE}  Mode: Normal + HTML Report${NC}"
        npx playwright test tests/e2e/project-management-journey.e2e.test.ts --reporter=html
        ;;
    *)
        echo -e "${BLUE}  Mode: Normal (Headless)${NC}"
        npx playwright test tests/e2e/project-management-journey.e2e.test.ts
        ;;
esac

TEST_EXIT_CODE=$?

# Step 4: Generate report (if not in report mode)
if [ "$TEST_MODE" != "report" ] && [ $TEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${YELLOW}→ Step 4/4: Generating test report...${NC}"

    if npx playwright show-report --help &> /dev/null; then
        echo -e "  Report available at: playwright-report/index.html"
        echo -e "  To view: ${BLUE}npx playwright show-report${NC}"
    fi
fi

# Display results
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ Test completed successfully!${NC}"
    echo ""
    echo -e "  Test Coverage Summary:"
    echo -e "  • Phase 1: Organization & Team Setup (4 tests)"
    echo -e "  • Phase 2: Project Creation (3 tests)"
    echo -e "  • Phase 3: Task Board Creation (3 tests)"
    echo -e "  • Phase 4: Task Management (6 tests)"
    echo -e "  • Phase 5: Sprint Management (6 tests)"
    echo -e "  • Phase 6: Reports & Analytics (3 tests)"
    echo -e "  • Phase 7: Project Delivery (5 tests)"
    echo -e "  • Phase 8: Cleanup & Verification (3 tests)"
    echo -e "  ${GREEN}Total: 33 tests${NC}"
else
    echo -e "${RED}✗ Test failed with exit code: $TEST_EXIT_CODE${NC}"
    echo ""
    echo -e "  Troubleshooting tips:"
    echo -e "  1. Check if Electron app built correctly: ${BLUE}cd desktop-app-vue && npm run build:main${NC}"
    echo -e "  2. Verify database is initialized: ${BLUE}npm run init:db${NC}"
    echo -e "  3. Check IPC handlers are registered in src/main/index.js"
    echo -e "  4. Review test logs above for specific errors"
    echo -e "  5. Run in debug mode: ${BLUE}./run-pm-journey-test.sh debug${NC}"
fi

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Usage help
if [ "$TEST_MODE" == "--help" ] || [ "$1" == "-h" ]; then
    echo ""
    echo -e "${YELLOW}Usage:${NC}"
    echo -e "  ./run-pm-journey-test.sh [mode]"
    echo ""
    echo -e "${YELLOW}Modes:${NC}"
    echo -e "  ${BLUE}normal${NC}  - Run in headless mode (default)"
    echo -e "  ${BLUE}ui${NC}      - Run in interactive UI mode"
    echo -e "  ${BLUE}headed${NC}  - Run with visible browser"
    echo -e "  ${BLUE}debug${NC}   - Run in debug mode (step-by-step)"
    echo -e "  ${BLUE}report${NC}  - Run and generate HTML report"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo -e "  ./run-pm-journey-test.sh"
    echo -e "  ./run-pm-journey-test.sh ui"
    echo -e "  ./run-pm-journey-test.sh debug"
    echo ""
fi

exit $TEST_EXIT_CODE

#!/bin/bash

# Android App Release Automation Script
# Usage: ./release.sh [patch|minor|major]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_requirements() {
    log_info "Checking requirements..."

    if ! command -v git &> /dev/null; then
        log_error "git is not installed"
        exit 1
    fi

    if ! command -v gh &> /dev/null; then
        log_warn "GitHub CLI (gh) is not installed. GitHub release will be skipped."
        SKIP_GITHUB_RELEASE=true
    fi

    log_info "Requirements check passed"
}

# Parse current version
parse_version() {
    VERSION_FILE="$ROOT_DIR/version.properties"

    if [ ! -f "$VERSION_FILE" ]; then
        log_error "version.properties not found"
        exit 1
    fi

    CURRENT_VERSION=$(grep "VERSION_NAME=" "$VERSION_FILE" | cut -d'=' -f2)
    CURRENT_CODE=$(grep "VERSION_CODE=" "$VERSION_FILE" | cut -d'=' -f2)

    log_info "Current version: $CURRENT_VERSION ($CURRENT_CODE)"
}

# Bump version
bump_version() {
    BUMP_TYPE=${1:-patch}

    IFS='.' read -r -a VERSION_PARTS <<< "$CURRENT_VERSION"
    MAJOR="${VERSION_PARTS[0]}"
    MINOR="${VERSION_PARTS[1]}"
    PATCH="${VERSION_PARTS[2]}"

    case $BUMP_TYPE in
        major)
            MAJOR=$((MAJOR + 1))
            MINOR=0
            PATCH=0
            ;;
        minor)
            MINOR=$((MINOR + 1))
            PATCH=0
            ;;
        patch)
            PATCH=$((PATCH + 1))
            ;;
        *)
            log_error "Invalid bump type: $BUMP_TYPE"
            exit 1
            ;;
    esac

    NEW_VERSION="$MAJOR.$MINOR.$PATCH"
    NEW_CODE=$((CURRENT_CODE + 1))

    log_info "New version: $NEW_VERSION ($NEW_CODE)"

    # Update version.properties
    sed -i "s/VERSION_NAME=.*/VERSION_NAME=$NEW_VERSION/" "$VERSION_FILE"
    sed -i "s/VERSION_CODE=.*/VERSION_CODE=$NEW_CODE/" "$VERSION_FILE"

    # Append to history
    echo "# $NEW_VERSION ($NEW_CODE) - $(date +%Y-%m-%d)" >> "$VERSION_FILE"
}

# Run tests
run_tests() {
    log_info "Running tests..."

    cd "$ROOT_DIR"

    # Run lint
    log_info "Running lint..."
    ./gradlew lint

    # Run unit tests
    log_info "Running unit tests..."
    ./gradlew test

    log_info "Tests passed"
}

# Build release
build_release() {
    log_info "Building release..."

    cd "$ROOT_DIR"

    # Build APK
    log_info "Building release APK..."
    ./gradlew assembleRelease

    # Build App Bundle
    log_info "Building app bundle..."
    ./gradlew bundleRelease

    log_info "Build completed"

    # Show output locations
    APK_PATH="$ROOT_DIR/app/build/outputs/apk/release"
    BUNDLE_PATH="$ROOT_DIR/app/build/outputs/bundle/release"

    log_info "APK location: $APK_PATH"
    log_info "Bundle location: $BUNDLE_PATH"
}

# Create git tag
create_git_tag() {
    log_info "Creating git tag..."

    cd "$ROOT_DIR"

    TAG="v$NEW_VERSION"

    # Check if tag already exists
    if git rev-parse "$TAG" >/dev/null 2>&1; then
        log_error "Tag $TAG already exists"
        exit 1
    fi

    # Commit version changes
    git add version.properties
    git commit -m "chore: bump version to $NEW_VERSION

- Version code: $NEW_CODE
- Version name: $NEW_VERSION
"

    # Create tag
    git tag -a "$TAG" -m "Release $NEW_VERSION"

    log_info "Git tag $TAG created"
}

# Push to remote
push_to_remote() {
    log_info "Pushing to remote..."

    cd "$ROOT_DIR"

    # Push commits
    git push origin main

    # Push tags
    git push origin "$TAG"

    log_info "Pushed to remote"
}

# Create GitHub release
create_github_release() {
    if [ "$SKIP_GITHUB_RELEASE" = true ]; then
        log_warn "Skipping GitHub release (gh not installed)"
        return
    fi

    log_info "Creating GitHub release..."

    cd "$ROOT_DIR"

    APK_FILE=$(find app/build/outputs/apk/release -name "*.apk" | head -n 1)

    if [ -z "$APK_FILE" ]; then
        log_error "APK file not found"
        exit 1
    fi

    # Read changelog
    CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"
    if [ -f "$CHANGELOG_FILE" ]; then
        RELEASE_NOTES=$(cat "$CHANGELOG_FILE")
    else
        RELEASE_NOTES="Release $NEW_VERSION"
    fi

    # Create release
    gh release create "$TAG" \
        "$APK_FILE" \
        --title "Release $NEW_VERSION" \
        --notes "$RELEASE_NOTES"

    log_info "GitHub release created: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$TAG"
}

# Main function
main() {
    log_info "Starting Android release process..."

    # Get bump type from argument
    BUMP_TYPE=${1:-patch}

    # Run checks
    check_requirements
    parse_version
    bump_version "$BUMP_TYPE"

    # Confirm before proceeding
    echo ""
    log_warn "About to release version $NEW_VERSION ($NEW_CODE)"
    read -p "Continue? (y/n) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Release cancelled"
        exit 0
    fi

    # Run the release process
    run_tests
    build_release
    create_git_tag
    push_to_remote
    create_github_release

    log_info "Release completed successfully! 🎉"
    log_info "Version $NEW_VERSION is now available"
}

# Run main function
main "$@"

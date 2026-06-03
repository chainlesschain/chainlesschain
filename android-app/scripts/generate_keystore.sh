#!/bin/bash
# Android Release Keystore Generator for Linux/macOS
# This script generates a release keystore for signing Android APK/AAB files

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================================"
echo "Android Release Keystore Generator"
echo "============================================================"
echo ""

# Check if keytool is available
if ! command -v keytool &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} keytool not found. Please install Java JDK."
    echo ""
    echo "Install options:"
    echo "  macOS:   brew install openjdk"
    echo "  Ubuntu:  sudo apt install default-jdk"
    echo "  Fedora:  sudo dnf install java-latest-openjdk"
    exit 1
fi

echo -e "${GREEN}[INFO]${NC} keytool found"
echo ""

# Set keystore parameters
KEYSTORE_NAME="chainlesschain-release.jks"
KEY_ALIAS="chainlesschain"
KEY_ALG="RSA"
KEY_SIZE=2048
VALIDITY=10000

echo "Configuration:"
echo "  Keystore file: $KEYSTORE_NAME"
echo "  Key alias: $KEY_ALIAS"
echo "  Algorithm: $KEY_ALG"
echo "  Key size: $KEY_SIZE bits"
echo "  Validity: $VALIDITY days (~27 years)"
echo ""

# Check if keystore already exists
if [ -f "$KEYSTORE_NAME" ]; then
    echo -e "${YELLOW}[WARNING]${NC} Keystore already exists: $KEYSTORE_NAME"
    echo ""
    read -p "Do you want to overwrite it? (yes/no): " OVERWRITE
    if [ "$OVERWRITE" != "yes" ]; then
        echo -e "${GREEN}[INFO]${NC} Cancelled by user"
        exit 0
    fi
    echo ""
    echo -e "${GREEN}[INFO]${NC} Removing existing keystore..."
    rm "$KEYSTORE_NAME"
fi

echo "============================================================"
echo "Generating keystore..."
echo "============================================================"
echo ""
echo "You will be prompted for:"
echo "  1. Keystore password (store securely!)"
echo "  2. Your name / organization details"
echo "  3. Key password (can be same as keystore password)"
echo ""
echo -e "${YELLOW}IMPORTANT:${NC} Save these passwords in a password manager!"
echo "If you lose them, you cannot update your app in Play Store."
echo ""
read -p "Press Enter to continue..."

echo ""
echo "Generating keystore..."
echo ""

keytool -genkey -v \
  -keystore "$KEYSTORE_NAME" \
  -alias "$KEY_ALIAS" \
  -keyalg "$KEY_ALG" \
  -keysize "$KEY_SIZE" \
  -validity "$VALIDITY" \
  -storetype JKS

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR]${NC} Failed to generate keystore"
    exit 1
fi

echo ""
echo "============================================================"
echo "Keystore generated successfully!"
echo "============================================================"
echo ""
echo "File: $(pwd)/$KEYSTORE_NAME"
echo ""

# Verify keystore
echo "Verifying keystore..."
keytool -list -v -keystore "$KEYSTORE_NAME" -alias "$KEY_ALIAS"

echo ""
echo "============================================================"
echo "Next Steps:"
echo "============================================================"
echo ""
echo "1. Backup keystore to secure location(s):"
echo "   - Password manager (1Password, LastPass, etc.)"
echo "   - Encrypted cloud storage (Google Drive, Dropbox)"
echo "   - Hardware encrypted USB drive"
echo ""
echo "2. Encode keystore to Base64 for GitHub Secrets:"
echo ""
echo "   # Linux/macOS"
echo "   base64 -i $KEYSTORE_NAME -o keystore.base64"
echo ""
echo "   # Or copy to clipboard:"
echo "   # macOS:"
echo "   base64 -i $KEYSTORE_NAME | pbcopy"
echo "   # Linux:"
echo "   base64 -i $KEYSTORE_NAME | xclip -selection clipboard"
echo ""
echo "3. Add GitHub Secrets:"
echo "   - KEYSTORE_BASE64 (content of keystore.base64)"
echo "   - KEYSTORE_PASSWORD (your keystore password)"
echo "   - KEY_ALIAS (chainlesschain)"
echo "   - KEY_PASSWORD (your key password)"
echo ""
echo "4. See detailed guide:"
echo "   android-app/docs/ANDROID_SIGNING_SETUP.md"
echo ""
echo -e "${YELLOW}SECURITY WARNING:${NC}"
echo "- NEVER commit keystore to git"
echo "- NEVER share keystore via email/chat"
echo "- ALWAYS keep secure backups"
echo ""

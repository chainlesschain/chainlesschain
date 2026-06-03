# SoftHSM Docker Environment for PKCS#11 Testing
#
# Provides a software-based HSM (Hardware Security Module) simulation
# for testing PKCS#11 cryptographic operations without physical hardware.
#
# Features:
# - SoftHSM2 (software HSM implementation)
# - OpenSC tools (pkcs11-tool, pkcs15-tool)
# - Pre-configured test token with RSA keypair
# - Support for RSA-2048/4096, ECDSA, AES encryption

FROM ubuntu:22.04

LABEL maintainer="ChainlessChain Team"
LABEL description="SoftHSM test environment for PKCS#11 driver testing"
LABEL version="1.0.0"

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    softhsm2 \
    opensc \
    p11-kit \
    gnutls-bin \
    libengine-pkcs11-openssl \
    && rm -rf /var/lib/apt/lists/*

# Configure SoftHSM
ENV SOFTHSM2_CONF=/etc/softhsm/softhsm2.conf
RUN mkdir -p /var/lib/softhsm/tokens /etc/softhsm

# Create SoftHSM configuration
RUN echo "directories.tokendir = /var/lib/softhsm/tokens" > /etc/softhsm/softhsm2.conf && \
    echo "objectstore.backend = file" >> /etc/softhsm/softhsm2.conf && \
    echo "log.level = INFO" >> /etc/softhsm/softhsm2.conf

# Initialize test token
# - Label: TestToken
# - SO PIN: 1234 (Security Officer)
# - User PIN: 123456
RUN softhsm2-util --init-token \
    --slot 0 \
    --label "TestToken" \
    --so-pin 1234 \
    --pin 123456

# Generate RSA-2048 keypair for testing
RUN pkcs11-tool \
    --module /usr/lib/softhsm/libsofthsm2.so \
    --login \
    --pin 123456 \
    --keypairgen \
    --key-type rsa:2048 \
    --label "TestKey-RSA2048" \
    --id 01

# Generate RSA-4096 keypair for testing
RUN pkcs11-tool \
    --module /usr/lib/softhsm/libsofthsm2.so \
    --login \
    --pin 123456 \
    --keypairgen \
    --key-type rsa:4096 \
    --label "TestKey-RSA4096" \
    --id 02

# Generate ECDSA P-256 keypair for testing
RUN pkcs11-tool \
    --module /usr/lib/softhsm/libsofthsm2.so \
    --login \
    --pin 123456 \
    --keypairgen \
    --key-type EC:secp256r1 \
    --label "TestKey-ECDSA" \
    --id 03 || true

# Create test script for verification
RUN echo '#!/bin/bash\n\
echo "=== SoftHSM Token Information ==="\n\
softhsm2-util --show-slots\n\
echo ""\n\
echo "=== PKCS#11 Objects ==="\n\
pkcs11-tool --module /usr/lib/softhsm/libsofthsm2.so --login --pin 123456 --list-objects\n\
echo ""\n\
echo "=== Test Signature ==="\n\
echo "Hello, PKCS#11!" | pkcs11-tool --module /usr/lib/softhsm/libsofthsm2.so --login --pin 123456 --sign --id 01 --mechanism RSA-PKCS > /tmp/signature.bin\n\
echo "Signature created: $(stat -c%s /tmp/signature.bin) bytes"\n\
' > /usr/local/bin/test-softhsm.sh && chmod +x /usr/local/bin/test-softhsm.sh

# Expose SoftHSM module path for external access
ENV PKCS11_MODULE_PATH=/usr/lib/softhsm/libsofthsm2.so

# Set working directory
WORKDIR /workspace

# Default command: run test script
CMD ["/usr/local/bin/test-softhsm.sh"]

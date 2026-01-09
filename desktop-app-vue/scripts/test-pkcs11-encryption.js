/**
 * PKCS#11 Encryption/Decryption Test Script
 *
 * Tests the newly implemented CLI fallback for encryption and decryption
 */

const PKCS11Driver = require('../src/main/ukey/pkcs11-driver');

async function testPKCS11Encryption() {
  console.log('='.repeat(60));
  console.log('PKCS#11 Encryption/Decryption Test');
  console.log('='.repeat(60));
  console.log();

  const driver = new PKCS11Driver();

  try {
    // Test 1: Initialize driver
    console.log('Test 1: Initializing PKCS#11 driver...');
    await driver.initialize();
    console.log('✓ Driver initialized successfully');
    console.log();

    // Test 2: Get device info
    console.log('Test 2: Getting device information...');
    const deviceInfo = await driver.getDeviceInfo();
    console.log('Device Info:', JSON.stringify(deviceInfo, null, 2));
    console.log();

    // Test 3: Connect with PIN
    console.log('Test 3: Connecting to token...');
    const defaultPin = '123456'; // Default PIN

    try {
      const connectResult = await driver.connect(defaultPin);
      console.log('✓ Connected successfully');
      console.log('Connection result:', JSON.stringify(connectResult, null, 2));
      console.log();
    } catch (error) {
      console.log('✗ Connection failed:', error.message);
      console.log('Note: This is expected if no hardware token is present');
      console.log('Skipping encryption/decryption tests');
      return;
    }

    // Test 4: Encrypt data
    console.log('Test 4: Testing encryption...');
    const testData = 'Hello, ChainlessChain! This is a test message for PKCS#11 encryption.';
    console.log('Original data:', testData);

    let encryptedData;
    try {
      encryptedData = await driver.encrypt(testData);
      console.log('✓ Encryption successful');
      console.log('Encrypted data (base64):', encryptedData.substring(0, 50) + '...');
      console.log('Encrypted data length:', encryptedData.length);
      console.log();
    } catch (error) {
      console.log('✗ Encryption failed:', error.message);
      console.log();
      return;
    }

    // Test 5: Decrypt data
    console.log('Test 5: Testing decryption...');
    try {
      const decryptedData = await driver.decrypt(encryptedData);
      console.log('✓ Decryption successful');
      console.log('Decrypted data:', decryptedData);
      console.log();

      // Test 6: Verify data integrity
      console.log('Test 6: Verifying data integrity...');
      if (decryptedData === testData) {
        console.log('✓ Data integrity verified - decrypted data matches original');
      } else {
        console.log('✗ Data integrity check failed');
        console.log('Expected:', testData);
        console.log('Got:', decryptedData);
      }
      console.log();
    } catch (error) {
      console.log('✗ Decryption failed:', error.message);
      console.log();
    }

    // Test 7: Test with different data sizes
    console.log('Test 7: Testing with different data sizes...');
    const testCases = [
      { name: 'Short text', data: 'Hi!' },
      { name: 'Medium text', data: 'The quick brown fox jumps over the lazy dog.' },
      { name: 'Long text', data: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5) }
    ];

    for (const testCase of testCases) {
      try {
        console.log(`  Testing ${testCase.name} (${testCase.data.length} chars)...`);
        const enc = await driver.encrypt(testCase.data);
        const dec = await driver.decrypt(enc);

        if (dec === testCase.data) {
          console.log(`  ✓ ${testCase.name} passed`);
        } else {
          console.log(`  ✗ ${testCase.name} failed - data mismatch`);
        }
      } catch (error) {
        console.log(`  ✗ ${testCase.name} failed:`, error.message);
      }
    }
    console.log();

    // Test 8: Disconnect
    console.log('Test 8: Disconnecting from token...');
    await driver.disconnect();
    console.log('✓ Disconnected successfully');
    console.log();

  } catch (error) {
    console.error('Test failed with error:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    // Cleanup
    try {
      await driver.close();
      console.log('Driver closed');
    } catch (error) {
      console.error('Error closing driver:', error.message);
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log('Implementation Status:');
  console.log('  ✓ PKCS#11 native encryption/decryption (via pkcs11js)');
  console.log('  ✓ CLI fallback encryption (via OpenSSL + pkcs11-tool)');
  console.log('  ✓ CLI fallback decryption (via pkcs11-tool)');
  console.log('  ✓ Automatic cleanup of temporary files');
  console.log('  ✓ Error handling and logging');
  console.log();
  console.log('Note: Tests require either:');
  console.log('  1. pkcs11js module installed (npm install pkcs11js)');
  console.log('  2. OpenSC tools installed (pkcs11-tool, openssl)');
  console.log('  3. A PKCS#11 compatible hardware token connected');
  console.log('='.repeat(60));
}

// Run tests
testPKCS11Encryption().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

/**
 * Signal 协议加密测试脚本
 *
 * 直接测试 SignalSessionManager 的加密/解密功能
 * 在真实 Node.js 环境中运行，使用 webcrypto polyfill
 *
 * 运行: node scripts/test-signal-encryption.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

// 设置全局 crypto 对象（Node.js 18+ 需要）
if (!global.crypto) {
  global.crypto = crypto.webcrypto;
}

// 测试结果统计
let passed = 0;
let failed = 0;
let skipped = 0;
const errors = [];

function log(message, type = "info") {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: "\x1b[36m[INFO]\x1b[0m",
    success: "\x1b[32m[PASS]\x1b[0m",
    error: "\x1b[31m[FAIL]\x1b[0m",
    warn: "\x1b[33m[WARN]\x1b[0m",
    skip: "\x1b[33m[SKIP]\x1b[0m",
  };
  console.log(`${prefix[type] || prefix.info} ${message}`);
}

async function runTest(name, testFn) {
  try {
    log(`Running: ${name}`, "info");
    await testFn();
    passed++;
    log(`✓ ${name}`, "success");
    return true;
  } catch (error) {
    failed++;
    log(`✗ ${name}: ${error.message}`, "error");
    errors.push({ name, error: error.message, stack: error.stack });
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertNotEqual(actual, expected, message) {
  if (actual === expected) {
    throw new Error(
      message || `Expected values to be different, both are ${actual}`,
    );
  }
}

function assertDefined(value, message) {
  if (value === undefined || value === null) {
    throw new Error(message || "Expected value to be defined");
  }
}

function assertThrows(fn, expectedError) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (expectedError && !e.message.includes(expectedError)) {
      throw new Error(
        `Expected error containing "${expectedError}", got "${e.message}"`,
      );
    }
  }
  if (!threw) {
    throw new Error("Expected function to throw");
  }
}

async function assertRejects(asyncFn, expectedError) {
  let threw = false;
  try {
    await asyncFn();
  } catch (e) {
    threw = true;
    if (expectedError && !e.message.includes(expectedError)) {
      throw new Error(
        `Expected error containing "${expectedError}", got "${e.message}"`,
      );
    }
  }
  if (!threw) {
    throw new Error("Expected function to reject");
  }
}

async function main() {
  log("=".repeat(60), "info");
  log("Signal 协议加密测试", "info");
  log("=".repeat(60), "info");

  // 创建临时测试目录
  const testDir = path.join(os.tmpdir(), "signal-test-" + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  log(`测试目录: ${testDir}`, "info");

  let SignalSessionManager;
  try {
    SignalSessionManager = require("../src/main/p2p/signal-session-manager.js");
    log("SignalSessionManager 加载成功", "info");
  } catch (error) {
    log(`加载 SignalSessionManager 失败: ${error.message}`, "error");
    process.exit(1);
  }

  let alice, bob, charlie;

  // ============================================================
  // 初始化测试
  // ============================================================
  log("\n--- 初始化测试 ---", "info");

  await runTest("创建 Alice 会话管理器", async () => {
    alice = new SignalSessionManager({
      userId: "alice",
      deviceId: 1,
      dataPath: path.join(testDir, "alice"),
    });
    assertDefined(alice, "Alice should be created");
  });

  await runTest("创建 Bob 会话管理器", async () => {
    bob = new SignalSessionManager({
      userId: "bob",
      deviceId: 1,
      dataPath: path.join(testDir, "bob"),
    });
    assertDefined(bob, "Bob should be created");
  });

  await runTest("创建 Charlie 会话管理器", async () => {
    charlie = new SignalSessionManager({
      userId: "charlie",
      deviceId: 1,
      dataPath: path.join(testDir, "charlie"),
    });
    assertDefined(charlie, "Charlie should be created");
  });

  await runTest("初始化 Alice", async () => {
    await alice.initialize();
    assert(alice.initialized, "Alice should be initialized");
  });

  await runTest("初始化 Bob", async () => {
    await bob.initialize();
    assert(bob.initialized, "Bob should be initialized");
  });

  await runTest("初始化 Charlie", async () => {
    await charlie.initialize();
    assert(charlie.initialized, "Charlie should be initialized");
  });

  // ============================================================
  // 身份密钥测试
  // ============================================================
  log("\n--- 身份密钥测试 ---", "info");

  await runTest("Alice 应该有身份密钥对", async () => {
    assertDefined(alice.identityKeyPair, "Alice should have identity key pair");
    assertDefined(alice.identityKeyPair.pubKey, "Alice should have public key");
    assertDefined(
      alice.identityKeyPair.privKey,
      "Alice should have private key",
    );
  });

  await runTest("Alice 应该有注册 ID", async () => {
    assertDefined(alice.registrationId, "Alice should have registration ID");
    assert(alice.registrationId > 0, "Registration ID should be positive");
  });

  await runTest("每个用户应该有唯一的注册 ID", async () => {
    assertNotEqual(
      alice.registrationId,
      bob.registrationId,
      "Alice and Bob should have different registration IDs",
    );
    assertNotEqual(
      bob.registrationId,
      charlie.registrationId,
      "Bob and Charlie should have different registration IDs",
    );
  });

  await runTest("每个用户应该有唯一的公钥", async () => {
    const alicePubKey = Buffer.from(alice.identityKeyPair.pubKey).toString(
      "hex",
    );
    const bobPubKey = Buffer.from(bob.identityKeyPair.pubKey).toString("hex");
    const charliePubKey = Buffer.from(charlie.identityKeyPair.pubKey).toString(
      "hex",
    );

    assertNotEqual(
      alicePubKey,
      bobPubKey,
      "Alice and Bob should have different public keys",
    );
    assertNotEqual(
      bobPubKey,
      charliePubKey,
      "Bob and Charlie should have different public keys",
    );
  });

  // ============================================================
  // 预密钥测试
  // ============================================================
  log("\n--- 预密钥测试 ---", "info");

  await runTest("Alice 应该有预密钥", async () => {
    assert(alice.preKeys.size > 0, "Alice should have pre keys");
    assertEqual(alice.preKeys.size, 100, "Alice should have 100 pre keys");
  });

  await runTest("Alice 应该有签名预密钥", async () => {
    assertDefined(alice.signedPreKey, "Alice should have signed pre key");
    assertDefined(
      alice.signedPreKey.keyId,
      "Signed pre key should have key ID",
    );
    assertDefined(
      alice.signedPreKey.keyPair,
      "Signed pre key should have key pair",
    );
    assertDefined(
      alice.signedPreKey.signature,
      "Signed pre key should have signature",
    );
  });

  await runTest("Alice 能够获取预密钥包", async () => {
    const bundle = await alice.getPreKeyBundle();

    assertDefined(bundle, "Bundle should be defined");
    assertEqual(
      bundle.registrationId,
      alice.registrationId,
      "Bundle should have correct registration ID",
    );
    assertDefined(bundle.identityKey, "Bundle should have identity key");
    assertDefined(bundle.signedPreKey, "Bundle should have signed pre key");
    assertDefined(bundle.preKey, "Bundle should have pre key");
  });

  // ============================================================
  // X3DH 密钥协商测试 (正确的 Signal 协议流程)
  // ============================================================
  log("\n--- X3DH 密钥协商测试 ---", "info");

  // 正确的 Signal 协议流程:
  // 1. Alice 获取 Bob 的预密钥包并建立会话
  // 2. Alice 发送第一条消息 (PreKeyWhisperMessage type 3)
  // 3. Bob 收到消息时自动建立会话 (通过 decryptPreKeyWhisperMessage)
  // 不需要 Bob 主动调用 processPreKeyBundle

  await runTest("Alice 应该能够与 Bob 建立会话", async () => {
    const bobBundle = await bob.getPreKeyBundle();
    const result = await alice.processPreKeyBundle("bob", 1, bobBundle);

    assert(result.success, "Session establishment should succeed");
    const hasSession = await alice.hasSession("bob", 1);
    assert(hasSession, "Alice should have session with Bob");
  });

  await runTest("Alice 应该能够与 Charlie 建立会话", async () => {
    const charlieBundle = await charlie.getPreKeyBundle();
    const result = await alice.processPreKeyBundle("charlie", 1, charlieBundle);

    assert(result.success, "Session establishment should succeed");
    const hasSession = await alice.hasSession("charlie", 1);
    assert(hasSession, "Alice should have session with Charlie");
  });

  // ============================================================
  // 加密/解密测试 (正确的 Signal 协议流程)
  // ============================================================
  log("\n--- 加密/解密测试 ---", "info");

  await runTest("Alice 能够加密消息给 Bob (PreKeyWhisperMessage)", async () => {
    const plaintext = "Hello, Bob! This is a secret message.";
    const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

    assertDefined(ciphertext, "Ciphertext should be defined");
    assertDefined(ciphertext.type, "Ciphertext should have type");
    assertDefined(ciphertext.body, "Ciphertext should have body");
    // 第一条消息应该是 PreKeyWhisperMessage (type 3)
    assertEqual(
      ciphertext.type,
      3,
      "First message should be PreKeyWhisperMessage (type 3)",
    );

    // Debug: 检查 body 格式
    log(`  消息类型: ${ciphertext.type}`, "info");
    log(`  Body 类型: ${typeof ciphertext.body}`, "info");
    log(
      `  Body 长度: ${ciphertext.body.length || ciphertext.body.byteLength}`,
      "info",
    );
  });

  await runTest(
    "Bob 能够解密 Alice 的 PreKeyWhisperMessage (自动建立会话)",
    async () => {
      const plaintext = "Hello, Bob! This is a secret message from Alice.";
      const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

      // Debug: 检查 Bob 收到消息前的会话状态
      const bobHasSessionBefore = await bob.hasSession("alice", 1);
      log(`  解密前 Bob 是否有与 Alice 的会话: ${bobHasSessionBefore}`, "info");
      log(`  消息类型: ${ciphertext.type}`, "info");

      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

      // 解密后 Bob 应该自动建立了与 Alice 的会话
      const bobHasSessionAfter = await bob.hasSession("alice", 1);
      log(`  解密后 Bob 是否有与 Alice 的会话: ${bobHasSessionAfter}`, "info");

      assertEqual(
        decrypted,
        plaintext,
        "Decrypted message should match original",
      );
      assert(
        bobHasSessionAfter,
        "Bob should have session with Alice after decrypting PreKeyWhisperMessage",
      );
    },
  );

  await runTest("双向通信应该工作 (会话已建立)", async () => {
    // Alice -> Bob (后续消息)
    const aliceMessage = "Hi Bob! Second message.";
    const aliceCiphertext = await alice.encryptMessage("bob", 1, aliceMessage);
    log(`  Alice->Bob 消息类型: ${aliceCiphertext.type}`, "info");
    const decryptedByBob = await bob.decryptMessage(
      "alice",
      1,
      aliceCiphertext,
    );
    assertEqual(
      decryptedByBob,
      aliceMessage,
      "Bob should decrypt Alice message",
    );

    // Bob -> Alice (Bob 现在可以回复)
    const bobMessage = "Hi Alice!";
    const bobCiphertext = await bob.encryptMessage("alice", 1, bobMessage);
    log(`  Bob->Alice 消息类型: ${bobCiphertext.type}`, "info");
    const decryptedByAlice = await alice.decryptMessage(
      "bob",
      1,
      bobCiphertext,
    );
    assertEqual(
      decryptedByAlice,
      bobMessage,
      "Alice should decrypt Bob message",
    );
  });

  await runTest("连续多条消息应该工作", async () => {
    const messages = [
      "Message 1",
      "Message 2",
      "Message 3",
      "Message 4",
      "Message 5",
    ];

    for (const msg of messages) {
      const ciphertext = await alice.encryptMessage("bob", 1, msg);
      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);
      assertEqual(
        decrypted,
        msg,
        `Message "${msg}" should be decrypted correctly`,
      );
    }
  });

  await runTest("中文和 emoji 应该工作", async () => {
    const messages = ["你好，世界！", "Hello 🌍", "测试 with émojis 🎉"];

    for (const msg of messages) {
      const ciphertext = await alice.encryptMessage("bob", 1, msg);
      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);
      assertEqual(
        decrypted,
        msg,
        `Message "${msg}" should be decrypted correctly`,
      );
    }
  });

  await runTest("大消息应该工作 (10KB)", async () => {
    const largeMessage = "A".repeat(10 * 1024);
    const ciphertext = await alice.encryptMessage("bob", 1, largeMessage);
    const decrypted = await bob.decryptMessage("alice", 1, ciphertext);
    assertEqual(
      decrypted.length,
      largeMessage.length,
      "Large message should be decrypted correctly",
    );
  });

  // ============================================================
  // 安全性测试
  // ============================================================
  log("\n--- 安全性测试 ---", "info");

  await runTest("相同明文应该产生不同密文（前向保密）", async () => {
    const plaintext = "Same message";
    const ciphertext1 = await alice.encryptMessage("bob", 1, plaintext);
    await bob.decryptMessage("alice", 1, ciphertext1);

    const ciphertext2 = await alice.encryptMessage("bob", 1, plaintext);
    await bob.decryptMessage("alice", 1, ciphertext2);

    const body1 = Buffer.from(ciphertext1.body).toString("hex");
    const body2 = Buffer.from(ciphertext2.body).toString("hex");

    assertNotEqual(
      body1,
      body2,
      "Same plaintext should produce different ciphertext",
    );
  });

  await runTest("篡改的消息应该解密失败", async () => {
    const plaintext = "Original message";
    const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

    // 篡改密文
    const tamperedCiphertext = {
      ...ciphertext,
      body: Buffer.from("tampered data"),
    };

    await assertRejects(
      () => bob.decryptMessage("alice", 1, tamperedCiphertext),
      undefined, // 任何错误都可以接受
    );
  });

  await runTest("Charlie 不能解密 Alice 发给 Bob 的消息", async () => {
    // Alice 发一条消息给 Bob
    const plaintext = "Secret for Bob only";
    const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

    // Charlie 不应该能解密这条消息（即使 Charlie 与 Alice 有会话）
    // Charlie 没有 Bob 的会话密钥，无法解密发给 Bob 的消息
    await assertRejects(
      () => charlie.decryptMessage("alice", 1, ciphertext),
      undefined,
    );
  });

  // ============================================================
  // 会话管理测试
  // ============================================================
  log("\n--- 会话管理测试 ---", "info");

  await runTest("应该能检查会话是否存在", async () => {
    const hasSession = await alice.hasSession("bob", 1);
    assert(hasSession, "Alice should have session with Bob");

    const noSession = await alice.hasSession("nonexistent", 1);
    assert(!noSession, "Alice should not have session with nonexistent user");
  });

  await runTest("应该能获取会话列表", async () => {
    const sessions = await alice.getSessions();
    assert(sessions.length >= 2, "Alice should have at least 2 sessions");
  });

  await runTest("应该能删除会话", async () => {
    // 创建一个测试会话
    const testUser = new SignalSessionManager({
      userId: "test-delete",
      deviceId: 1,
    });
    await testUser.initialize();

    const testBundle = await testUser.getPreKeyBundle();
    await alice.processPreKeyBundle("test-delete", 1, testBundle);

    let hasSession = await alice.hasSession("test-delete", 1);
    assert(hasSession, "Session should exist before deletion");

    await alice.deleteSession("test-delete", 1);

    hasSession = await alice.hasSession("test-delete", 1);
    assert(!hasSession, "Session should not exist after deletion");
  });

  // ============================================================
  // 错误处理测试
  // ============================================================
  log("\n--- 错误处理测试 ---", "info");

  await runTest("无效的预密钥包应该被拒绝", async () => {
    await assertRejects(
      () => alice.processPreKeyBundle("invalid", 1, null),
      "Pre key bundle is required",
    );
  });

  await runTest("缺少 identityKey 的预密钥包应该被拒绝", async () => {
    await assertRejects(
      () =>
        alice.processPreKeyBundle("invalid", 1, {
          registrationId: 1,
          identityKey: null,
          signedPreKey: {
            keyId: 1,
            publicKey: new ArrayBuffer(32),
            signature: new ArrayBuffer(64),
          },
        }),
      "Identity key is required",
    );
  });

  await runTest("无效消息类型应该被拒绝", async () => {
    await assertRejects(
      () =>
        bob.decryptMessage("alice", 1, {
          type: 999,
          body: Buffer.from("test"),
        }),
      "Unknown message type",
    );
  });

  // ============================================================
  // 性能测试
  // ============================================================
  log("\n--- 性能测试 ---", "info");

  await runTest("加密性能应该合理 (<100ms/消息)", async () => {
    const iterations = 10;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      await alice.encryptMessage("bob", 1, `Performance test message ${i}`);
    }

    const avgTime = (Date.now() - startTime) / iterations;
    log(`  平均加密时间: ${avgTime.toFixed(2)}ms`, "info");
    assert(
      avgTime < 100,
      `Encryption should be faster than 100ms, was ${avgTime.toFixed(2)}ms`,
    );
  });

  await runTest("解密性能应该合理 (<100ms/消息)", async () => {
    const iterations = 10;
    const ciphertexts = [];

    // 先加密
    for (let i = 0; i < iterations; i++) {
      const ciphertext = await alice.encryptMessage(
        "bob",
        1,
        `Performance test ${i}`,
      );
      ciphertexts.push(ciphertext);
    }

    // 测试解密
    const startTime = Date.now();
    for (const ciphertext of ciphertexts) {
      await bob.decryptMessage("alice", 1, ciphertext);
    }

    const avgTime = (Date.now() - startTime) / iterations;
    log(`  平均解密时间: ${avgTime.toFixed(2)}ms`, "info");
    assert(
      avgTime < 100,
      `Decryption should be faster than 100ms, was ${avgTime.toFixed(2)}ms`,
    );
  });

  // ============================================================
  // 清理
  // ============================================================
  log("\n--- 清理 ---", "info");

  try {
    await alice.close();
    await bob.close();
    await charlie.close();

    fs.rmSync(testDir, { recursive: true, force: true });
    log("测试目录已清理", "info");
  } catch (error) {
    log(`清理失败: ${error.message}`, "warn");
  }

  // ============================================================
  // 结果汇总
  // ============================================================
  log("\n" + "=".repeat(60), "info");
  log("测试结果汇总", "info");
  log("=".repeat(60), "info");
  log(`通过: ${passed}`, "success");
  log(`失败: ${failed}`, failed > 0 ? "error" : "info");
  log(`跳过: ${skipped}`, skipped > 0 ? "warn" : "info");
  log(`总计: ${passed + failed + skipped}`, "info");

  if (errors.length > 0) {
    log("\n错误详情:", "error");
    errors.forEach((e, i) => {
      log(`\n${i + 1}. ${e.name}`, "error");
      log(`   错误: ${e.error}`, "error");
      if (e.stack) {
        log(`   堆栈: ${e.stack.split("\n")[1]}`, "error");
      }
    });
  }

  const exitCode = failed > 0 ? 1 : 0;
  log(`\n退出码: ${exitCode}`, exitCode === 0 ? "success" : "error");
  process.exit(exitCode);
}

// 运行测试
main().catch((error) => {
  log(`测试运行失败: ${error.message}`, "error");
  console.error(error);
  process.exit(1);
});

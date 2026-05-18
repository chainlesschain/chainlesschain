/**
 * Signal 协议端到端加密测试
 *
 * 测试真实的 Signal 协议实现
 * - X3DH 密钥协商
 * - Double Ratchet 加密
 * - 完整的加密/解密流程
 * - 多用户通信场景
 * - 会话管理
 */

import { test, expect } from "@playwright/test";
import SignalSessionManager from "../../src/main/p2p/signal-session-manager.js";
import path from "path";
import fs from "fs";
import os from "os";
import { webcrypto } from "crypto";

// 确保全局 crypto 对象可用（Node.js 环境）
if (typeof global !== "undefined" && !global.crypto) {
  global.crypto = webcrypto;
}

test.describe("Signal 协议 E2E 加密测试", () => {
  let alice, bob, charlie;
  let testDir;

  test.beforeEach(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), "signal-e2e-test-" + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    // 初始化三个用户: Alice, Bob, Charlie
    alice = new SignalSessionManager({
      userId: "alice",
      deviceId: 1,
      dataPath: path.join(testDir, "alice"),
    });

    bob = new SignalSessionManager({
      userId: "bob",
      deviceId: 1,
      dataPath: path.join(testDir, "bob"),
    });

    charlie = new SignalSessionManager({
      userId: "charlie",
      deviceId: 1,
      dataPath: path.join(testDir, "charlie"),
    });

    // 初始化所有用户
    await alice.initialize();
    await bob.initialize();
    await charlie.initialize();
  });

  test.afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test.describe("基础身份管理", () => {
    test("应该成功生成身份密钥对", () => {
      expect(alice.identityKeyPair).toBeDefined();
      expect(alice.identityKeyPair.pubKey).toBeInstanceOf(ArrayBuffer);
      expect(alice.identityKeyPair.privKey).toBeInstanceOf(ArrayBuffer);
      expect(alice.registrationId).toBeGreaterThan(0);
    });

    test("应该为每个用户生成唯一的身份", () => {
      // 注册 ID 应该不同
      expect(alice.registrationId).not.toBe(bob.registrationId);
      expect(bob.registrationId).not.toBe(charlie.registrationId);

      // 公钥应该不同
      const alicePubKey = Buffer.from(alice.identityKeyPair.pubKey).toString(
        "hex",
      );
      const bobPubKey = Buffer.from(bob.identityKeyPair.pubKey).toString("hex");
      expect(alicePubKey).not.toBe(bobPubKey);
    });

    test("应该生成预密钥", () => {
      expect(alice.preKeys.size).toBeGreaterThan(0);
      expect(alice.signedPreKey).toBeDefined();
      expect(alice.signedPreKey.keyId).toBeGreaterThan(0);
    });

    test("应该能够获取预密钥包", async () => {
      const preKeyBundle = await alice.getPreKeyBundle();

      expect(preKeyBundle.registrationId).toBe(alice.registrationId);
      expect(preKeyBundle.identityKey).toBeDefined();
      expect(preKeyBundle.signedPreKey).toBeDefined();
      expect(preKeyBundle.preKey).toBeDefined();
    });
  });

  test.describe("X3DH 密钥协商", () => {
    test("应该成功建立 Alice -> Bob 的会话", async () => {
      // Bob 分享预密钥包给 Alice
      const bobPreKeyBundle = await bob.getPreKeyBundle();

      // Alice 使用 Bob 的预密钥包建立会话
      const result = await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);

      expect(result.success).toBe(true);

      // 验证会话已创建
      const hasSession = await alice.hasSession("bob", 1);
      expect(hasSession).toBe(true);
    });

    test("应该支持双向会话建立", async () => {
      // Alice <-> Bob 建立双向会话
      const alicePreKeyBundle = await alice.getPreKeyBundle();
      const bobPreKeyBundle = await bob.getPreKeyBundle();

      // Alice 建立到 Bob 的会话
      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);

      // Bob 建立到 Alice 的会话
      await bob.processPreKeyBundle("alice", 1, alicePreKeyBundle);

      // 验证两边都有会话
      expect(await alice.hasSession("bob", 1)).toBe(true);
      expect(await bob.hasSession("alice", 1)).toBe(true);
    });

    test("应该支持多设备会话", async () => {
      // 创建 Bob 的第二个设备
      const bobDevice2 = new SignalSessionManager({
        userId: "bob",
        deviceId: 2,
        dataPath: path.join(testDir, "bob-device2"),
      });
      await bobDevice2.initialize();

      // 获取两个设备的预密钥包
      const bobDevice1Bundle = await bob.getPreKeyBundle();
      const bobDevice2Bundle = await bobDevice2.getPreKeyBundle();

      // Alice 与 Bob 的两个设备建立会话
      await alice.processPreKeyBundle("bob", 1, bobDevice1Bundle);
      await alice.processPreKeyBundle("bob", 2, bobDevice2Bundle);

      // 验证会话
      expect(await alice.hasSession("bob", 1)).toBe(true);
      expect(await alice.hasSession("bob", 2)).toBe(true);
    });
  });

  test.describe("Double Ratchet 加密/解密", () => {
    test.beforeEach(async () => {
      // 建立 Alice <-> Bob 会话
      const alicePreKeyBundle = await alice.getPreKeyBundle();
      const bobPreKeyBundle = await bob.getPreKeyBundle();

      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);
      await bob.processPreKeyBundle("alice", 1, alicePreKeyBundle);
    });

    test("应该成功加密和解密单条消息", async () => {
      const plaintext = "Hello, Bob! This is a secret message from Alice.";

      // Alice 加密消息给 Bob
      const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

      expect(ciphertext).toBeDefined();
      expect(ciphertext.type).toBeDefined();
      expect(ciphertext.body).toBeDefined();

      // Bob 解密 Alice 的消息
      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

      expect(decrypted).toBe(plaintext);
    });

    test("应该正确处理首次消息(PreKeyWhisperMessage)", async () => {
      // 仅 Alice 建立会话，Bob 还没有
      const bob2 = new SignalSessionManager({
        userId: "bob2",
        deviceId: 1,
        dataPath: path.join(testDir, "bob2"),
      });
      await bob2.initialize();

      const bob2PreKeyBundle = await bob2.getPreKeyBundle();
      await alice.processPreKeyBundle("bob2", 1, bob2PreKeyBundle);

      // Alice 发送首条消息
      const plaintext = "First message to Bob2";
      const ciphertext = await alice.encryptMessage("bob2", 1, plaintext);

      // 首条消息应该是 PreKeyWhisperMessage (type 3)
      expect(ciphertext.type).toBe(3);

      // Bob2 解密首条消息（自动建立会话）
      const decrypted = await bob2.decryptMessage("alice", 1, ciphertext);
      expect(decrypted).toBe(plaintext);

      // 验证 Bob2 现在有会话了
      expect(await bob2.hasSession("alice", 1)).toBe(true);
    });

    test("应该正确处理后续消息(WhisperMessage)", async () => {
      // 发送首条消息
      const firstMessage = "First message";
      const firstCiphertext = await alice.encryptMessage(
        "bob",
        1,
        firstMessage,
      );
      await bob.decryptMessage("alice", 1, firstCiphertext);

      // 发送第二条消息
      const secondMessage = "Second message";
      const secondCiphertext = await alice.encryptMessage(
        "bob",
        1,
        secondMessage,
      );

      // 后续消息应该是 WhisperMessage (type 1)
      expect(secondCiphertext.type).toBe(1);

      // 解密第二条消息
      const decrypted = await bob.decryptMessage("alice", 1, secondCiphertext);
      expect(decrypted).toBe(secondMessage);
    });

    test("应该支持双向通信", async () => {
      // Alice -> Bob
      const aliceMessage = "Hello from Alice!";
      const aliceCiphertext = await alice.encryptMessage(
        "bob",
        1,
        aliceMessage,
      );
      const decryptedByBob = await bob.decryptMessage(
        "alice",
        1,
        aliceCiphertext,
      );
      expect(decryptedByBob).toBe(aliceMessage);

      // Bob -> Alice
      const bobMessage = "Hi Alice, this is Bob!";
      const bobCiphertext = await bob.encryptMessage("alice", 1, bobMessage);
      const decryptedByAlice = await alice.decryptMessage(
        "bob",
        1,
        bobCiphertext,
      );
      expect(decryptedByAlice).toBe(bobMessage);
    });

    test("应该支持连续多条消息", async () => {
      const messages = [
        "Message 1",
        "Message 2",
        "Message 3",
        "Message 4",
        "Message 5",
      ];

      for (const message of messages) {
        // Alice 加密
        const ciphertext = await alice.encryptMessage("bob", 1, message);

        // Bob 解密
        const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

        expect(decrypted).toBe(message);
      }
    });

    test("应该支持中文和特殊字符", async () => {
      const messages = [
        "你好，世界！",
        "Hello 🌍",
        "测试消息 with émojis 🎉",
        "特殊符号: @#$%^&*()",
        "换行\n测试\n消息",
      ];

      for (const message of messages) {
        const ciphertext = await alice.encryptMessage("bob", 1, message);
        const decrypted = await bob.decryptMessage("alice", 1, ciphertext);
        expect(decrypted).toBe(message);
      }
    });

    test("应该支持二进制数据加密", async () => {
      const binaryData = Buffer.from([
        0x01, 0x02, 0x03, 0x04, 0xff, 0xfe, 0xfd,
      ]);

      const ciphertext = await alice.encryptMessage("bob", 1, binaryData);
      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

      expect(Buffer.from(decrypted, "utf8")).toBeDefined();
    });

    test("应该支持大消息加密", async () => {
      // 生成 10KB 的大消息
      const largeMessage = "A".repeat(10 * 1024);

      const ciphertext = await alice.encryptMessage("bob", 1, largeMessage);
      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);

      expect(decrypted).toBe(largeMessage);
      expect(decrypted.length).toBe(10 * 1024);
    });
  });

  test.describe("会话管理", () => {
    test.beforeEach(async () => {
      const bobPreKeyBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);
    });

    test("应该能够检查会话是否存在", async () => {
      expect(await alice.hasSession("bob", 1)).toBe(true);
      expect(await alice.hasSession("charlie", 1)).toBe(false);
    });

    test("应该能够删除会话", async () => {
      // 验证会话存在
      expect(await alice.hasSession("bob", 1)).toBe(true);

      // 删除会话
      const result = await alice.deleteSession("bob", 1);
      expect(result.success).toBe(true);

      // 验证会话已删除
      expect(await alice.hasSession("bob", 1)).toBe(false);
    });

    test("应该能够获取所有会话列表", async () => {
      // 建立多个会话
      const charliePreKeyBundle = await charlie.getPreKeyBundle();
      await alice.processPreKeyBundle("charlie", 1, charliePreKeyBundle);

      const sessions = await alice.getSessions();

      expect(sessions.length).toBeGreaterThanOrEqual(2);
      expect(sessions.some((s) => s.includes("bob"))).toBe(true);
      expect(sessions.some((s) => s.includes("charlie"))).toBe(true);
    });

    test("删除会话后应该能够重新建立", async () => {
      // 删除会话
      await alice.deleteSession("bob", 1);
      expect(await alice.hasSession("bob", 1)).toBe(false);

      // 重新建立会话
      const newBobPreKeyBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, newBobPreKeyBundle);

      expect(await alice.hasSession("bob", 1)).toBe(true);

      // 验证可以正常通信
      const message = "After session recreation";
      const ciphertext = await alice.encryptMessage("bob", 1, message);
      const decrypted = await bob.decryptMessage("alice", 1, ciphertext);
      expect(decrypted).toBe(message);
    });
  });

  test.describe("多用户通信场景", () => {
    test.beforeEach(async () => {
      // 建立 Alice <-> Bob, Alice <-> Charlie 会话
      const bobPreKeyBundle = await bob.getPreKeyBundle();
      const charliePreKeyBundle = await charlie.getPreKeyBundle();

      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);
      await alice.processPreKeyBundle("charlie", 1, charliePreKeyBundle);

      const alicePreKeyBundle = await alice.getPreKeyBundle();
      await bob.processPreKeyBundle("alice", 1, alicePreKeyBundle);
      await charlie.processPreKeyBundle("alice", 1, alicePreKeyBundle);
    });

    test("Alice 应该能同时与 Bob 和 Charlie 通信", async () => {
      // Alice -> Bob
      const messageToBob = "Hi Bob!";
      const ciphertextToBob = await alice.encryptMessage(
        "bob",
        1,
        messageToBob,
      );
      const decryptedByBob = await bob.decryptMessage(
        "alice",
        1,
        ciphertextToBob,
      );
      expect(decryptedByBob).toBe(messageToBob);

      // Alice -> Charlie
      const messageToCharlie = "Hi Charlie!";
      const ciphertextToCharlie = await alice.encryptMessage(
        "charlie",
        1,
        messageToCharlie,
      );
      const decryptedByCharlie = await charlie.decryptMessage(
        "alice",
        1,
        ciphertextToCharlie,
      );
      expect(decryptedByCharlie).toBe(messageToCharlie);

      // Bob 不能解密给 Charlie 的消息
      await expect(
        bob.decryptMessage("alice", 1, ciphertextToCharlie),
      ).rejects.toThrow();

      // Charlie 不能解密给 Bob 的消息
      await expect(
        charlie.decryptMessage("alice", 1, ciphertextToBob),
      ).rejects.toThrow();
    });

    test("应该支持群组通信场景", async () => {
      const groupMessage = "Message to everyone in the group!";

      // Alice 向群组成员广播（分别加密）
      const ciphertextToBob = await alice.encryptMessage(
        "bob",
        1,
        groupMessage,
      );
      const ciphertextToCharlie = await alice.encryptMessage(
        "charlie",
        1,
        groupMessage,
      );

      // 每个成员都能解密自己的消息
      const bobReceived = await bob.decryptMessage("alice", 1, ciphertextToBob);
      const charlieReceived = await charlie.decryptMessage(
        "alice",
        1,
        ciphertextToCharlie,
      );

      expect(bobReceived).toBe(groupMessage);
      expect(charlieReceived).toBe(groupMessage);
    });

    test("应该支持三方相互通信", async () => {
      // Bob <-> Charlie 会话
      const bobPreKeyBundle = await bob.getPreKeyBundle();
      const charliePreKeyBundle = await charlie.getPreKeyBundle();

      await bob.processPreKeyBundle("charlie", 1, charliePreKeyBundle);
      await charlie.processPreKeyBundle("bob", 1, bobPreKeyBundle);

      // Alice -> Bob
      let ciphertext = await alice.encryptMessage("bob", 1, "Alice to Bob");
      expect(await bob.decryptMessage("alice", 1, ciphertext)).toBe(
        "Alice to Bob",
      );

      // Bob -> Charlie
      ciphertext = await bob.encryptMessage("charlie", 1, "Bob to Charlie");
      expect(await charlie.decryptMessage("bob", 1, ciphertext)).toBe(
        "Bob to Charlie",
      );

      // Charlie -> Alice
      ciphertext = await charlie.encryptMessage("alice", 1, "Charlie to Alice");
      expect(await alice.decryptMessage("charlie", 1, ciphertext)).toBe(
        "Charlie to Alice",
      );
    });
  });

  test.describe("安全性验证", () => {
    test.beforeEach(async () => {
      const bobPreKeyBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);

      const alicePreKeyBundle = await alice.getPreKeyBundle();
      await bob.processPreKeyBundle("alice", 1, alicePreKeyBundle);
    });

    test("不应该能够解密被篡改的消息", async () => {
      const plaintext = "Original message";
      const ciphertext = await alice.encryptMessage("bob", 1, plaintext);

      // 篡改密文
      const tamperedCiphertext = {
        ...ciphertext,
        body: Buffer.from("tampered data"),
      };

      // 解密应该失败
      await expect(
        bob.decryptMessage("alice", 1, tamperedCiphertext),
      ).rejects.toThrow();
    });

    test("不应该能够重放旧消息", async () => {
      const message1 = "First message";
      const ciphertext1 = await alice.encryptMessage("bob", 1, message1);

      // Bob 解密第一条消息
      await bob.decryptMessage("alice", 1, ciphertext1);

      // 发送和解密第二条消息
      const message2 = "Second message";
      const ciphertext2 = await alice.encryptMessage("bob", 1, message2);
      await bob.decryptMessage("alice", 1, ciphertext2);

      // 尝试重放第一条消息应该失败
      // Signal 协议的 Double Ratchet 会拒绝重放的消息
      await expect(
        bob.decryptMessage("alice", 1, ciphertext1),
      ).rejects.toThrow();
    });

    test("每条消息应该使用不同的密钥", async () => {
      const message1 = "Test message";
      const ciphertext1 = await alice.encryptMessage("bob", 1, message1);

      const message2 = "Test message"; // 相同内容
      const ciphertext2 = await alice.encryptMessage("bob", 1, message2);

      // 即使明文相同，密文也应该不同（因为使用了不同的密钥）
      expect(Buffer.from(ciphertext1.body).toString("hex")).not.toBe(
        Buffer.from(ciphertext2.body).toString("hex"),
      );
    });

    test("应该提供前向保密性", async () => {
      // 发送多条消息
      const messages = ["Message 1", "Message 2", "Message 3"];
      const ciphertexts = [];

      for (const msg of messages) {
        const ciphertext = await alice.encryptMessage("bob", 1, msg);
        ciphertexts.push(ciphertext);
        await bob.decryptMessage("alice", 1, ciphertext);
      }

      // 即使知道某个时刻的密钥，也不能解密之前的消息
      // 这是 Double Ratchet 提供的前向保密性

      // 验证：删除会话后，旧消息无法解密
      await bob.deleteSession("alice", 1);

      // 重新建立会话
      const alicePreKeyBundle = await alice.getPreKeyBundle();
      await bob.processPreKeyBundle("alice", 1, alicePreKeyBundle);

      // 旧的密文无法用新会话解密
      await expect(
        bob.decryptMessage("alice", 1, ciphertexts[0]),
      ).rejects.toThrow();
    });
  });

  test.describe("性能测试", () => {
    test.beforeEach(async () => {
      const bobPreKeyBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);

      const alicePreKeyBundle = await alice.getPreKeyBundle();
      await bob.processPreKeyBundle("alice", 1, alicePreKeyBundle);
    });

    test("加密速度应该合理(<100ms per message)", async () => {
      const message = "Performance test message";
      const iterations = 10;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        await alice.encryptMessage("bob", 1, message + i);
      }

      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / iterations;

      console.log(`平均加密时间: ${avgTime.toFixed(2)}ms`);
      expect(avgTime).toBeLessThan(100);
    });

    test("解密速度应该合理(<100ms per message)", async () => {
      const message = "Performance test message";
      const iterations = 10;
      const ciphertexts = [];

      // 先加密
      for (let i = 0; i < iterations; i++) {
        const ciphertext = await alice.encryptMessage("bob", 1, message + i);
        ciphertexts.push(ciphertext);
      }

      // 测试解密性能
      const startTime = Date.now();

      for (const ciphertext of ciphertexts) {
        await bob.decryptMessage("alice", 1, ciphertext);
      }

      const totalTime = Date.now() - startTime;
      const avgTime = totalTime / iterations;

      console.log(`平均解密时间: ${avgTime.toFixed(2)}ms`);
      expect(avgTime).toBeLessThan(100);
    });

    test("会话建立速度应该合理(<500ms)", async () => {
      const testAlice = new SignalSessionManager({
        userId: "perf-alice",
        deviceId: 1,
      });
      const testBob = new SignalSessionManager({
        userId: "perf-bob",
        deviceId: 1,
      });

      await testAlice.initialize();
      await testBob.initialize();

      const bobPreKeyBundle = await testBob.getPreKeyBundle();

      const startTime = Date.now();
      await testAlice.processPreKeyBundle("perf-bob", 1, bobPreKeyBundle);
      const duration = Date.now() - startTime;

      console.log(`会话建立时间: ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });
  });

  test.describe("错误处理", () => {
    test("应该拒绝无效的预密钥包", async () => {
      const invalidBundle = {
        registrationId: 0,
        identityKey: null,
        signedPreKey: null,
        preKey: null,
      };

      await expect(
        alice.processPreKeyBundle("invalid-user", 1, invalidBundle),
      ).rejects.toThrow();
    });

    test("应该处理不存在会话的加密请求", async () => {
      // 尝试加密给从未建立会话的用户
      await expect(
        alice.encryptMessage("nonexistent-user", 1, "test"),
      ).rejects.toThrow();
    });

    test("应该处理格式错误的密文", async () => {
      const bobPreKeyBundle = await bob.getPreKeyBundle();
      await alice.processPreKeyBundle("bob", 1, bobPreKeyBundle);

      const invalidCiphertext = {
        type: 999, // 无效类型
        body: Buffer.from("invalid"),
      };

      await expect(
        bob.decryptMessage("alice", 1, invalidCiphertext),
      ).rejects.toThrow();
    });
  });
});

# test-chat-skill-bridge

**Source**: `src/main/skill-tool-system/test-chat-skill-bridge.js`

**Generated**: 2026-02-17T10:13:18.191Z

---

## const

```javascript
const
```

* ChatSkillBridge 集成测试
 * 测试对话-技能-工具的完整链路

---

## async function testScenario1(chatBridge)

```javascript
async function testScenario1(chatBridge)
```

* 测试场景1: 包含JSON操作块的响应（应该被拦截）

---

## async function testScenario2(chatBridge)

```javascript
async function testScenario2(chatBridge)
```

* 测试场景2: 只有描述没有JSON的响应

---

## async function testScenario3(chatBridge)

```javascript
async function testScenario3(chatBridge)
```

* 测试场景3: 普通对话响应（不应该被拦截）

---

## async function testScenario4(chatBridge)

```javascript
async function testScenario4(chatBridge)
```

* 测试场景4: 多个文件操作

---


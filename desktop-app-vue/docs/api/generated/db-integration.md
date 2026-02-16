# db-integration

**Source**: `src/main/skill-tool-system/db-integration.js`

**Generated**: 2026-02-16T22:06:51.431Z

---

## const

```javascript
const
```

* 数据库集成脚本 - 将 additional-skills-v3 和 additional-tools-v3 插入数据库
 * 运行方式: node src/main/skill-tool-system/db-integration.js

---

## async initialize()

```javascript
async initialize()
```

* 初始化数据库连接

---

## async insertTools()

```javascript
async insertTools()
```

* 插入工具到数据库

---

## async insertSkills()

```javascript
async insertSkills()
```

* 插入技能到数据库

---

## async createSkillToolRelations()

```javascript
async createSkillToolRelations()
```

* 创建技能-工具关联关系

---

## async verify()

```javascript
async verify()
```

* 验证数据插入结果

---

## async close()

```javascript
async close()
```

* 关闭数据库连接

---

## async run()

```javascript
async run()
```

* 执行完整的集成流程

---


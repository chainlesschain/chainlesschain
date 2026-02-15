# import-templates-to-db

**Source**: `src/main/templates/import-templates-to-db.js`

**Generated**: 2026-02-15T07:37:13.768Z

---

## const

```javascript
const
```

* 导入模板到数据库
 * 从JSON文件批量导入模板到project_templates表
 *
 * 使用方法：
 * node import-templates-to-db.js

---

## async importTemplate(templatePath, category)

```javascript
async importTemplate(templatePath, category)
```

* 导入单个模板

---

## async importAll()

```javascript
async importAll()
```

* 扫描并导入所有模板

---

## showStats()

```javascript
showStats()
```

* 显示统计信息

---

## cleanup()

```javascript
cleanup()
```

* 清理

---

## async run()

```javascript
async run()
```

* 运行导入

---


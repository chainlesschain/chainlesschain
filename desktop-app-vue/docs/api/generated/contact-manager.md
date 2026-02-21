# contact-manager

**Source**: `src/main/contacts/contact-manager.js`

**Generated**: 2026-02-21T22:45:05.306Z

---

## const

```javascript
const
```

* 联系人管理器
 *
 * 管理 DID 联系人、好友关系、信任评分

---

## class ContactManager extends EventEmitter

```javascript
class ContactManager extends EventEmitter
```

* 联系人管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化联系人管理器

---

## async ensureTables()

```javascript
async ensureTables()
```

* 确保数据库表存在

---

## async addContact(contact)

```javascript
async addContact(contact)
```

* 添加联系人
   * @param {Object} contact - 联系人信息

---

## async addContactFromQR(qrData)

```javascript
async addContactFromQR(qrData)
```

* 从二维码数据添加联系人
   * @param {string} qrData - 二维码 JSON 数据

---

## getAllContacts()

```javascript
getAllContacts()
```

* 获取所有联系人

---

## getContactByDID(did)

```javascript
getContactByDID(did)
```

* 根据 DID 获取联系人
   * @param {string} did - DID 标识符

---

## async updateContact(did, updates)

```javascript
async updateContact(did, updates)
```

* 更新联系人信息
   * @param {string} did - DID 标识符
   * @param {Object} updates - 更新内容

---

## async deleteContact(did)

```javascript
async deleteContact(did)
```

* 删除联系人
   * @param {string} did - DID 标识符

---

## searchContacts(query)

```javascript
searchContacts(query)
```

* 搜索联系人
   * @param {string} query - 搜索关键词

---

## getFriends()

```javascript
getFriends()
```

* 获取好友列表（relationship='friend'）

---

## async updateLastSeen(did)

```javascript
async updateLastSeen(did)
```

* 更新最后在线时间
   * @param {string} did - DID 标识符

---

## async updateTrustScore(did, delta)

```javascript
async updateTrustScore(did, delta)
```

* 更新信任评分
   * @param {string} did - DID 标识符
   * @param {number} delta - 评分变化（正数增加，负数减少）

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## async close()

```javascript
async close()
```

* 关闭管理器

---


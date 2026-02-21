# nat-detector

**Source**: `src/main/p2p/nat-detector.js`

**Generated**: 2026-02-21T22:04:25.807Z

---

## const

```javascript
const
```

* NAT类型检测器
 * 使用STUN协议检测NAT类型和公网IP

---

## const NAT_TYPES =

```javascript
const NAT_TYPES =
```

* NAT类型枚举

---

## async detectNATType(stunServers)

```javascript
async detectNATType(stunServers)
```

* 检测NAT类型
   * @param {Array<string>} stunServers - STUN服务器列表 (格式: 'stun:host:port')
   * @returns {Promise<Object>} NAT检测结果

---

## async querySTUNServer(stunServerUrl)

```javascript
async querySTUNServer(stunServerUrl)
```

* 查询STUN服务器
   * @param {string} stunServerUrl - STUN服务器URL (格式: 'stun:host:port')
   * @returns {Promise<Object|null>} STUN响应结果

---

## buildSTUNBindingRequest()

```javascript
buildSTUNBindingRequest()
```

* 构建STUN绑定请求 (RFC 5389)
   * @returns {Buffer} STUN请求数据包

---

## parseSTUNResponse(buffer)

```javascript
parseSTUNResponse(buffer)
```

* 解析STUN响应
   * @param {Buffer} buffer - STUN响应数据包
   * @returns {Object|null} 解析结果

---

## async getLocalIP()

```javascript
async getLocalIP()
```

* 获取本地IP地址
   * @returns {Promise<string>} 本地IP

---

## getPublicIP()

```javascript
getPublicIP()
```

* 获取公网IP（从缓存的检测结果）
   * @returns {string|null} 公网IP

---

## getCachedResult()

```javascript
getCachedResult()
```

* 获取缓存的检测结果
   * @returns {Object|null} 缓存的结果

---

## cacheResult(result)

```javascript
cacheResult(result)
```

* 缓存检测结果
   * @param {Object} result - 检测结果

---

## invalidateCache()

```javascript
invalidateCache()
```

* 使缓存失效

---


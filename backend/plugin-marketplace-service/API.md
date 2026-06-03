# Plugin Marketplace Service - API Documentation

## Base URL
```
http://localhost:8090/api
```

## Authentication
Most endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints

### 1. Plugin Management

#### 1.1 List Plugins
```http
GET /plugins
```

**Query Parameters:**
- `category` (optional): Filter by category code
- `search` (optional): Search keyword
- `sort` (optional): Sort order (popular, recent, rating, downloads)
- `page` (optional): Page number (default: 1)
- `pageSize` (optional): Page size (default: 20, max: 100)
- `verified` (optional): Filter verified plugins only

**Response:**
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "records": [...],
    "total": 100,
    "size": 20,
    "current": 1,
    "pages": 5
  },
  "timestamp": 1704067200000
}
```

#### 1.2 Get Plugin Details
```http
GET /plugins/{id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "pluginId": "translator",
    "name": "多语言翻译器",
    "version": "1.0.0",
    "author": "ChainlessChain Team",
    "description": "支持多种语言的智能翻译插件",
    "category": "ai",
    "tags": ["翻译", "AI", "多语言"],
    "downloads": 15234,
    "rating": 4.8,
    "ratingCount": 120,
    "verified": true,
    "featured": true,
    "versions": [...]
  }
}
```

#### 1.3 Create Plugin
```http
POST /plugins
```

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: multipart/form-data`

**Body:**
- `plugin` (JSON): Plugin metadata
- `file` (File): Plugin package (.zip)

**Request Example:**
```json
{
  "pluginId": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A great plugin",
  "category": "productivity",
  "tags": ["tool", "productivity"],
  "license": "MIT"
}
```

#### 1.4 Update Plugin
```http
PUT /plugins/{id}
```

**Headers:**
- `Authorization: Bearer <token>`

**Body:** Same as create (without file)

#### 1.5 Delete Plugin
```http
DELETE /plugins/{id}
```

**Headers:**
- `Authorization: Bearer <token>`

#### 1.6 Get Featured Plugins
```http
GET /plugins/featured?limit=10
```

#### 1.7 Get Popular Plugins
```http
GET /plugins/popular?limit=20
```

#### 1.8 Search Plugins
```http
GET /plugins/search?keyword=translator&category=ai&verified=true&sort=rating
```

#### 1.9 Download Plugin
```http
GET /plugins/{id}/download?version=1.0.0
```

**Response:**
```json
{
  "success": true,
  "message": "Download URL",
  "data": "https://storage.example.com/plugins/translator-1.0.0.zip"
}
```

#### 1.10 Approve Plugin (Admin)
```http
POST /plugins/{id}/approve
```

**Headers:**
- `Authorization: Bearer <admin-token>`

#### 1.11 Reject Plugin (Admin)
```http
POST /plugins/{id}/reject?reason=Violates policy
```

**Headers:**
- `Authorization: Bearer <admin-token>`

### 2. Rating Management

#### 2.1 Get Plugin Ratings
```http
GET /plugins/{pluginId}/ratings
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "pluginId": 1,
      "userDid": "did:example:user1",
      "username": "developer1",
      "rating": 5,
      "comment": "Excellent plugin!",
      "helpfulCount": 10,
      "createdAt": "2026-01-11T10:00:00"
    }
  ]
}
```

#### 2.2 Submit Rating
```http
POST /plugins/{pluginId}/ratings
```

**Headers:**
- `Authorization: Bearer <token>`

**Body:**
```json
{
  "rating": 5,
  "comment": "Great plugin!"
}
```

#### 2.3 Delete Rating
```http
DELETE /ratings/{id}
```

**Headers:**
- `Authorization: Bearer <token>`

### 3. Category Management

#### 3.1 Get All Categories
```http
GET /categories
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "ai",
      "name": "AI增强",
      "description": "AI和机器学习相关插件",
      "icon": "robot",
      "pluginCount": 25
    }
  ]
}
```

#### 3.2 Get Category by Code
```http
GET /categories/{code}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Validation failed",
  "data": {
    "pluginId": "Plugin ID cannot be empty",
    "version": "Version must follow semantic versioning"
  },
  "timestamp": 1704067200000
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Unauthorized access",
  "timestamp": 1704067200000
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Plugin not found: 999",
  "timestamp": 1704067200000
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error: ...",
  "timestamp": 1704067200000
}
```

## Status Codes

- `200 OK`: Success
- `400 Bad Request`: Validation error
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Permission denied
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## Rate Limiting

- Rate limit: 100 requests per minute per IP
- Burst limit: 20 requests per second

## Pagination

All list endpoints support pagination:
- `page`: Page number (starts from 1)
- `pageSize`: Items per page (max 100)

Response includes:
- `records`: Array of items
- `total`: Total number of items
- `size`: Page size
- `current`: Current page
- `pages`: Total pages

## Sorting

Supported sort options:
- `popular`: By downloads (default)
- `recent`: By publish date
- `rating`: By rating score
- `downloads`: By download count

## Filtering

Supported filters:
- `category`: Filter by category code
- `verified`: Show only verified plugins
- `status`: Filter by status (pending, approved, rejected)

## Search

Search supports:
- Plugin name matching
- Description matching
- Tag matching
- Case-insensitive
- Partial matching

## Caching

- Cache TTL: 1 hour
- Cached endpoints:
  - GET /plugins/{id}
  - GET /plugins/featured
  - GET /plugins/popular
  - GET /categories

## Security

### Authentication
- JWT token required for protected endpoints
- Token expiration: 24 hours
- Refresh token expiration: 7 days

### Authorization
- Role-based access control (RBAC)
- Roles: developer, admin, moderator
- Permission checks on all write operations

### File Upload
- Max file size: 50MB
- Allowed extensions: .zip, .tar.gz
- File hash verification
- Virus scanning (optional)

## Examples

### cURL Examples

**List plugins:**
```bash
curl -X GET "http://localhost:8090/api/plugins?category=ai&page=1&pageSize=20"
```

**Get plugin:**
```bash
curl -X GET "http://localhost:8090/api/plugins/1"
```

**Create plugin:**
```bash
curl -X POST "http://localhost:8090/api/plugins" \
  -H "Authorization: Bearer <token>" \
  -F "plugin=@plugin.json;type=application/json" \
  -F "file=@plugin.zip"
```

**Submit rating:**
```bash
curl -X POST "http://localhost:8090/api/plugins/1/ratings" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"rating": 5, "comment": "Great!"}'
```

### JavaScript Examples

**Fetch plugins:**
```javascript
const response = await fetch('http://localhost:8090/api/plugins?category=ai');
const data = await response.json();
console.log(data.data.records);
```

**Create plugin:**
```javascript
const formData = new FormData();
formData.append('plugin', JSON.stringify(pluginData));
formData.append('file', fileBlob);

const response = await fetch('http://localhost:8090/api/plugins', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

## Webhooks

Coming soon: Webhook support for plugin events
- Plugin published
- Plugin updated
- Plugin downloaded
- Rating submitted

## Changelog

### v1.0.0 (2026-01-11)
- Initial release
- Plugin CRUD operations
- Rating system
- Category management
- Search and filtering
- Authentication and authorization

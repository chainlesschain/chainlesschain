# 联系表单 API 服务

## 功能说明

处理官网联系表单提交，支持：
- 表单验证
- 邮件通知
- 企业微信/钉钉通知
- 速率限制（防滥用）
- CORS 跨域支持

## 部署方式

### 方式1：独立 Express 服务器

适用于有独立服务器的场景。

```bash
cd api
npm install
cp .env.example .env
# 编辑 .env 文件，填写邮箱配置
npm start
```

服务运行在 `http://localhost:3000`

**Nginx 反向代理配置：**

```nginx
server {
    listen 80;
    server_name api.chainlesschain.com;

    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 方式2：Vercel Serverless 函数

适用于静态网站托管在 Vercel 的场景。

**1. 在项目根目录创建 `vercel.json`：**

```json
{
  "version": 2,
  "builds": [
    { "src": "docs-website/api/contact.js", "use": "@vercel/node" }
  ],
  "routes": [
    { "src": "/api/contact", "dest": "docs-website/api/contact.js" }
  ],
  "env": {
    "SERVERLESS": "true"
  }
}
```

**2. 在 Vercel 控制台设置环境变量：**

- `WECOM_WEBHOOK_URL` - 企业微信机器人地址（推荐）
- 或配置邮件服务器变量

**3. 部署：**

```bash
vercel --prod
```

API 地址：`https://your-domain.vercel.app/api/contact`

### 方式3：Netlify Functions

**1. 创建 `netlify/functions/contact.js`：**

```javascript
const handler = require('../../docs-website/api/contact');
process.env.SERVERLESS = 'true';
module.exports = { handler };
```

**2. 在 Netlify 控制台设置环境变量**

**3. 部署后自动可用：**

API 地址：`https://your-domain.netlify.app/.netlify/functions/contact`

### 方式4：使用第三方表单服务（最简单）

如果不想自己部署后端，可以使用：

#### 4.1 Formspree（推荐）

免费：https://formspree.io/

```html
<form action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
  <input type="text" name="name" required>
  <input type="email" name="email" required>
  <textarea name="message" required></textarea>
  <button type="submit">提交</button>
</form>
```

#### 4.2 Getform

免费：https://getform.io/

#### 4.3 EmailJS

纯前端：https://www.emailjs.com/

```javascript
emailjs.send("service_id", "template_id", {
    name: name,
    phone: phone,
    email: email,
    message: message
});
```

## 更新前端代码

修改 `docs-website/js/main.js` 中的表单提交代码：

```javascript
contactForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    const formData = new FormData(contactForm);
    const data = {
        name: formData.get('name'),
        phone: formData.get('phone'),
        email: formData.get('email'),
        message: formData.get('message')
    };

    // 显示加载状态
    const submitBtn = contactForm.querySelector('.btn-submit');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
    submitBtn.disabled = true;

    try {
        // 修改为实际的API地址
        const response = await fetch('http://localhost:3000/api/contact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            contactForm.reset();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('提交失败：', error);
        alert('提交失败，请稍后重试或直接拨打 400-1068-687');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
});
```

## 配置邮件服务

### QQ 邮箱

1. 登录 QQ 邮箱
2. 设置 → 账户 → 开启 SMTP 服务
3. 获取授权码（不是邮箱密码）
4. 配置到 `.env` 文件

### 163 邮箱

```env
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=your-email@163.com
SMTP_PASS=your-authorization-code
```

### 阿里云企业邮箱

```env
SMTP_HOST=smtp.qiye.aliyun.com
SMTP_PORT=465
SMTP_USER=your-email@your-domain.com
SMTP_PASS=your-password
```

## 配置企业微信机器人（推荐）

1. 企业微信群 → 群设置 → 群机器人 → 添加机器人
2. 复制 Webhook 地址
3. 配置到 `.env`：`WECOM_WEBHOOK_URL=...`

收到的消息格式：

```
# 新的客户咨询

**姓名：**张三
**电话：**13800138000
**邮箱：**zhangsan@example.com

**咨询内容：**
我对个人AI知识库产品感兴趣...

提交时间：2025-12-29 14:30:00
```

## 测试

```bash
# 测试健康检查
curl http://localhost:3000/api/health

# 测试表单提交
curl -X POST http://localhost:3000/api/contact \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试用户",
    "phone": "13800138000",
    "email": "test@example.com",
    "message": "这是一条测试消息"
  }'
```

## 安全建议

1. **启用 HTTPS** - 生产环境必须使用 HTTPS
2. **速率限制** - 已内置，防止表单滥用
3. **输入验证** - 已内置基本验证，可根据需要加强
4. **环境变量** - 敏感信息不要提交到代码库
5. **日志记录** - 建议记录所有提交以便追踪

## 监控和通知

建议集成：
- **Sentry** - 错误监控
- **企业微信/钉钉** - 实时通知
- **数据库** - 持久化存储（可选）

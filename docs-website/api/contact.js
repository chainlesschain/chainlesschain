/**
 * 联系表单后端API
 *
 * 支持两种部署方式：
 * 1. 独立的 Express 服务器
 * 2. Serverless 函数（Vercel/Netlify）
 */

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

// Express 服务器模式
function createExpressServer() {
    const app = express();

    // 中间件
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 速率限制 - 防止滥用
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 5, // 限制5次请求
        message: '请求过于频繁，请稍后再试'
    });

    app.use('/api/contact', limiter);

    // 邮件配置
    const transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST || 'smtp.qq.com',
        port: process.env.SMTP_PORT || 465,
        secure: true,
        auth: {
            user: process.env.SMTP_USER, // 发件邮箱
            pass: process.env.SMTP_PASS  // 邮箱授权码
        }
    });

    // 联系表单处理
    app.post('/api/contact', async (req, res) => {
        try {
            const { name, phone, email, message } = req.body;

            // 验证必填字段
            if (!name || !phone || !message) {
                return res.status(400).json({
                    success: false,
                    message: '请填写所有必填项'
                });
            }

            // 验证手机号
            const phoneRegex = /^1[3-9]\d{9}$/;
            if (!phoneRegex.test(phone)) {
                return res.status(400).json({
                    success: false,
                    message: '手机号格式不正确'
                });
            }

            // 验证邮箱（如果提供）
            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    return res.status(400).json({
                        success: false,
                        message: '邮箱格式不正确'
                    });
                }
            }

            // 邮件内容
            const mailOptions = {
                from: process.env.SMTP_USER,
                to: process.env.RECEIVE_EMAIL || 'zhanglongfa@chainlesschain.com',
                subject: `【ChainlessChain官网】新的咨询 - ${name}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #1890ff; border-bottom: 2px solid #1890ff; padding-bottom: 10px;">
                            新的客户咨询
                        </h2>

                        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>姓名：</strong>${name}</p>
                            <p><strong>电话：</strong><a href="tel:${phone}">${phone}</a></p>
                            <p><strong>邮箱：</strong>${email || '未提供'}</p>
                        </div>

                        <div style="background: white; padding: 20px; border: 1px solid #e8e8e8; border-radius: 8px;">
                            <h3 style="color: #333; margin-top: 0;">咨询内容：</h3>
                            <p style="line-height: 1.8; color: #666;">${message}</p>
                        </div>

                        <div style="margin-top: 20px; padding: 15px; background: #fff7e6; border-left: 4px solid #faad14; border-radius: 4px;">
                            <p style="margin: 0; color: #666;">
                                <strong>提示：</strong>请在1个工作日内回复客户
                            </p>
                        </div>

                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e8e8e8; text-align: center; color: #999; font-size: 12px;">
                            <p>此邮件由 ChainlessChain 官网自动发送</p>
                            <p>提交时间：${new Date().toLocaleString('zh-CN')}</p>
                        </div>
                    </div>
                `
            };

            // 发送邮件
            await transporter.sendMail(mailOptions);

            // 可选：保存到数据库
            // await saveToDatabase({ name, phone, email, message, createdAt: new Date() });

            // 返回成功
            res.json({
                success: true,
                message: '感谢您的咨询！我们将在1个工作日内与您联系。'
            });

        } catch (error) {
            console.error('处理联系表单错误：', error);
            res.status(500).json({
                success: false,
                message: '提交失败，请稍后重试或直接拨打 400-1068-687'
            });
        }
    });

    // 健康检查
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    return app;
}

// Serverless 函数模式（Vercel/Netlify）
async function handleServerlessRequest(req, res) {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 只接受 POST 请求
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { name, phone, email, message } = req.body;

        // 验证（同上）
        if (!name || !phone || !message) {
            return res.status(400).json({
                success: false,
                message: '请填写所有必填项'
            });
        }

        // 这里可以集成第三方邮件服务（如 SendGrid、阿里云邮件推送等）
        // 或者使用 webhook 发送到企业微信、钉钉等

        // 示例：发送到企业微信机器人
        if (process.env.WECOM_WEBHOOK_URL) {
            const axios = require('axios');
            await axios.post(process.env.WECOM_WEBHOOK_URL, {
                msgtype: 'markdown',
                markdown: {
                    content: `# 新的客户咨询\n\n**姓名：**${name}\n**电话：**${phone}\n**邮箱：**${email || '未提供'}\n\n**咨询内容：**\n${message}\n\n提交时间：${new Date().toLocaleString('zh-CN')}`
                }
            });
        }

        res.json({
            success: true,
            message: '感谢您的咨询！我们将在1个工作日内与您联系。'
        });

    } catch (error) {
        console.error('处理联系表单错误：', error);
        res.status(500).json({
            success: false,
            message: '提交失败，请稍后重试'
        });
    }
}

// 根据环境选择导出
if (process.env.SERVERLESS === 'true') {
    // Serverless 函数
    module.exports = handleServerlessRequest;
} else {
    // Express 服务器
    const app = createExpressServer();
    const PORT = process.env.PORT || 3000;

    if (require.main === module) {
        app.listen(PORT, () => {
            console.log(`联系表单API服务器运行在 http://localhost:${PORT}`);
            console.log(`健康检查：http://localhost:${PORT}/api/health`);
        });
    }

    module.exports = app;
}

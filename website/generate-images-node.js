/**
 * ChainlessChain 图片资源生成器 (Node.js版本)
 * 使用Canvas生成网站所需的所有图片资源
 */

const fs = require('fs');
const path = require('path');

// 配置
const OUTPUT_DIR = 'images';
const QR_DIR = path.join(OUTPUT_DIR, 'qr');
const PRODUCTS_DIR = path.join(OUTPUT_DIR, 'products');
const BADGES_DIR = path.join(OUTPUT_DIR, 'badges');

// 创建目录
function createDirectories() {
    [OUTPUT_DIR, QR_DIR, PRODUCTS_DIR, BADGES_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

// 生成SVG二维码（简化版本）
function generateQRCodeSVG(text, size = 200) {
    // 简化的二维码SVG生成
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="white"/>
    <text x="50%" y="50%" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="black">
        <tspan x="50%" dy="-30">扫描下载</tspan>
        <tspan x="50%" dy="20" font-size="10">${text.substring(0, 30)}</tspan>
        <tspan x="50%" dy="15" font-size="10">${text.substring(30, 60)}</tspan>
    </text>
    <rect x="${size * 0.2}" y="${size * 0.2}" width="${size * 0.6}" height="${size * 0.6}" fill="none" stroke="black" stroke-width="2"/>
    <rect x="${size * 0.25}" y="${size * 0.25}" width="${size * 0.1}" height="${size * 0.1}" fill="black"/>
    <rect x="${size * 0.65}" y="${size * 0.25}" width="${size * 0.1}" height="${size * 0.1}" fill="black"/>
    <rect x="${size * 0.25}" y="${size * 0.65}" width="${size * 0.1}" height="${size * 0.1}" fill="black"/>
</svg>`;
    return svg;
}

// 生成SVG图片
function generateSVG(type, width, height) {
    let svg = '';

    switch (type) {
        case 'og-image':
            svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
            <stop offset="50%" style="stop-color:#764ba2;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#f093fb;stop-opacity:1" />
        </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#grad)"/>
    <text x="50%" y="150" font-size="72" font-weight="bold" text-anchor="middle" fill="white">ChainlessChain</text>
    <text x="50%" y="240" font-size="48" font-weight="bold" text-anchor="middle" fill="white">无链之链</text>
    <text x="50%" y="340" font-size="36" text-anchor="middle" fill="white">让数据主权回归个人</text>
    <text x="50%" y="400" font-size="36" text-anchor="middle" fill="white">AI效率触手可及</text>
    <text x="200" y="520" font-size="24" fill="white">🔒 硬件加密</text>
    <text x="400" y="520" font-size="24" fill="white">🤖 本地AI</text>
    <text x="600" y="520" font-size="24" fill="white">💾 离线可用</text>
    <text x="800" y="520" font-size="24" fill="white">🆓 永久免费</text>
</svg>`;
            break;

        case 'product-kb':
            svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#f5f7fa"/>
    <rect y="0" width="${width}" height="60" fill="#1890ff"/>
    <text x="20" y="38" font-size="24" font-weight="bold" fill="white">🔗 ChainlessChain</text>
    <text x="400" y="130" font-size="48" font-weight="bold" text-anchor="middle" fill="#2c3e50">个人AI知识库</text>
    <text x="400" y="180" font-size="24" text-anchor="middle" fill="#666">硬件加密 + 本地AI</text>
    <rect x="20" y="220" width="200" height="320" fill="white" stroke="#e8e8e8"/>
    <rect x="240" y="220" width="540" height="320" fill="white" stroke="#e8e8e8"/>
    ${[0, 1, 2, 3, 4].map(i => `<rect x="30" y="${240 + i * 60}" width="180" height="40" fill="#e8e8e8"/>`).join('')}
    ${[0, 1, 2].map(i => `<rect x="260" y="${240 + i * 100}" width="500" height="80" fill="#e8e8e8"/>`).join('')}
    <text x="400" y="570" font-size="20" text-anchor="middle" fill="#999">这是临时占位图，请替换为实际产品截图</text>
</svg>`;
            break;

        case 'product-social':
            svg = generateProductSVG(width, height, '去中心化社交', '端到端加密 + P2P通信');
            break;

        case 'product-trading':
            svg = generateProductSVG(width, height, 'AI辅助交易', '智能匹配 + 智能合约');
            break;

        case 'badge-ssl':
            svg = generateBadgeSVG(width, height, '#52c41a', '🔒', 'SSL Secure');
            break;

        case 'badge-level3':
            svg = generateBadgeSVG(width, height, '#1890ff', '✅', '等保三级');
            break;

        case 'badge-iso':
            svg = generateBadgeSVG(width, height, '#722ed1', '🏆', 'ISO Certified');
            break;

        case 'logo':
            svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="45" font-size="40">🔗</text>
    <text x="60" y="38" font-size="28" font-weight="bold" fill="white">ChainlessChain</text>
</svg>`;
            break;
    }

    return svg;
}

function generateProductSVG(width, height, title, subtitle) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#f5f7fa"/>
    <rect y="0" width="${width}" height="60" fill="#1890ff"/>
    <text x="20" y="38" font-size="24" font-weight="bold" fill="white">🔗 ChainlessChain</text>
    <text x="400" y="130" font-size="48" font-weight="bold" text-anchor="middle" fill="#2c3e50">${title}</text>
    <text x="400" y="180" font-size="24" text-anchor="middle" fill="#666">${subtitle}</text>
    <rect x="20" y="220" width="200" height="320" fill="white" stroke="#e8e8e8"/>
    <rect x="240" y="220" width="540" height="320" fill="white" stroke="#e8e8e8"/>
    ${[0, 1, 2, 3, 4].map(i => `<rect x="30" y="${240 + i * 60}" width="180" height="40" fill="#e8e8e8"/>`).join('')}
    ${[0, 1, 2].map(i => `<rect x="260" y="${240 + i * 100}" width="500" height="80" fill="#e8e8e8"/>`).join('')}
    <text x="400" y="570" font-size="20" text-anchor="middle" fill="#999">这是临时占位图，请替换为实际产品截图</text>
</svg>`;
}

function generateBadgeSVG(width, height, color, icon, text) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="${color}" rx="4"/>
    <rect x="2" y="2" width="${width - 4}" height="${height - 4}" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" rx="3"/>
    <text x="40" y="50" font-size="32">${icon}</text>
    <text x="120" y="50" font-size="16" font-weight="bold" text-anchor="middle" fill="white">${text}</text>
</svg>`;
}

// 保存SVG文件
function saveSVG(svg, filename) {
    fs.writeFileSync(filename, svg);
    console.log(`✅ 生成: ${filename}`);
}

// 主函数
async function main() {
    console.log('🎨 开始生成ChainlessChain图片资源...\n');

    // 创建目录
    createDirectories();

    // 1. 生成二维码
    console.log('📱 生成二维码（SVG格式）...');
    const androidQR = generateQRCodeSVG('https://github.com/chainlesschain/chainlesschain/releases/latest');
    saveSVG(androidQR, path.join(QR_DIR, 'android-download.svg'));

    const wechatQR = generateQRCodeSVG('https://work.weixin.qq.com/ca/cawcde653996f7ecb2');
    saveSVG(wechatQR, path.join(QR_DIR, 'wechat.svg'));

    // 2. 生成 Open Graph 图片
    console.log('\n🖼️  生成OG分享图...');
    const ogImage = generateSVG('og-image', 1200, 630);
    saveSVG(ogImage, path.join(OUTPUT_DIR, 'og-image.svg'));

    // 3. 生成产品截图
    console.log('\n📸 生成产品截图...');
    const kbScreenshot = generateSVG('product-kb', 800, 600);
    saveSVG(kbScreenshot, path.join(PRODUCTS_DIR, 'kb-screenshot.svg'));

    const socialScreenshot = generateSVG('product-social', 800, 600);
    saveSVG(socialScreenshot, path.join(PRODUCTS_DIR, 'social-screenshot.svg'));

    const tradingScreenshot = generateSVG('product-trading', 800, 600);
    saveSVG(tradingScreenshot, path.join(PRODUCTS_DIR, 'trading-screenshot.svg'));

    // 4. 生成安全徽章
    console.log('\n🛡️  生成安全徽章...');
    const sslBadge = generateSVG('badge-ssl', 200, 80);
    saveSVG(sslBadge, path.join(BADGES_DIR, 'ssl-secure.svg'));

    const level3Badge = generateSVG('badge-level3', 200, 80);
    saveSVG(level3Badge, path.join(BADGES_DIR, 'level3-certified.svg'));

    const isoBadge = generateSVG('badge-iso', 200, 80);
    saveSVG(isoBadge, path.join(BADGES_DIR, 'iso-certified.svg'));

    // 5. 生成Logo
    console.log('\n🔗 生成Logo...');
    const logo = generateSVG('logo', 200, 60);
    saveSVG(logo, 'logo.svg');

    console.log('\n✨ 所有图片生成完成！');
    console.log('\n📁 生成的文件（SVG格式）：');
    console.log('  - logo.svg');
    console.log('  - images/og-image.svg');
    console.log('  - images/qr/android-download.svg');
    console.log('  - images/qr/wechat.svg');
    console.log('  - images/products/kb-screenshot.svg');
    console.log('  - images/products/social-screenshot.svg');
    console.log('  - images/products/trading-screenshot.svg');
    console.log('  - images/badges/ssl-secure.svg');
    console.log('  - images/badges/level3-certified.svg');
    console.log('  - images/badges/iso-certified.svg');

    console.log('\n💡 提示：');
    console.log('  1. SVG是矢量格式，可无限缩放不失真');
    console.log('  2. 浏览器可直接显示SVG图片');
    console.log('  3. 如需PNG格式，可使用在线工具转换: https://cloudconvert.com/svg-to-png');
    console.log('  4. 二维码是简化版本，建议使用专业工具生成: https://cli.im/');
    console.log('  5. 产品截图应替换为实际界面截图');
}

// 运行
main().catch(console.error);

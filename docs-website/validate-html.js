/**
 * HTML/CSS/JS 验证工具
 * 检查常见的HTML问题、可访问性问题、SEO问题
 *
 * 使用方法：node validate-html.js
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
    baseDir: __dirname,
    htmlFiles: [
        'index.html',
        'products/enterprise.html',
        'products/project-management.html',
        'products/knowledge-base.html',
        'products/social.html',
        'products/trading.html',
        'technology/technical-docs.html'
    ]
};

// 验证规则
const VALIDATION_RULES = {
    // 必须存在的Meta标签
    requiredMetaTags: [
        'charset',
        'viewport',
        'description',
        'keywords'
    ],

    // SEO相关
    seoChecks: [
        { name: 'title', pattern: /<title>.*?<\/title>/i, required: true },
        { name: 'meta description', pattern: /<meta\s+name=["']description["']/i, required: true },
        { name: 'h1', pattern: /<h1[^>]*>.*?<\/h1>/i, required: true },
        { name: 'canonical', pattern: /<link\s+rel=["']canonical["']/i, required: false }
    ],

    // 可访问性检查
    accessibilityChecks: [
        { name: 'img alt', pattern: /<img(?![^>]*alt=)/i, shouldNotMatch: true },
        { name: 'html lang', pattern: /<html[^>]+lang=/i, required: true },
        { name: 'aria-label on decorative svg', pattern: /<svg[^>]+aria-hidden=["']true["']/i, required: false }
    ],

    // HTML结构检查
    structureChecks: [
        { name: 'doctype', pattern: /<!DOCTYPE html>/i, required: true },
        { name: 'charset in head', pattern: /<head>[\s\S]*?<meta\s+charset=/i, required: true },
        { name: 'viewport in head', pattern: /<head>[\s\S]*?<meta\s+name=["']viewport["']/i, required: true }
    ]
};

// 结果
const results = {
    filesChecked: 0,
    totalIssues: 0,
    errors: [],
    warnings: [],
    info: []
};

/**
 * 添加问题
 */
function addIssue(level, file, rule, message) {
    const issue = {
        file,
        rule,
        message,
        level
    };

    results[level + 's'].push(issue);
    results.totalIssues++;
}

/**
 * 检查单个规则
 */
function checkRule(content, file, rule, level = 'error') {
    const { name, pattern, required, shouldNotMatch } = rule;

    const found = pattern.test(content);

    if (shouldNotMatch) {
        // 不应该匹配的模式（如：没有alt的img）
        if (found) {
            addIssue(level, file, name, `Found elements without required attributes`);
            return false;
        }
    } else {
        // 应该匹配的模式
        if (required && !found) {
            addIssue(level, file, name, `Missing required element: ${name}`);
            return false;
        }
    }

    return true;
}

/**
 * 检查Meta标签
 */
function checkMetaTags(content, file) {
    const headMatch = content.match(/<head>([\s\S]*?)<\/head>/i);
    if (!headMatch) {
        addIssue('error', file, 'head', 'No <head> section found');
        return;
    }

    const head = headMatch[1];

    VALIDATION_RULES.requiredMetaTags.forEach(metaName => {
        const pattern = new RegExp(`<meta[^>]*(charset=["']?${metaName}["']?|name=["']${metaName}["'])`, 'i');

        if (!pattern.test(head)) {
            addIssue('warning', file, `meta-${metaName}`, `Missing meta tag: ${metaName}`);
        }
    });
}

/**
 * 检查标题层级
 */
function checkHeadingHierarchy(content, file) {
    const headings = {
        h1: (content.match(/<h1[^>]*>/gi) || []).length,
        h2: (content.match(/<h2[^>]*>/gi) || []).length,
        h3: (content.match(/<h3[^>]*>/gi) || []).length,
        h4: (content.match(/<h4[^>]*>/gi) || []).length,
        h5: (content.match(/<h5[^>]*>/gi) || []).length,
        h6: (content.match(/<h6[^>]*>/gi) || []).length
    };

    // 检查H1数量（应该只有1个）
    if (headings.h1 === 0) {
        addIssue('error', file, 'h1-count', 'No H1 found (should have exactly 1)');
    } else if (headings.h1 > 1) {
        addIssue('warning', file, 'h1-count', `Multiple H1 found (${headings.h1}). Should have exactly 1.`);
    }

    results.info.push({
        file,
        rule: 'heading-structure',
        message: `Heading structure: H1(${headings.h1}) H2(${headings.h2}) H3(${headings.h3}) H4(${headings.h4}) H5(${headings.h5}) H6(${headings.h6})`
    });
}

/**
 * 检查Schema.org结构化数据
 */
function checkSchemaOrg(content, file) {
    const schemaPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const schemas = [];
    let match;

    while ((match = schemaPattern.exec(content)) !== null) {
        try {
            const schemaData = JSON.parse(match[1]);
            schemas.push(schemaData['@type']);
        } catch (e) {
            addIssue('error', file, 'schema-json', 'Invalid JSON-LD schema: ' + e.message);
        }
    }

    if (schemas.length === 0) {
        addIssue('warning', file, 'schema-org', 'No Schema.org structured data found');
    } else {
        results.info.push({
            file,
            rule: 'schema-org',
            message: `Found Schema.org types: ${schemas.join(', ')}`
        });
    }
}

/**
 * 检查Open Graph标签
 */
function checkOpenGraph(content, file) {
    const ogTags = [
        'og:title',
        'og:description',
        'og:image',
        'og:url',
        'og:type'
    ];

    const missingTags = ogTags.filter(tag => {
        const pattern = new RegExp(`<meta[^>]+property=["']${tag}["']`, 'i');
        return !pattern.test(content);
    });

    if (missingTags.length > 0) {
        addIssue('info', file, 'open-graph', `Missing Open Graph tags: ${missingTags.join(', ')}`);
    }
}

/**
 * 检查图片优化
 */
function checkImageOptimization(content, file) {
    // 检查是否使用了loading="lazy"
    const allImages = (content.match(/<img[^>]*>/gi) || []).length;
    const lazyImages = (content.match(/<img[^>]*loading=["']lazy["']/gi) || []).length;

    if (allImages > 0 && lazyImages === 0) {
        addIssue('info', file, 'img-lazy', 'Consider using loading="lazy" for images');
    } else if (lazyImages > 0) {
        results.info.push({
            file,
            rule: 'img-lazy',
            message: `${lazyImages}/${allImages} images use lazy loading`
        });
    }
}

/**
 * 检查单个HTML文件
 */
function validateHtmlFile(filePath) {
    const fullPath = path.join(CONFIG.baseDir, filePath);

    if (!fs.existsSync(fullPath)) {
        addIssue('error', filePath, 'file-not-found', 'File does not exist');
        return;
    }

    console.log(`📄 验证文件: ${filePath}`);

    const content = fs.readFileSync(fullPath, 'utf-8');
    results.filesChecked++;

    // 1. HTML结构检查
    VALIDATION_RULES.structureChecks.forEach(rule => {
        checkRule(content, filePath, rule, 'error');
    });

    // 2. SEO检查
    VALIDATION_RULES.seoChecks.forEach(rule => {
        checkRule(content, filePath, rule, rule.required ? 'error' : 'warning');
    });

    // 3. 可访问性检查
    VALIDATION_RULES.accessibilityChecks.forEach(rule => {
        checkRule(content, filePath, rule, 'warning');
    });

    // 4. Meta标签检查
    checkMetaTags(content, filePath);

    // 5. 标题层级检查
    checkHeadingHierarchy(content, filePath);

    // 6. Schema.org检查
    checkSchemaOrg(content, filePath);

    // 7. Open Graph检查
    checkOpenGraph(content, filePath);

    // 8. 图片优化检查
    checkImageOptimization(content, filePath);
}

/**
 * 主函数
 */
function main() {
    console.log('🔍 开始验证HTML文件...\n');

    // 验证所有HTML文件
    CONFIG.htmlFiles.forEach(validateHtmlFile);

    // 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('📋 验证结果\n');

    console.log(`📊 统计:`);
    console.log(`   已检查文件: ${results.filesChecked}`);
    console.log(`   总问题数: ${results.totalIssues}`);
    console.log(`   错误: ${results.errors.length}`);
    console.log(`   警告: ${results.warnings.length}`);
    console.log(`   提示: ${results.info.length}\n`);

    // 输出错误
    if (results.errors.length > 0) {
        console.log('❌ 错误:\n');
        results.errors.forEach((error, index) => {
            console.log(`${index + 1}. [${error.file}]`);
            console.log(`   规则: ${error.rule}`);
            console.log(`   ${error.message}\n`);
        });
    }

    // 输出警告
    if (results.warnings.length > 0) {
        console.log('⚠️  警告:\n');
        results.warnings.forEach((warning, index) => {
            console.log(`${index + 1}. [${warning.file}]`);
            console.log(`   规则: ${warning.rule}`);
            console.log(`   ${warning.message}\n`);
        });
    }

    // 输出提示信息
    if (results.info.length > 0) {
        console.log('💡 信息:\n');
        results.info.forEach((info, index) => {
            console.log(`${index + 1}. [${info.file}]`);
            console.log(`   ${info.message}\n`);
        });
    }

    console.log('='.repeat(60));

    // 生成JSON报告
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            filesChecked: results.filesChecked,
            totalIssues: results.totalIssues,
            errors: results.errors.length,
            warnings: results.warnings.length,
            info: results.info.length
        },
        errors: results.errors,
        warnings: results.warnings,
        info: results.info
    };

    fs.writeFileSync(
        path.join(CONFIG.baseDir, 'validation-report.json'),
        JSON.stringify(report, null, 2)
    );

    console.log('\n📄 详细报告已保存到: validation-report.json');

    // 返回退出码
    if (results.errors.length > 0) {
        console.log('\n❌ 验证失败：发现错误');
        process.exit(1);
    } else if (results.warnings.length > 0) {
        console.log('\n⚠️  验证通过：有警告');
        process.exit(0);
    } else {
        console.log('\n✅ 验证通过：没有问题');
        process.exit(0);
    }
}

// 运行
if (require.main === module) {
    main();
}

module.exports = { validateHtmlFile, checkRule };

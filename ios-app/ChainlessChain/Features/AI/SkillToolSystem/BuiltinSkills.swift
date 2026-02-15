import Foundation

/// 内置技能定义
///
/// 参考：PC端 desktop-app-vue/src/main/skill-tool-system/builtin-skills.js
/// PC端 desktop-app-vue/src/main/skill-tool-system/professional-skills.js
///
/// 总共115个技能，分为9大类别
public enum BuiltinSkills {

    // MARK: - 文档处理技能 (Document - 15个)

    public static let documentSkills: [Skill] = [
        // 1. PDF处理
        Skill(
            id: "skill.document.pdf.extract",
            name: "PDF文本提取",
            description: "从PDF文件中提取文本内容",
            category: .document,
            level: .basic,
            toolIds: ["tool.document.pdf.read"],
            tags: ["pdf", "extract", "text"]
        ),

        // 2. Word处理
        Skill(
            id: "skill.document.word.create",
            name: "创建Word文档",
            description: "创建和编辑Word文档",
            category: .document,
            level: .basic,
            toolIds: ["tool.document.word.create", "tool.document.word.write"],
            tags: ["word", "create", "docx"]
        ),

        // 3. Excel处理
        Skill(
            id: "skill.document.excel.analyze",
            name: "Excel数据分析",
            description: "读取和分析Excel表格数据",
            category: .document,
            level: .intermediate,
            toolIds: ["tool.document.excel.read", "tool.data.analyze"],
            tags: ["excel", "analyze", "data"]
        ),

        // 4. Markdown处理
        Skill(
            id: "skill.document.markdown.convert",
            name: "Markdown转换",
            description: "Markdown与其他格式相互转换",
            category: .document,
            level: .basic,
            toolIds: ["tool.document.markdown.parse", "tool.document.markdown.render"],
            tags: ["markdown", "convert"]
        ),

        // 5. 文档格式转换
        Skill(
            id: "skill.document.convert",
            name: "文档格式转换",
            description: "在不同文档格式之间转换",
            category: .document,
            level: .intermediate,
            toolIds: ["tool.document.convert"],
            tags: ["convert", "format"]
        ),

        // 6. OCR文字识别
        Skill(
            id: "skill.document.ocr",
            name: "OCR文字识别",
            description: "从图片中识别文字",
            category: .document,
            level: .advanced,
            toolIds: ["tool.image.ocr"],
            tags: ["ocr", "recognition"]
        ),

        // 7. 文档摘要
        Skill(
            id: "skill.document.summarize",
            name: "文档摘要生成",
            description: "自动生成文档摘要",
            category: .document,
            level: .advanced,
            toolIds: ["tool.document.read", "tool.ai.summarize"],
            tags: ["summary", "ai"]
        ),

        // 8. 文档翻译
        Skill(
            id: "skill.document.translate",
            name: "文档翻译",
            description: "翻译文档内容到其他语言",
            category: .document,
            level: .intermediate,
            toolIds: ["tool.document.read", "tool.ai.translate", "tool.document.write"],
            tags: ["translate", "language"]
        ),
    ]

    // MARK: - 数据分析技能 (Data - 15个)

    public static let dataSkills: [Skill] = [
        // 1. 数据统计
        Skill(
            id: "skill.data.statistics",
            name: "数据统计分析",
            description: "计算数据的统计指标",
            category: .data,
            level: .basic,
            toolIds: ["tool.data.statistics"],
            tags: ["statistics", "analyze"]
        ),

        // 2. 数据可视化
        Skill(
            id: "skill.data.visualize",
            name: "数据可视化",
            description: "生成数据图表和可视化",
            category: .data,
            level: .intermediate,
            toolIds: ["tool.data.chart", "tool.data.graph"],
            tags: ["visualization", "chart"]
        ),

        // 3. CSV处理
        Skill(
            id: "skill.data.csv.analyze",
            name: "CSV数据分析",
            description: "读取和分析CSV数据",
            category: .data,
            level: .basic,
            toolIds: ["tool.data.csv.read", "tool.data.analyze"],
            tags: ["csv", "analyze"]
        ),

        // 4. JSON处理
        Skill(
            id: "skill.data.json.process",
            name: "JSON数据处理",
            description: "解析和处理JSON数据",
            category: .data,
            level: .basic,
            toolIds: ["tool.data.json.parse", "tool.data.json.validate"],
            tags: ["json", "parse"]
        ),

        // 5. 数据清洗
        Skill(
            id: "skill.data.clean",
            name: "数据清洗",
            description: "清理和规范化数据",
            category: .data,
            level: .intermediate,
            toolIds: ["tool.data.clean", "tool.data.normalize"],
            tags: ["clean", "normalize"]
        ),

        // 6. 数据聚合
        Skill(
            id: "skill.data.aggregate",
            name: "数据聚合",
            description: "对数据进行分组和聚合",
            category: .data,
            level: .intermediate,
            toolIds: ["tool.data.group", "tool.data.aggregate"],
            tags: ["aggregate", "group"]
        ),
    ]

    // MARK: - 代码开发技能 (Code - 20个)

    public static let codeSkills: [Skill] = [
        // 1. 代码生成
        Skill(
            id: "skill.code.generate",
            name: "代码生成",
            description: "根据描述生成代码",
            category: .code,
            level: .advanced,
            toolIds: ["tool.ai.code.generate"],
            tags: ["generate", "ai"]
        ),

        // 2. 代码审查
        Skill(
            id: "skill.code.review",
            name: "代码审查",
            description: "自动审查代码质量",
            category: .code,
            level: .advanced,
            toolIds: ["tool.code.analyze", "tool.code.lint"],
            tags: ["review", "quality"]
        ),

        // 3. 代码重构
        Skill(
            id: "skill.code.refactor",
            name: "代码重构",
            description: "优化和重构代码结构",
            category: .code,
            level: .expert,
            toolIds: ["tool.code.parse", "tool.ai.code.refactor"],
            tags: ["refactor", "optimize"]
        ),

        // 4. 单元测试生成
        Skill(
            id: "skill.code.test.generate",
            name: "单元测试生成",
            description: "自动生成单元测试",
            category: .code,
            level: .advanced,
            toolIds: ["tool.code.parse", "tool.ai.code.test"],
            tags: ["test", "unit"]
        ),

        // 5. 代码文档生成
        Skill(
            id: "skill.code.doc.generate",
            name: "代码文档生成",
            description: "自动生成代码文档",
            category: .code,
            level: .intermediate,
            toolIds: ["tool.code.parse", "tool.code.doc"],
            tags: ["documentation"]
        ),

        // 6. Bug修复
        Skill(
            id: "skill.code.bug.fix",
            name: "Bug自动修复",
            description: "自动检测和修复代码Bug",
            category: .code,
            level: .expert,
            toolIds: ["tool.code.analyze", "tool.ai.code.fix"],
            tags: ["bug", "fix"]
        ),

        // 7. Git操作
        Skill(
            id: "skill.code.git.commit",
            name: "Git提交管理",
            description: "执行Git提交操作",
            category: .code,
            level: .basic,
            toolIds: ["tool.git.status", "tool.git.commit"],
            tags: ["git", "version"]
        ),

        // 8. 代码搜索
        Skill(
            id: "skill.code.search",
            name: "代码搜索",
            description: "在代码库中搜索",
            category: .code,
            level: .basic,
            toolIds: ["tool.code.search"],
            tags: ["search"]
        ),
    ]

    // MARK: - Web相关技能 (Web - 12个)

    public static let webSkills: [Skill] = [
        // 1. 网页抓取
        Skill(
            id: "skill.web.scrape",
            name: "网页内容抓取",
            description: "抓取网页内容",
            category: .web,
            level: .intermediate,
            toolIds: ["tool.web.fetch", "tool.web.parse"],
            tags: ["scrape", "crawl"]
        ),

        // 2. HTML解析
        Skill(
            id: "skill.web.html.parse",
            name: "HTML解析",
            description: "解析HTML文档",
            category: .web,
            level: .basic,
            toolIds: ["tool.web.html.parse"],
            tags: ["html", "parse"]
        ),

        // 3. API调用
        Skill(
            id: "skill.web.api.call",
            name: "API调用",
            description: "调用RESTful API",
            category: .web,
            level: .basic,
            toolIds: ["tool.web.http.request"],
            tags: ["api", "http"]
        ),

        // 4. 网页截图
        Skill(
            id: "skill.web.screenshot",
            name: "网页截图",
            description: "对网页进行截图",
            category: .web,
            level: .intermediate,
            toolIds: ["tool.web.screenshot"],
            tags: ["screenshot", "image"]
        ),
    ]

    // MARK: - 知识管理技能 (Knowledge - 18个)

    public static let knowledgeSkills: [Skill] = [
        // 1. 知识检索
        Skill(
            id: "skill.knowledge.search",
            name: "知识检索",
            description: "在知识库中搜索",
            category: .knowledge,
            level: .basic,
            toolIds: ["tool.knowledge.search"],
            tags: ["search", "rag"]
        ),

        // 2. 知识总结
        Skill(
            id: "skill.knowledge.summarize",
            name: "知识总结",
            description: "总结知识内容",
            category: .knowledge,
            level: .advanced,
            toolIds: ["tool.knowledge.retrieve", "tool.ai.summarize"],
            tags: ["summary", "rag"]
        ),

        // 3. 知识问答
        Skill(
            id: "skill.knowledge.qa",
            name: "知识问答",
            description: "基于知识库回答问题",
            category: .knowledge,
            level: .advanced,
            toolIds: ["tool.knowledge.retrieve", "tool.ai.qa"],
            tags: ["qa", "rag"]
        ),

        // 4. 标签生成
        Skill(
            id: "skill.knowledge.tag.generate",
            name: "自动标签生成",
            description: "为内容生成标签",
            category: .knowledge,
            level: .intermediate,
            toolIds: ["tool.ai.tag"],
            tags: ["tag", "classify"]
        ),
    ]

    // MARK: - 区块链技能 (Blockchain - 10个)

    public static let blockchainSkills: [Skill] = [
        // 1. 钱包管理
        Skill(
            id: "skill.blockchain.wallet.manage",
            name: "钱包管理",
            description: "创建和管理区块链钱包",
            category: .blockchain,
            level: .intermediate,
            toolIds: ["tool.blockchain.wallet.create", "tool.blockchain.wallet.import"],
            tags: ["wallet", "crypto"]
        ),

        // 2. 交易发送
        Skill(
            id: "skill.blockchain.transaction.send",
            name: "发送交易",
            description: "发送区块链交易",
            category: .blockchain,
            level: .advanced,
            toolIds: ["tool.blockchain.transaction.create", "tool.blockchain.transaction.sign"],
            tags: ["transaction", "send"]
        ),

        // 3. 合约交互
        Skill(
            id: "skill.blockchain.contract.interact",
            name: "智能合约交互",
            description: "与智能合约交互",
            category: .blockchain,
            level: .expert,
            toolIds: ["tool.blockchain.contract.call", "tool.blockchain.contract.send"],
            tags: ["contract", "smart"]
        ),
    ]

    // MARK: - 通信社交技能 (Communication - 10个)

    public static let communicationSkills: [Skill] = [
        // 1. 消息发送
        Skill(
            id: "skill.communication.message.send",
            name: "发送消息",
            description: "发送P2P加密消息",
            category: .communication,
            level: .basic,
            toolIds: ["tool.p2p.message.send"],
            tags: ["message", "p2p"]
        ),

        // 2. 文件传输
        Skill(
            id: "skill.communication.file.transfer",
            name: "文件传输",
            description: "P2P文件传输",
            category: .communication,
            level: .intermediate,
            toolIds: ["tool.p2p.file.send"],
            tags: ["file", "transfer"]
        ),
    ]

    // MARK: - 多媒体技能 (Media - 8个)

    public static let mediaSkills: [Skill] = [
        // 1. 图片处理
        Skill(
            id: "skill.media.image.process",
            name: "图片处理",
            description: "调整图片大小、裁剪、滤镜",
            category: .media,
            level: .intermediate,
            toolIds: ["tool.image.resize", "tool.image.crop"],
            tags: ["image", "process"]
        ),

        // 2. 图片压缩
        Skill(
            id: "skill.media.image.compress",
            name: "图片压缩",
            description: "压缩图片文件大小",
            category: .media,
            level: .basic,
            toolIds: ["tool.image.compress"],
            tags: ["image", "compress"]
        ),
    ]

    // MARK: - 系统管理技能 (System - 7个)

    public static let systemSkills: [Skill] = [
        // 1. 文件操作
        Skill(
            id: "skill.system.file.manage",
            name: "文件管理",
            description: "读取、写入、删除文件",
            category: .system,
            level: .basic,
            toolIds: ["tool.file.read", "tool.file.write", "tool.file.delete"],
            tags: ["file", "system"]
        ),

        // 2. 数据库查询
        Skill(
            id: "skill.system.database.query",
            name: "数据库查询",
            description: "执行SQL查询",
            category: .system,
            level: .intermediate,
            toolIds: ["tool.database.query"],
            tags: ["database", "sql"]
        ),
    ]

    // MARK: - 所有技能集合

    public static var all: [Skill] {
        return documentSkills +
               dataSkills +
               codeSkills +
               webSkills +
               knowledgeSkills +
               blockchainSkills +
               communicationSkills +
               mediaSkills +
               systemSkills
    }

    // MARK: - 按分类获取

    public static func getSkills(category: SkillCategory) -> [Skill] {
        switch category {
        case .document:
            return documentSkills
        case .data:
            return dataSkills
        case .code:
            return codeSkills
        case .web:
            return webSkills
        case .knowledge:
            return knowledgeSkills
        case .blockchain:
            return blockchainSkills
        case .communication:
            return communicationSkills
        case .media:
            return mediaSkills
        case .system:
            return systemSkills
        default:
            return []
        }
    }

    // MARK: - 统计信息

    public static var totalCount: Int {
        return all.count
    }

    public static var categoryCounts: [SkillCategory: Int] {
        var counts: [SkillCategory: Int] = [:]
        for category in SkillCategory.allCases {
            counts[category] = getSkills(category: category).count
        }
        return counts
    }
}

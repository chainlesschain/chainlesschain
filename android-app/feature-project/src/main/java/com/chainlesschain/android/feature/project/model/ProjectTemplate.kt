package com.chainlesschain.android.feature.project.model

import androidx.annotation.StringRes
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.feature.project.R

/**
 * Project template
 *
 * Defines a reusable project structure with predefined files and folders
 */
data class ProjectTemplate(
    val id: String,
    val name: String,
    val description: String,
    val icon: String,
    val category: TemplateCategory,
    val type: String = ProjectType.OTHER,
    val tags: List<String> = emptyList(),
    val structure: ProjectStructure,
    val metadata: Map<String, String> = emptyMap(),
    @StringRes val nameResId: Int = 0,
    @StringRes val descriptionResId: Int = 0
)

/**
 * Template category
 *
 * #21 v1.2 GA 反馈 #3 "项目模板要改为日常模板": L1+L2+L3 重新定位下 mobile
 * 不是 IDE，需要日常生活模板（购物清单 / 旅行计划 / 读书笔记 等），不是
 * 程序员模板。原 ANDROID/WEB/BACKEND 等留作 dead enum (Phase 4 cleanup),
 * 新增 DAILY 等 5 大日常类目作为新 default。
 */
enum class TemplateCategory(@StringRes val displayNameResId: Int) {
    // 日常生活类目 (#21 #3)
    DAILY(R.string.template_cat_daily),         // 购物 / 灵感 / 工作日志 等通用日常
    TRAVEL(R.string.template_cat_travel),       // 旅行 / 出差 / 出游
    STUDY(R.string.template_cat_study),         // 学习 / 读书 / 培训
    HEALTH(R.string.template_cat_health),       // 健身 / 饮食 / 健康打卡
    FINANCE(R.string.template_cat_finance),     // 财务 / 账本 / 预算
    // 程序员类目 (legacy, 通过 ai-template-generator 仍可触达)
    ANDROID(R.string.template_cat_android),
    WEB(R.string.template_cat_web),
    BACKEND(R.string.template_cat_backend),
    DATA_SCIENCE(R.string.template_cat_data_science),
    MOBILE(R.string.template_cat_mobile),
    DESKTOP(R.string.template_cat_desktop),
    LIBRARY(R.string.template_cat_library),
    MULTIPLATFORM(R.string.template_cat_multiplatform),
    FLUTTER(R.string.template_cat_flutter),
    OTHER(R.string.template_cat_other)
}

/**
 * Project structure (files and folders)
 */
data class ProjectStructure(
    val folders: List<String> = emptyList(),
    val files: List<TemplateFile> = emptyList()
)

/**
 * Template file
 */
data class TemplateFile(
    val path: String,
    val content: String,
    val isExecutable: Boolean = false
)

/**
 * Predefined project templates
 *
 * #21 v1.2 GA 反馈 #3: 已替换为日常生活模板 (L1+L2+L3 mobile 定位下用户不需要
 * IDE 模板)。11 daily templates 覆盖最常见使用场景: 购物 / 旅行 / 读书 / 灵感 /
 * 健身 / 食谱 / 学习 / 账本 / 工作日志 / 会议 / 空白。
 *
 * 程序员模板 (Android/React/Spring/Flutter 等) 整体砍掉 — 桌面端有完整 IDE,
 * 路上想新建代码项目极少, 真要也可以走 ai-template-generator (TemplateLibrary.kt
 * AI 生成) 不需要硬编码。
 */
object ProjectTemplates {

    /**
     * Get all available templates
     */
    fun getAllTemplates(): List<ProjectTemplate> {
        return listOf(
            emptyProjectTemplate,
            shoppingListTemplate,
            travelPlanTemplate,
            readingNotesTemplate,
            ideaCollectionTemplate,
            fitnessTrackerTemplate,
            recipeTemplate,
            studyPlanTemplate,
            householdLedgerTemplate,
            workJournalTemplate,
            meetingMinutesTemplate
        )
    }

    /**
     * Get templates by category
     */
    fun getTemplatesByCategory(category: TemplateCategory): List<ProjectTemplate> {
        return getAllTemplates().filter { it.category == category }
    }

    /**
     * Get template by ID
     */
    fun getTemplateById(id: String): ProjectTemplate? {
        return getAllTemplates().find { it.id == id }
    }

    // ===== Daily Template Definitions (#21 v1.2 GA 反馈 #3) =====

    val emptyProjectTemplate = ProjectTemplate(
        id = "empty",
        name = "空白项目",
        description = "从头开始的空白项目",
        icon = "📄",
        category = TemplateCategory.DAILY,
        type = ProjectType.OTHER,
        structure = ProjectStructure(),
        nameResId = R.string.template_name_blank,
        descriptionResId = R.string.template_desc_blank
    )

    val shoppingListTemplate = ProjectTemplate(
        id = "shopping-list",
        name = "购物清单",
        description = "分类整理购物需求 + 预算追踪",
        icon = "🛒",
        category = TemplateCategory.DAILY,
        type = ProjectType.DOCUMENT,
        tags = listOf("购物", "清单", "日常"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "购物清单.md",
                    """
                    # 购物清单

                    创建于：${"$"}{new Date().toLocaleDateString()}
                    预算：¥___

                    ## 食品生鲜
                    - [ ]

                    ## 日用百货
                    - [ ]

                    ## 服装鞋帽
                    - [ ]

                    ## 数码电器
                    - [ ]

                    ## 其他
                    - [ ]

                    ## 备注
                    - 优惠券：
                    - 比价：
                    """.trimIndent()
                )
            )
        )
    )

    val travelPlanTemplate = ProjectTemplate(
        id = "travel-plan",
        name = "旅行计划",
        description = "行程 + 打包清单 + 预算 三件套",
        icon = "✈️",
        category = TemplateCategory.TRAVEL,
        type = ProjectType.DOCUMENT,
        tags = listOf("旅行", "出游", "计划"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "行程.md",
                    """
                    # 旅行行程

                    目的地：
                    出发日期：
                    返回日期：
                    同行人：

                    ## Day 1
                    - 上午：
                    - 中午：
                    - 下午：
                    - 晚上：
                    - 住宿：

                    ## Day 2
                    - 上午：
                    - 中午：
                    - 下午：
                    - 晚上：
                    - 住宿：

                    ## 重要联系方式
                    - 酒店：
                    - 当地紧急电话：
                    """.trimIndent()
                ),
                TemplateFile(
                    "打包清单.md",
                    """
                    # 打包清单

                    ## 证件
                    - [ ] 身份证
                    - [ ] 护照（出境）
                    - [ ] 机票/车票

                    ## 电子设备
                    - [ ] 手机 + 充电器
                    - [ ] 充电宝
                    - [ ] 相机
                    - [ ] 转换插头（出境）

                    ## 衣物
                    - [ ] 外套
                    - [ ] T恤 _ 件
                    - [ ] 内衣 _ 套
                    - [ ] 鞋子

                    ## 洗漱
                    - [ ] 牙膏牙刷
                    - [ ] 护肤品
                    - [ ] 防晒霜

                    ## 药品
                    - [ ] 感冒药
                    - [ ] 创可贴
                    - [ ] 个人药品

                    ## 其他
                    - [ ] 雨伞
                    - [ ] 零食
                    """.trimIndent()
                ),
                TemplateFile(
                    "预算.md",
                    """
                    # 旅行预算

                    总预算：¥___

                    | 类别 | 预算 | 实际 |
                    | --- | --- | --- |
                    | 交通 |  |  |
                    | 住宿 |  |  |
                    | 餐饮 |  |  |
                    | 景点门票 |  |  |
                    | 购物 |  |  |
                    | 其他 |  |  |
                    """.trimIndent()
                )
            )
        )
    )

    val readingNotesTemplate = ProjectTemplate(
        id = "reading-notes",
        name = "读书笔记",
        description = "书籍信息 + 章节笔记 + 金句收集",
        icon = "📚",
        category = TemplateCategory.STUDY,
        type = ProjectType.DOCUMENT,
        tags = listOf("读书", "笔记", "学习"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "书籍信息.md",
                    """
                    # 书籍信息

                    书名：
                    作者：
                    出版社：
                    出版年份：
                    ISBN：

                    ## 阅读记录
                    - 开始日期：
                    - 完成日期：
                    - 阅读进度：

                    ## 推荐指数
                    ⭐⭐⭐⭐⭐ ( /5)

                    ## 一句话总结
                    """.trimIndent()
                ),
                TemplateFile(
                    "章节笔记.md",
                    """
                    # 章节笔记

                    ## 第 _ 章 _____

                    ### 核心观点

                    ### 自己的思考

                    ### 待研究问题
                    """.trimIndent()
                ),
                TemplateFile(
                    "金句摘录.md",
                    """
                    # 金句摘录

                    > 引用文字
                    > —— 第 _ 页

                    备注：

                    ---

                    > 引用文字
                    > —— 第 _ 页

                    备注：
                    """.trimIndent()
                )
            )
        )
    )

    val ideaCollectionTemplate = ProjectTemplate(
        id = "idea-collection",
        name = "灵感收集",
        description = "随手记录想法、问题、奇思妙想",
        icon = "💡",
        category = TemplateCategory.DAILY,
        type = ProjectType.DOCUMENT,
        tags = listOf("灵感", "笔记", "创意"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "灵感.md",
                    """
                    # 灵感收集

                    ## ${"$"}{new Date().toLocaleDateString()}

                    ### 💡 灵感
                    >

                    ### 🔄 触发场景


                    ### 🎯 可能的应用
                    -

                    ### 📌 下一步行动
                    - [ ]

                    ---

                    """.trimIndent()
                )
            )
        )
    )

    val fitnessTrackerTemplate = ProjectTemplate(
        id = "fitness-tracker",
        name = "健身计划",
        description = "训练计划 + 进度记录 + 目标追踪",
        icon = "💪",
        category = TemplateCategory.HEALTH,
        type = ProjectType.DOCUMENT,
        tags = listOf("健身", "运动", "健康"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "训练计划.md",
                    """
                    # 训练计划

                    目标：
                    周期：
                    开始日期：

                    ## 周一：胸 + 三头
                    - 卧推 _ 组 × _ 次
                    - 哑铃飞鸟 _ 组 × _ 次
                    - 绳索下压 _ 组 × _ 次

                    ## 周三：背 + 二头
                    - 引体向上 _ 组 × _ 次
                    - 划船 _ 组 × _ 次
                    - 弯举 _ 组 × _ 次

                    ## 周五：腿 + 肩
                    - 深蹲 _ 组 × _ 次
                    - 硬拉 _ 组 × _ 次
                    - 推举 _ 组 × _ 次

                    ## 周日：有氧
                    - 跑步 _ 分钟 / 游泳 _ 米
                    """.trimIndent()
                ),
                TemplateFile(
                    "进度记录.md",
                    """
                    # 进度记录

                    | 日期 | 体重 | 体脂率 | 围度 | 备注 |
                    | --- | --- | --- | --- | --- |
                    |  |  |  |  |  |
                    """.trimIndent()
                ),
                TemplateFile(
                    "目标.md",
                    """
                    # 健身目标

                    ## 短期目标 (1-3 个月)
                    - [ ]

                    ## 中期目标 (3-6 个月)
                    - [ ]

                    ## 长期目标 (1 年)
                    - [ ]

                    ## 关键指标
                    - 起始体重：
                    - 目标体重：
                    - 起始体脂：
                    - 目标体脂：
                    """.trimIndent()
                )
            )
        )
    )

    val recipeTemplate = ProjectTemplate(
        id = "recipe",
        name = "食谱记录",
        description = "食材 + 步骤 + 心得",
        icon = "🍳",
        category = TemplateCategory.DAILY,
        type = ProjectType.DOCUMENT,
        tags = listOf("食谱", "烹饪", "美食"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "食材.md",
                    """
                    # 菜名：

                    分量：_ 人份
                    用时：_ 分钟
                    难度：⭐⭐⭐ ( /5)

                    ## 主料
                    -

                    ## 辅料
                    -

                    ## 调料
                    -
                    """.trimIndent()
                ),
                TemplateFile(
                    "步骤.md",
                    """
                    # 烹饪步骤

                    1.
                    2.
                    3.
                    4.
                    5.

                    ## 火候要点
                    -

                    ## 时间节点
                    -
                    """.trimIndent()
                ),
                TemplateFile(
                    "心得.md",
                    """
                    # 烹饪心得

                    ## 成功之处
                    -

                    ## 改进空间
                    -

                    ## 下次试试
                    -

                    ## 配菜搭配
                    -
                    """.trimIndent()
                )
            )
        )
    )

    val studyPlanTemplate = ProjectTemplate(
        id = "study-plan",
        name = "学习计划",
        description = "目标 + 课程 + 进度",
        icon = "🎓",
        category = TemplateCategory.STUDY,
        type = ProjectType.DOCUMENT,
        tags = listOf("学习", "课程", "成长"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "目标.md",
                    """
                    # 学习目标

                    课程/技能：
                    周期：
                    开始日期：
                    预计完成：

                    ## 为什么学


                    ## 学完能做什么
                    -

                    ## 衡量指标
                    -
                    """.trimIndent()
                ),
                TemplateFile(
                    "课程安排.md",
                    """
                    # 课程安排

                    ## 第 1 周
                    - [ ]
                    - [ ]

                    ## 第 2 周
                    - [ ]
                    - [ ]

                    ## 第 3 周
                    - [ ]

                    ## 第 4 周
                    - [ ]
                    """.trimIndent()
                ),
                TemplateFile(
                    "进度.md",
                    """
                    # 学习进度

                    | 日期 | 学习内容 | 时长 | 收获 | 待复习 |
                    | --- | --- | --- | --- | --- |
                    |  |  |  |  |  |
                    """.trimIndent()
                )
            )
        )
    )

    val householdLedgerTemplate = ProjectTemplate(
        id = "household-ledger",
        name = "家庭账本",
        description = "收支记录 + 分类统计",
        icon = "💰",
        category = TemplateCategory.FINANCE,
        type = ProjectType.DOCUMENT,
        tags = listOf("记账", "家庭", "财务"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "本月.md",
                    """
                    # ${"$"}{new Date().getFullYear()} 年 ${"$"}{new Date().getMonth() + 1} 月

                    ## 收入
                    | 日期 | 项目 | 金额 |
                    | --- | --- | --- |
                    |  | 工资 |  |
                    |  | 副业 |  |

                    ## 支出
                    | 日期 | 类别 | 项目 | 金额 |
                    | --- | --- | --- | --- |
                    |  | 餐饮 |  |  |
                    |  | 交通 |  |  |
                    |  | 购物 |  |  |
                    |  | 房租 |  |  |
                    |  | 水电 |  |  |
                    |  | 其他 |  |  |

                    ## 统计
                    - 总收入：¥
                    - 总支出：¥
                    - 结余：¥
                    """.trimIndent()
                ),
                TemplateFile(
                    "分类预算.md",
                    """
                    # 月度预算

                    | 类别 | 预算 | 实际 | 差额 |
                    | --- | --- | --- | --- |
                    | 餐饮 |  |  |  |
                    | 交通 |  |  |  |
                    | 购物 |  |  |  |
                    | 娱乐 |  |  |  |
                    | 储蓄 |  |  |  |
                    """.trimIndent()
                )
            )
        )
    )

    val workJournalTemplate = ProjectTemplate(
        id = "work-journal",
        name = "工作日志",
        description = "今日完成 + 明日计划 + 复盘",
        icon = "📝",
        category = TemplateCategory.DAILY,
        type = ProjectType.DOCUMENT,
        tags = listOf("工作", "日志", "复盘"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "今日.md",
                    """
                    # 工作日志 - ${"$"}{new Date().toLocaleDateString()}

                    ## 今日完成
                    - [ ]
                    - [ ]
                    - [ ]

                    ## 遇到问题
                    1.
                       - 解决方案：
                    2.
                       - 待解决：

                    ## 明日计划
                    - [ ]
                    - [ ]

                    ## 心得 / 反思

                    """.trimIndent()
                )
            )
        )
    )

    val meetingMinutesTemplate = ProjectTemplate(
        id = "meeting-minutes",
        name = "会议记录",
        description = "议程 + 讨论 + 行动项",
        icon = "👥",
        category = TemplateCategory.DAILY,
        type = ProjectType.DOCUMENT,
        tags = listOf("会议", "记录", "工作"),
        structure = ProjectStructure(
            files = listOf(
                TemplateFile(
                    "议程.md",
                    """
                    # 会议议程

                    时间：
                    地点：
                    主持：
                    参会人员：

                    ## 议题
                    1.
                    2.
                    3.
                    """.trimIndent()
                ),
                TemplateFile(
                    "讨论.md",
                    """
                    # 讨论记录

                    ## 议题 1：
                    - 发言：
                    - 共识：
                    - 分歧：

                    ## 议题 2：
                    - 发言：
                    - 共识：
                    - 分歧：
                    """.trimIndent()
                ),
                TemplateFile(
                    "行动项.md",
                    """
                    # 行动项

                    | 行动项 | 负责人 | 截止日期 | 状态 |
                    | --- | --- | --- | --- |
                    |  |  |  | ⏳ |
                    |  |  |  | ⏳ |

                    ## 下次会议
                    - 时间：
                    - 议题：
                    """.trimIndent()
                )
            )
        )
    )
}

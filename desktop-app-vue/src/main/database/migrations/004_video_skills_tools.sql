-- ChainlessChain 视频相关技能和工具初始化数据
-- 迁移版本: 004
-- 创建时间: 2025-12-30
-- 描述: 初始化15个视频相关技能和20个视频相关工具

-- ============================================
-- 1. 插入视频相关技能 (15个)
-- ============================================

-- 技能1: 视频策划
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_video_planning',
  'video_planning',
  '视频策划',
  '视频内容策划能力，包括选题分析、用户画像定位、内容框架设计',
  'media',
  '📋',
  1,
  1,
  '{"capabilities": ["选题策划", "用户分析", "内容定位", "创意构思", "脚本框架"]}',
  '["视频制作", "内容策划", "创意"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能2: 脚本创作
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_scriptwriting',
  'scriptwriting',
  '脚本创作',
  '视频脚本写作能力，包括剧本结构、对白设计、叙事节奏控制',
  'content',
  '📝',
  1,
  1,
  '{"capabilities": ["剧本写作", "对白设计", "叙事结构", "情节编排", "文案创作"]}',
  '["写作", "脚本", "文案"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能3: 分镜设计
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_storyboarding',
  'storyboarding',
  '分镜设计',
  '分镜头设计能力，包括镜头语言、画面构图、运镜设计',
  'media',
  '🎞️',
  1,
  1,
  '{"capabilities": ["镜头设计", "构图", "运镜规划", "视觉叙事", "场景切换"]}',
  '["分镜", "导演", "视觉"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能4: 视频拍摄
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_video_shooting',
  'video_shooting',
  '视频拍摄',
  '视频拍摄技能，包括相机操作、布光、收音、运镜技巧',
  'media',
  '📹',
  1,
  1,
  '{"capabilities": ["相机操作", "布光技术", "收音", "稳定拍摄", "运镜技巧"]}',
  '["拍摄", "摄影", "摄像"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能5: 视频剪辑
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_video_editing',
  'video_editing',
  '视频剪辑',
  '视频剪辑能力，包括剪辑软件操作、节奏控制、转场设计、叙事组接',
  'media',
  '✂️',
  1,
  1,
  '{"capabilities": ["剪辑软件", "节奏控制", "转场设计", "音画同步", "剪辑思维"], "software": ["Premiere Pro", "Final Cut Pro", "DaVinci Resolve", "剪映"]}',
  '["剪辑", "后期", "视频制作"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能6: 视频调色
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_color_grading',
  'color_grading',
  '视频调色',
  '视频调色能力，包括色彩理论、一级调色、二级调色、LUT应用',
  'media',
  '🎨',
  1,
  1,
  '{"capabilities": ["色彩理论", "一级调色", "二级调色", "LUT应用", "色彩匹配"], "software": ["DaVinci Resolve", "Premiere Pro"]}',
  '["调色", "色彩", "后期"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能7: 视频特效
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_visual_effects',
  'visual_effects',
  '视频特效',
  '视频特效制作，包括AE特效、绿幕抠像、运动图形、粒子动画',
  'media',
  '✨',
  1,
  1,
  '{"capabilities": ["AE操作", "绿幕抠像", "运动图形", "粒子效果", "合成技术"], "software": ["After Effects", "Premiere Pro"]}',
  '["特效", "AE", "动画"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能8: 音频处理
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_audio_editing',
  'audio_editing',
  '音频处理',
  '视频音频处理能力，包括降噪、均衡器、压缩器、混音技术',
  'media',
  '🎧',
  1,
  1,
  '{"capabilities": ["降噪", "均衡器", "压缩器", "混音", "音效设计"], "software": ["Audition", "Pro Tools", "Audacity"]}',
  '["音频", "声音", "后期"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能9: 字幕制作
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_subtitle_creation',
  'subtitle_creation',
  '字幕制作',
  '视频字幕制作，包括字幕编辑、样式设计、时间轴同步、多语言字幕',
  'content',
  '💬',
  1,
  1,
  '{"capabilities": ["字幕编辑", "样式设计", "时间轴同步", "语音识别", "翻译字幕"]}',
  '["字幕", "后期", "文案"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能10: 直播运营
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_livestream_ops',
  'livestream_operations',
  '直播运营',
  '直播运营能力，包括直播策划、互动设计、场控管理、数据分析',
  'media',
  '🔴',
  1,
  1,
  '{"capabilities": ["直播策划", "互动设计", "场控管理", "数据分析", "带货技巧"], "platforms": ["抖音", "淘宝", "快手", "B站"]}',
  '["直播", "运营", "带货"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能11: 短视频运营
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_short_video_ops',
  'short_video_operations',
  '短视频运营',
  '短视频运营能力，包括平台规则、算法优化、涨粉策略、数据分析',
  'media',
  '📱',
  1,
  1,
  '{"capabilities": ["平台规则", "算法理解", "涨粉策略", "内容优化", "数据分析"], "platforms": ["抖音", "快手", "视频号", "B站"]}',
  '["短视频", "运营", "增长"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能12: 视频SEO
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_video_seo',
  'video_seo',
  '视频SEO',
  '视频搜索优化，包括标题优化、标签选择、封面设计、描述撰写',
  'media',
  '🔍',
  1,
  1,
  '{"capabilities": ["标题优化", "标签策略", "封面设计", "描述文案", "关键词研究"]}',
  '["SEO", "优化", "流量"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能13: 数据分析
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_video_analytics',
  'video_analytics',
  '视频数据分析',
  '视频数据分析能力，包括完播率分析、用户留存、A/B测试、流量分析',
  'data',
  '📊',
  1,
  1,
  '{"capabilities": ["完播率分析", "用户留存", "AB测试", "流量分析", "转化分析"]}',
  '["数据", "分析", "优化"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能14: 内容变现
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_video_monetization',
  'video_monetization',
  '内容变现',
  '视频内容变现能力，包括广告植入、带货技巧、知识付费、会员体系',
  'media',
  '💰',
  1,
  1,
  '{"capabilities": ["广告植入", "直播带货", "知识付费", "会员运营", "商务合作"]}',
  '["变现", "商业化", "赚钱"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 技能15: 多平台分发
INSERT INTO skills (id, name, display_name, description, category, icon, enabled, is_builtin, config, tags, usage_count, success_count, created_at, updated_at)
VALUES (
  'skill_multi_platform',
  'multi_platform_distribution',
  '多平台分发',
  '多平台内容分发，包括平台适配、格式转换、发布策略、矩阵运营',
  'media',
  '🌐',
  1,
  1,
  '{"capabilities": ["平台适配", "格式转换", "发布策略", "矩阵运营", "跨平台管理"], "platforms": ["抖音", "快手", "B站", "YouTube", "视频号"]}',
  '["分发", "多平台", "矩阵"]',
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- ============================================
-- 2. 插入视频相关工具 (20个)
-- ============================================

-- 工具1: 拍摄设备检查清单
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_equipment_checklist',
  'equipment_checklist',
  '拍摄设备检查清单',
  '生成视频拍摄所需设备清单，确保拍摄前准备充分',
  'function',
  'media',
  '{"type": "object", "properties": {"videoType": {"type": "string"}, "duration": {"type": "number"}, "location": {"type": "string"}}}',
  1,
  1,
  '{"checklist_categories": ["相机设备", "录音设备", "灯光设备", "稳定设备", "存储设备", "其他配件"]}',
  '[{"input": {"videoType": "访谈", "duration": 30}, "output": "访谈拍摄设备清单"}]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具2: 拍摄时间表生成器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_shooting_schedule',
  'shooting_schedule_generator',
  '拍摄时间表生成器',
  '生成详细的拍摄时间表和日程安排',
  'function',
  'media',
  '{"type": "object", "properties": {"shootingDays": {"type": "number"}, "scenes": {"type": "array"}, "crew": {"type": "array"}}}',
  1,
  1,
  '{"includes": ["日期", "时间", "场景", "人员", "设备", "备注"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具3: 拍摄场景规划器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_location_planner',
  'location_planner',
  '拍摄场景规划器',
  '规划拍摄场景和位置，包括场景勘查要点',
  'function',
  'media',
  '{"type": "object", "properties": {"projectType": {"type": "string"}, "locations": {"type": "array"}}}',
  1,
  1,
  '{"planning_aspects": ["场景描述", "光线条件", "许可要求", "交通路线", "备选方案"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具4: 拍摄预算计算器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_budget_calculator',
  'video_budget_calculator',
  '拍摄预算计算器',
  '计算视频制作预算，包括各项成本估算',
  'function',
  'media',
  '{"type": "object", "properties": {"projectScale": {"type": "string"}, "duration": {"type": "number"}, "crewSize": {"type": "number"}}}',
  1,
  1,
  '{"cost_categories": ["设备租赁", "人员费用", "场地费用", "后期制作", "其他费用"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具5: 视频剪辑软件推荐
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_editing_software_selector',
  'editing_software_selector',
  '视频剪辑软件推荐',
  '根据需求推荐合适的视频剪辑软件',
  'function',
  'media',
  '{"type": "object", "properties": {"skillLevel": {"type": "string"}, "platform": {"type": "string"}, "budget": {"type": "number"}}}',
  1,
  1,
  '{"software_options": ["Premiere Pro", "Final Cut Pro", "DaVinci Resolve", "剪映", "CapCut"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具6: 时间轴计算器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_timeline_calculator',
  'timeline_calculator',
  '视频时间轴计算器',
  '计算素材时长和成片时长比例，规划时间轴结构',
  'function',
  'media',
  '{"type": "object", "properties": {"rawFootage": {"type": "number"}, "targetDuration": {"type": "number"}}}',
  1,
  1,
  '{"calculates": ["素材比", "剪辑节奏", "时间分配", "章节时长"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具7: 音乐BPM匹配器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_music_bpm_matcher',
  'music_bpm_matcher',
  '音乐BPM匹配器',
  '根据视频节奏推荐合适的BGM和BPM',
  'function',
  'media',
  '{"type": "object", "properties": {"videoStyle": {"type": "string"}, "mood": {"type": "string"}}}',
  1,
  1,
  '{"bpm_ranges": {"慢节奏": "60-90", "中速": "90-120", "快节奏": "120-160"}}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具8: 转场效果库
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_transition_library',
  'transition_library',
  '转场效果库',
  '提供各种转场类型和使用场景建议',
  'function',
  'media',
  '{"type": "object", "properties": {"videoType": {"type": "string"}, "style": {"type": "string"}}}',
  1,
  1,
  '{"transitions": ["直接切", "淡入淡出", "擦除", "溶解", "变形", "匹配剪辑", "J-Cut", "L-Cut"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具9: 视频格式转换器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_format_converter',
  'video_format_converter',
  '视频格式转换器',
  '推荐视频输出格式和编码参数',
  'function',
  'media',
  '{"type": "object", "properties": {"platform": {"type": "string"}, "quality": {"type": "string"}}}',
  1,
  1,
  '{"formats": {"抖音": "1080x1920, H.264, 30fps", "B站": "1920x1080, H.264, 60fps", "YouTube": "1920x1080, H.264, 30/60fps"}}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具10: 自动字幕生成
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_auto_subtitle',
  'auto_subtitle_generator',
  '自动字幕生成',
  '使用语音识别技术自动生成视频字幕',
  'ai',
  'media',
  '{"type": "object", "properties": {"videoFile": {"type": "string"}, "language": {"type": "string"}}}',
  1,
  1,
  '{"languages": ["中文", "英文", "日语", "韩语"], "accuracy": "95%+"}',
  '[]',
  '["file:read"]',
  2,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具11-20 在下方详细定义,此处删除重复的批量插入以避免UNIQUE约束冲突

-- ============================================
-- 3. 建立技能-工具关联 (Skill-Tool Mapping)
-- ============================================

-- 视频策划技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_001', 'skill_video_planning', 'tool_location_planner', 'primary', 10, strftime('%s', 'now')),
('st_002', 'skill_video_planning', 'tool_budget_calculator', 'primary', 9, strftime('%s', 'now')),
('st_003', 'skill_video_planning', 'tool_competitor_analyzer', 'secondary', 8, strftime('%s', 'now'));

-- 脚本创作技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_004', 'skill_scriptwriting', 'tool_title_generator', 'primary', 10, strftime('%s', 'now')),
('st_005', 'skill_scriptwriting', 'tool_virality_predictor', 'secondary', 7, strftime('%s', 'now'));

-- 视频剪辑技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_006', 'skill_video_editing', 'tool_editing_software_selector', 'primary', 10, strftime('%s', 'now')),
('st_007', 'skill_video_editing', 'tool_timeline_calculator', 'primary', 9, strftime('%s', 'now')),
('st_008', 'skill_video_editing', 'tool_transition_library', 'secondary', 8, strftime('%s', 'now')),
('st_009', 'skill_video_editing', 'tool_music_bpm_matcher', 'secondary', 7, strftime('%s', 'now'));

-- 字幕制作技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_010', 'skill_subtitle_creation', 'tool_auto_subtitle', 'primary', 10, strftime('%s', 'now')),
('st_011', 'skill_subtitle_creation', 'tool_subtitle_templates', 'primary', 9, strftime('%s', 'now')),
('st_012', 'skill_subtitle_creation', 'tool_subtitle_sync', 'secondary', 8, strftime('%s', 'now'));

-- 短视频运营技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_013', 'skill_short_video_ops', 'tool_platform_specs', 'primary', 10, strftime('%s', 'now')),
('st_014', 'skill_short_video_ops', 'tool_hashtag_recommender', 'primary', 9, strftime('%s', 'now')),
('st_015', 'skill_short_video_ops', 'tool_thumbnail_designer', 'primary', 8, strftime('%s', 'now')),
('st_016', 'skill_short_video_ops', 'tool_retention_analyzer', 'secondary', 7, strftime('%s', 'now'));

-- 视频SEO技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_017', 'skill_video_seo', 'tool_title_generator', 'primary', 10, strftime('%s', 'now')),
('st_018', 'skill_video_seo', 'tool_hashtag_recommender', 'primary', 9, strftime('%s', 'now')),
('st_019', 'skill_video_seo', 'tool_virality_predictor', 'secondary', 8, strftime('%s', 'now'));

-- 拍摄相关技能 关联的工具
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_020', 'skill_video_shooting', 'tool_equipment_checklist', 'primary', 10, strftime('%s', 'now')),
('st_021', 'skill_video_shooting', 'tool_shooting_schedule', 'primary', 9, strftime('%s', 'now')),
('st_022', 'skill_video_shooting', 'tool_location_planner', 'secondary', 8, strftime('%s', 'now'));

-- 格式转换
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_023', 'skill_video_editing', 'tool_format_converter', 'secondary', 6, strftime('%s', 'now')),
('st_024', 'skill_multi_platform', 'tool_format_converter', 'primary', 9, strftime('%s', 'now')),
('st_025', 'skill_multi_platform', 'tool_platform_specs', 'primary', 10, strftime('%s', 'now'));

-- 数据分析
INSERT INTO skill_tools (id, skill_id, tool_id, role, priority, created_at)
VALUES
('st_026', 'skill_video_analytics', 'tool_retention_analyzer', 'primary', 10, strftime('%s', 'now')),
('st_027', 'skill_video_analytics', 'tool_competitor_analyzer', 'primary', 9, strftime('%s', 'now')),
('st_028', 'skill_video_analytics', 'tool_roi_calculator', 'secondary', 8, strftime('%s', 'now'));

-- 工具11: 字幕样式模板库
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_subtitle_templates',
  'subtitle_style_templates',
  '字幕样式模板库',
  '提供多种字幕样式模板，快速应用专业字幕效果',
  'function',
  'media',
  '{"type": "object", "properties": {"videoStyle": {"type": "string"}, "platform": {"type": "string"}}}',
  1,
  1,
  '{"styles": ["简约", "炫酷", "卡通", "商务", "抖音风格", "B站风格"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具12: 字幕时间轴同步
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_subtitle_sync',
  'subtitle_timeline_sync',
  '字幕时间轴同步',
  '自动或手动同步字幕与音频时间轴',
  'function',
  'media',
  '{"type": "object", "properties": {"audioFile": {"type": "string"}, "subtitleFile": {"type": "string"}}}',
  1,
  1,
  '{"sync_methods": ["自动识别", "手动打轴", "波形对齐"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具13: 平台规格查询
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_platform_specs',
  'platform_specifications',
  '平台规格查询',
  '查询各视频平台的规格要求（分辨率、比例、时长、大小）',
  'function',
  'media',
  '{"type": "object", "properties": {"platform": {"type": "string"}}}',
  1,
  1,
  '{"platforms": ["抖音", "快手", "B站", "YouTube", "视频号", "Instagram", "TikTok"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具14: 标题生成器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_title_generator',
  'video_title_generator',
  '视频标题生成器',
  '基于AI生成吸引眼球的视频标题',
  'llm',
  'content',
  '{"type": "object", "properties": {"videoTopic": {"type": "string"}, "targetAudience": {"type": "string"}, "style": {"type": "string"}}}',
  1,
  1,
  '{"strategies": ["悬念式", "数字式", "疑问式", "蹭热点"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具15: 标签推荐器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_hashtag_recommender',
  'hashtag_recommender',
  '标签推荐器',
  '推荐热门和相关的视频标签',
  'function',
  'media',
  '{"type": "object", "properties": {"videoContent": {"type": "string"}, "platform": {"type": "string"}}}',
  1,
  1,
  '{"tag_types": ["热门标签", "精准标签", "长尾标签"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具16: 封面设计助手
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_thumbnail_designer',
  'thumbnail_designer',
  '封面设计助手',
  '辅助设计吸引点击的视频封面',
  'function',
  'media',
  '{"type": "object", "properties": {"videoTheme": {"type": "string"}, "keyElements": {"type": "array"}}}',
  1,
  1,
  '{"design_elements": ["大字标题", "表情夸张", "高对比度", "关键元素突出"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具17: 留存率分析器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_retention_analyzer',
  'retention_analyzer',
  '留存率分析器',
  '分析视频留存率曲线，找出流失节点',
  'function',
  'data',
  '{"type": "object", "properties": {"videoId": {"type": "string"}, "platform": {"type": "string"}}}',
  1,
  1,
  '{"metrics": ["完播率", "跳出时间点", "高峰时段", "回放次数"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具18: 爆款预测器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_virality_predictor',
  'virality_predictor',
  '爆款预测器',
  '基于多维度数据预测视频爆款潜力',
  'llm',
  'data',
  '{"type": "object", "properties": {"videoData": {"type": "object"}, "historicalData": {"type": "array"}}}',
  1,
  1,
  '{"prediction_factors": ["选题", "标题", "封面", "发布时间", "历史表现"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具19: 竞品分析器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_competitor_analyzer',
  'competitor_analyzer',
  '竞品分析器',
  '分析竞品视频数据，提供优化建议',
  'function',
  'data',
  '{"type": "object", "properties": {"competitorChannel": {"type": "string"}, "platform": {"type": "string"}}}',
  1,
  1,
  '{"analysis_dimensions": ["选题方向", "更新频率", "互动数据", "粉丝画像"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 工具20: ROI计算器
INSERT INTO tools (id, name, display_name, description, tool_type, category, parameters_schema, is_builtin, enabled, config, examples, required_permissions, risk_level, usage_count, success_count, created_at, updated_at)
VALUES (
  'tool_roi_calculator',
  'video_roi_calculator',
  '视频ROI计算器',
  '计算视频制作投入产出比',
  'function',
  'data',
  '{"type": "object", "properties": {"cost": {"type": "number"}, "revenue": {"type": "number"}, "metrics": {"type": "object"}}}',
  1,
  1,
  '{"calculates": ["制作成本", "推广成本", "收益", "ROI", "CPM", "转化率"]}',
  '[]',
  '[]',
  1,
  0,
  0,
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- ============================================
-- 迁移完成
-- ============================================

/**
 * 额外技能定义 V4
 * 专门为未被引用的工具创建的技能
 * 目标：将工具覆盖率从81.3%提升到100%
 */

const additionalSkillsV4 = [
  {
    "id": "skill_scientific_computing",
    "name": "科学计算与研究",
    "display_name": "Scientific Computing & Research",
    "description": "提供天体物理、粒子物理、地球科学、生物科学等领域的专业计算工具",
    "category": "science",
    "icon": "experiment",
    "tags": "[\"科学\",\"计算\",\"研究\"]",
    "config": "{\"precision\":\"high\",\"dataFormat\":\"scientific\"}",
    "doc_path": "docs/skills/scientific-computing.md",
    "tools": [
      "ligo_data_analyzer",
      "waveform_matcher",
      "particle_simulator",
      "event_generator",
      "wimp_detector",
      "axion_searcher",
      "topological_state_calculator",
      "majorana_detector",
      "ice_core_analyzer",
      "climate_reconstructor",
      "magma_simulator",
      "volcanic_monitor",
      "radiocarbon_dater",
      "artifact_reconstructor",
      "biochip_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_security_encryption",
    "name": "安全与加密",
    "display_name": "Security & Encryption",
    "description": "提供加密解密、数字签名、密钥管理、安全审计等安全工具",
    "category": "security",
    "icon": "lock",
    "tags": "[\"安全\",\"加密\",\"审计\"]",
    "config": "{\"algorithm\":\"AES-256\",\"keySize\":256}",
    "doc_path": "docs/skills/security-encryption.md",
    "tools": [
      "crypto_handler",
      "hash_verifier",
      "jwt_parser",
      "encrypt_decrypt",
      "digital_signer",
      "key_generator",
      "vulnerability_scanner",
      "security_auditor",
      "quantum_key_distributor",
      "password_generator_advanced",
      "password_vault"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_devops_monitoring",
    "name": "DevOps与监控",
    "display_name": "DevOps & Monitoring",
    "description": "提供日志分析、性能监控、内存管理、容器管理等DevOps工具",
    "category": "devops",
    "icon": "monitor",
    "tags": "[\"DevOps\",\"监控\",\"运维\"]",
    "config": "{\"logLevel\":\"info\",\"refreshInterval\":5000}",
    "doc_path": "docs/skills/devops-monitoring.md",
    "tools": [
      "log_parser",
      "performance_profiler",
      "memory_monitor",
      "docker_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_blockchain_crypto",
    "name": "区块链与加密货币",
    "display_name": "Blockchain & Cryptocurrency",
    "description": "提供区块链交互、智能合约调用、钱包管理、代币经济分析等工具",
    "category": "blockchain",
    "icon": "link",
    "tags": "[\"区块链\",\"加密货币\",\"DeFi\"]",
    "config": "{\"network\":\"mainnet\",\"gasLimit\":\"auto\"}",
    "doc_path": "docs/skills/blockchain-crypto.md",
    "tools": [
      "blockchain_client",
      "smart_contract_caller",
      "wallet_manager",
      "tokenomics_simulator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_config_management",
    "name": "配置文件管理",
    "display_name": "Configuration Management",
    "description": "提供环境变量、TOML、INI等各类配置文件的解析和管理工具",
    "category": "config",
    "icon": "setting",
    "tags": "[\"配置\",\"环境变量\",\"解析\"]",
    "config": "{\"autoLoad\":true,\"validateOnSave\":true}",
    "doc_path": "docs/skills/config-management.md",
    "tools": [
      "env_manager",
      "toml_parser",
      "ini_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_cloud_storage",
    "name": "云存储服务",
    "display_name": "Cloud Storage Services",
    "description": "提供AWS S3、阿里云OSS等云存储服务的访问和缓存管理工具",
    "category": "storage",
    "icon": "cloud-upload",
    "tags": "[\"云存储\",\"S3\",\"OSS\"]",
    "config": "{\"defaultRegion\":\"us-east-1\",\"cacheEnabled\":true}",
    "doc_path": "docs/skills/cloud-storage.md",
    "tools": [
      "s3_client",
      "oss_client",
      "cache_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_email_communication",
    "name": "邮件通讯",
    "display_name": "Email Communication",
    "description": "提供邮件发送、接收、解析、附件处理等完整的邮件通讯工具",
    "category": "communication",
    "icon": "mail",
    "tags": "[\"邮件\",\"通讯\",\"自动化\"]",
    "config": "{\"protocol\":\"IMAP\",\"encryption\":\"TLS\"}",
    "doc_path": "docs/skills/email-communication.md",
    "tools": [
      "email_sender",
      "email_reader",
      "email_attachment_handler",
      "email_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_geolocation",
    "name": "地理位置服务",
    "display_name": "Geolocation Services",
    "description": "提供地理编码、距离计算、坐标转换等地理位置相关工具",
    "category": "location",
    "icon": "environment",
    "tags": "[\"地理\",\"位置\",\"地图\"]",
    "config": "{\"defaultCoordSystem\":\"WGS84\",\"precision\":6}",
    "doc_path": "docs/skills/geolocation.md",
    "tools": [
      "geocoder",
      "distance_calculator",
      "coordinate_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_fusion_energy",
    "name": "核聚变能源",
    "display_name": "Fusion Energy",
    "description": "提供托卡马克模拟、等离子体控制等核聚变研究工具",
    "category": "energy",
    "icon": "thunderbolt",
    "tags": "[\"核聚变\",\"能源\",\"物理\"]",
    "config": "{\"plasmaTemperature\":\"auto\",\"magneticField\":\"high\"}",
    "doc_path": "docs/skills/fusion-energy.md",
    "tools": [
      "tokamak_simulator",
      "plasma_controller"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_personal_productivity",
    "name": "个人生产力",
    "display_name": "Personal Productivity",
    "description": "提供日历管理、提醒调度等个人效率提升工具",
    "category": "productivity",
    "icon": "schedule",
    "tags": "[\"效率\",\"日历\",\"提醒\"]",
    "config": "{\"defaultView\":\"week\",\"reminderOffset\":15}",
    "doc_path": "docs/skills/personal-productivity.md",
    "tools": [
      "calendar_manager",
      "reminder_scheduler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_specialized_utilities",
    "name": "专业工具集",
    "display_name": "Specialized Utilities",
    "description": "提供Base64编码、消息队列、图表渲染、传感器设计、房地产计算等专业工具",
    "category": "utility",
    "icon": "tool",
    "tags": "[\"工具\",\"实用\",\"专业\"]",
    "config": "{\"defaultEncoding\":\"UTF-8\",\"precision\":\"high\"}",
    "doc_path": "docs/skills/specialized-utilities.md",
    "tools": [
      "base64_handler",
      "message_queue_client",
      "chart_renderer",
      "flexible_sensor_designer",
      "real_estate_calculator"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];

module.exports = additionalSkillsV4;

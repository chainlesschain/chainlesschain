pluginManagement {
    repositories {
        // 官方仓库（优先，确保插件完整性）
        google()
        mavenCentral()
        gradlePluginPortal()

        // 阿里云镜像（备用，加速国内下载）
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // 官方仓库（优先，CI 可靠）
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }

        // 阿里云镜像（备用，国内开发者可受益于缓存）
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        // SQLCipher现在在Maven Central可用,不再需要CommonsWare仓库
    }
}

rootProject.name = "ChainlessChain Android"

// 主应用模块
include(":app")

// 核心模块
include(":core-common")
include(":core-database")
include(":core-network")
include(":core-security")
include(":core-p2p")
include(":core-did")
include(":core-e2ee")
include(":core-ui")
include(":core-blockchain")

// 测试基础设施（共享 Compose UI test 扩展 + Hilt test fixtures）
// 仅供 androidTestImplementation 消费；main source set 放共享代码，让模块可作普通
// android-library 被引用。详见 core-test-helpers/build.gradle.kts 的 KDoc。
include(":core-test-helpers")

// 功能模块
include(":feature-auth")
include(":feature-knowledge")
include(":feature-ai")
include(":feature-p2p")
include(":feature-project")
include(":feature-file-browser")
include(":feature-blockchain")
include(":feature-enterprise")
include(":feature-knowledge-graph")
include(":feature-mcp")
include(":feature-hooks")
include(":feature-collaboration")
include(":feature-performance")
include(":feature-local-terminal")
// AI 陪学 (FAMILY-01..67) — 见 docs/design/AI陪学_主文档.md + AI陪学_v0.1_ticket_tree.md
include(":feature-family-guard")

// 数据模块
include(":data-knowledge")
include(":data-ai")

// v1.2 #20 P0.2 — Wear OS 独立 APK（applicationId 与 :app 同；
// 不依赖 :app 的 feature/core libs，保持 wear bundle 小）
include(":wear-app")

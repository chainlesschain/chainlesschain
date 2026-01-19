pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
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

// 功能模块
include(":feature-auth")
include(":feature-knowledge")
include(":feature-ai")
include(":feature-p2p")

// 数据模块
include(":data-knowledge")
include(":data-ai")

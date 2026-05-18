plugins {
    `kotlin-dsl`
}

repositories {
    // 官方仓库（优先，CI 可靠 — 与 buildSrc/settings.gradle.kts + 根 settings.gradle.kts 保持一致顺序）
    google()
    mavenCentral()
    gradlePluginPortal()

    // 阿里云镜像（备用，国内本地开发缓存加速）
    maven { url = uri("https://maven.aliyun.com/repository/google") }
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
}

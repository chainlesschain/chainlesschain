plugins {
    `kotlin-dsl`
}

repositories {
    // 阿里云镜像（优先，解决网络问题）
    maven { url = uri("https://maven.aliyun.com/repository/google") }
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }

    // 官方仓库（备用）
    google()
    mavenCentral()
    gradlePluginPortal()
}

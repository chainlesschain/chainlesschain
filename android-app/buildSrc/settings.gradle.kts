pluginManagement {
    repositories {
        // 官方仓库（优先）
        google()
        mavenCentral()
        gradlePluginPortal()

        // 阿里云镜像（备用）
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://maven.aliyun.com/repository/public") }
        maven { url = uri("https://maven.aliyun.com/repository/gradle-plugin") }
    }
}

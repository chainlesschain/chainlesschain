plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.chainlesschain.android.core.agentprotocol"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    sourceSets.getByName("main").java.srcDir(
        "../../packages/agent-protocol/generated/kotlin",
    )
    sourceSets.getByName("test").resources.srcDir(
        "../../packages/agent-protocol/test/fixtures",
    )

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    api("org.jetbrains.kotlin:kotlin-stdlib:1.9.22")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
}

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "com.chainlesschain.android.core.database"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Room schema配置
        ksp {
            arg("room.schemaLocation", "$projectDir/schemas")
            arg("room.incremental", "true")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(project(":core-common"))
    implementation(project(":core-security"))

    // Room
    val roomVersion = "2.6.1"
    api("androidx.room:room-runtime:$roomVersion")
    api("androidx.room:room-ktx:$roomVersion")
    ksp("androidx.room:room-compiler:$roomVersion")

    // SQLCipher (使用新的artifact ID和最新版本)
    api("net.zetetic:sqlcipher-android:4.12.0")
    api("androidx.sqlite:sqlite-ktx:2.4.0")

    // Kotlin Serialization (for Converters)
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // Paging (for PagingSource in DAO)
    api("androidx.paging:paging-runtime:3.2.1")
    api("androidx.paging:paging-common:3.2.1")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.50")
    ksp("com.google.dagger:hilt-compiler:2.50")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    testImplementation("androidx.room:room-testing:$roomVersion")
    testImplementation("org.jetbrains.kotlin:kotlin-test:1.9.22")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.room:room-testing:$roomVersion")
}

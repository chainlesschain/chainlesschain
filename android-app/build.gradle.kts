// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("com.android.library") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.22" apply false
    id("com.google.dagger.hilt.android") version "2.50" apply false
    id("com.google.devtools.ksp") version "1.9.22-1.0.17" apply false
    id("com.google.gms.google-services") version "4.4.0" apply false
    id("com.google.firebase.crashlytics") version "2.9.9" apply false
}

buildscript {
    dependencies {
        classpath("com.google.dagger:hilt-android-gradle-plugin:2.50")
        classpath("com.google.gms:google-services:4.4.0")
        classpath("com.google.firebase:firebase-crashlytics-gradle:2.9.9")
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

// Apply the same dep-conflict exclusions to every subproject. Previously these
// lived only in :app, which left :core-ui (and any other library module's
// androidTest configurations) hitting `Duplicate class org.intellij.lang.
// annotations.*` from `annotations:23.0.0` + `annotations-java5:17.0.0`
// being pulled in transitively.
subprojects {
    configurations.all {
        exclude(group = "org.jetbrains", module = "annotations-java5")
        exclude(group = "org.webrtc", module = "google-webrtc")
        exclude(group = "org.bouncycastle", module = "bcprov-jdk15on")
    }
}

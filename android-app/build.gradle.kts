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
        // Huawei AGConnect gradle plugin — added ONLY when app/agconnect-services
        // .json is present, so the Huawei Maven repo (added under the same gate in
        // settings.gradle.kts) is never required for default / CI builds. app/
        // build.gradle.kts applies it under the same condition. See
        // docs/guides/Vendor_Push_Setup.md §3.2.
        if (file("app/agconnect-services.json").exists()) {
            classpath("com.huawei.agconnect:agcp:1.9.1.301")
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

// Phase 2.5 internal binaries (Termux Node + cc-cli + frida-inject):
// fetched from GitHub Release `internal-binaries-android-v<binariesVersion>`
// instead of being committed to git. binariesVersion lives in gradle.properties.
// Replaces the prior node-runtime-bundle.yml `git add + commit + push` pattern
// that bloated .git history with ~1.2 GB of cc-cli.tgz / libnode.so / etc
// historical versions. See docs/internal/android-binary-distribution.md.
val binariesManifest = rootProject.file("binaries-manifest.txt")
val binariesVersion: String = (project.findProperty("binariesVersion") as? String)
    ?: error("binariesVersion missing from gradle.properties — required for internal binary fetch")
val releaseBaseUrl =
    "https://github.com/chainlesschain/chainlesschain/releases/download/internal-binaries-android-v$binariesVersion"

fun sha256(file: java.io.File): String {
    val md = java.security.MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buf = ByteArray(8 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            md.update(buf, 0, n)
        }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
}

tasks.register("downloadInternalBinaries") {
    group = "build"
    description =
        "Verify (and if missing, download) Android internal binaries pinned by binaries-manifest.txt."
    inputs.file(binariesManifest)
    doLast {
        check(binariesManifest.exists()) {
            "binaries-manifest.txt missing at ${binariesManifest.absolutePath}"
        }
        val repoRoot = rootProject.rootDir.parentFile
            ?: error("rootProject.rootDir has no parent — cannot resolve repo root")
        var verified = 0
        var downloaded = 0
        binariesManifest.readLines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .forEach { line ->
                val parts = line.split(Regex("\\s+"), limit = 3)
                check(parts.size == 3) {
                    "Malformed manifest line: $line"
                }
                val (expectedSha, assetName, relPath) = parts
                val target = java.io.File(repoRoot, relPath)
                if (target.exists() && sha256(target) == expectedSha) {
                    verified++
                    return@forEach
                }
                target.parentFile.mkdirs()
                val url = "$releaseBaseUrl/$assetName"
                logger.lifecycle("Downloading $assetName -> $relPath")
                val conn = java.net.URI(url).toURL().openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 30_000
                conn.readTimeout = 600_000
                conn.instanceFollowRedirects = true
                conn.inputStream.use { input -> target.outputStream().use { out -> input.copyTo(out) } }
                val actualSha = sha256(target)
                check(actualSha == expectedSha) {
                    "sha256 mismatch for $assetName: expected $expectedSha got $actualSha"
                }
                downloaded++
            }
        logger.lifecycle(
            "downloadInternalBinaries: $verified verified locally, $downloaded fetched from internal-binaries-android-v$binariesVersion",
        )
    }
}

// Wire :app and :feature-local-terminal preBuild to depend on this task.
// Done lazily so the dependency configuration runs after both submodules
// have applied the android plugin (which registers `preBuild`).
gradle.projectsEvaluated {
    listOf(":app", ":feature-local-terminal").forEach { path ->
        val sub = findProject(path) ?: return@forEach
        sub.tasks.matching { it.name == "preBuild" }.configureEach {
            dependsOn(tasks.named("downloadInternalBinaries"))
        }
    }
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

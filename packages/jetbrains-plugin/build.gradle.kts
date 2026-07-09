// ChainlessChain IDE Bridge — JetBrains plugin.
//
// Build requires the IntelliJ Platform SDK (downloaded by the Gradle plugin at
// build time). The protocol/server/lockfile/tools core under
// com.chainlesschain.ide is pure JDK and is also compiled + interop-tested
// independently (see README "Verification").
import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("java")
    // Kotlin is needed ONLY for the inline-completion (ghost-text) provider: the
    // platform's InlineCompletionProvider is a Kotlin suspend/Flow API that can't
    // be implemented from Java. 1.9.24 matches the Kotlin the 2024.2 platform is
    // built with; kotlin.stdlib.default.dependency=false (gradle.properties) keeps
    // the stdlib out of the plugin zip (the IDE provides it).
    id("org.jetbrains.kotlin.jvm") version "1.9.24"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.chainlesschain"
version = "0.4.52"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.2")
        // Java PSI (PsiShortNamesCache etc.) for @-mention class/method symbols.
        // Compile-time only: plugin.xml does NOT depend on com.intellij.java, so the
        // plugin still loads on non-Java IDEs — the symbol lookup is try/catch-guarded
        // and simply yields no symbols when the Java PSI classes are absent.
        // (The terminal customizer was dropped in 0.4.7 — deprecated API; the
        // discovery lockfile covers the "cc in a terminal auto-connects" case.)
        bundledPlugin("com.intellij.java")
        pluginVerifier() // for ./gradlew verifyPlugin
    }

    // Real JUnit 5 for the pure com.chainlesschain.ide.* layer (SDK-free plain
    // Java) — no IntelliJ platform test framework needed, so `./gradlew test`
    // runs fast and headless. The *SmokeMain harnesses stay as the aggregate
    // gate (smokeTest task); these give per-test isolation + JUnit XML reports.
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    jvmToolchain(17)
}

// Windows javac defaults to the platform codepage (GBK) — non-ASCII UI
// strings (✓ ⚠ ℹ …) would be miscompiled into mojibake without this.
tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

/**
 * Render the top version sections of CHANGELOG.md to HTML for the Marketplace
 * "What's New", so <change-notes> AUTO-SYNCS from the changelog and can never
 * drift again (it lagged at 0.4.19→0.4.28, then again at 0.4.29 because the
 * notes were hand-maintained in plugin.xml). Fail-safe: any read/parse error
 * falls back to a generic pointer rather than breaking the build.
 */
fun renderChangeNotes(changelog: java.io.File, maxSections: Int): String {
    val fallback = "See the CHANGELOG on GitHub: " +
        "https://github.com/chainlesschain/chainlesschain"
    return try {
        if (!changelog.exists()) return fallback
        fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        fun inline(s: String) = esc(s)
            .replace(Regex("\\*\\*([^*]+)\\*\\*"), "<b>$1</b>")
            .replace(Regex("`([^`]+)`"), "<code>$1</code>")
        val out = StringBuilder()
        var sections = 0
        var inList = false
        var bullet = StringBuilder()
        fun flushBullet() {
            if (bullet.isNotEmpty()) {
                if (!inList) { out.append("<ul>"); inList = true }
                out.append("<li>").append(inline(bullet.toString().trim())).append("</li>")
                bullet = StringBuilder()
            }
        }
        fun closeList() {
            flushBullet()
            if (inList) { out.append("</ul>"); inList = false }
        }
        for (raw in changelog.readLines()) {
            val t = raw.trim()
            if (t.startsWith("## ")) {
                if (sections >= maxSections) break
                closeList()
                if (sections > 0) out.append("<br/>")
                out.append("<b>").append(inline(t.removePrefix("## "))).append("</b><br/>")
                sections++
            } else if (sections in 1..maxSections) {
                when {
                    t.startsWith("- ") -> { flushBullet(); bullet.append(t.removePrefix("- ")) }
                    t.isEmpty() -> flushBullet()
                    t.startsWith("#") -> {}
                    else -> if (bullet.isNotEmpty()) bullet.append(" ").append(t)
                }
            }
        }
        closeList()
        if (out.isBlank()) fallback else out.toString()
    } catch (e: Exception) {
        fallback
    }
}

intellijPlatform {
    // Plain-Java plugin: no UI forms / no @NotNull bytecode instrumentation, so
    // skip code instrumentation (avoids the InstrumentIdeaExtensions ant-task
    // dependency the 2.x plugin otherwise needs).
    instrumentCode = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null } // no hard upper bound
        }
        // Auto-sync the Marketplace "What's New" from CHANGELOG.md — patchPluginXml
        // overrides plugin.xml's <change-notes> with this, so the two can never
        // drift again. Edit CHANGELOG.md, not plugin.xml.
        changeNotes = provider { renderChangeNotes(file("CHANGELOG.md"), 5) }
    }

    // `./gradlew verifyPlugin` runs the JetBrains Plugin Verifier against newer
    // IDE builds to catch internal / scheduled-for-removal / deprecated API usage
    // before they break on those versions.
    pluginVerification {
        ides {
            // 2025.2 is the newest build resolvable via the Gradle repos here;
            // 2026.x artifacts aren't published to the dependency repo yet, so they
            // can only be checked by the Marketplace verifier post-publish.
            ide(IntelliJPlatformType.IntellijIdeaCommunity, "2025.2")
        }
    }

    // `./gradlew publishPlugin` uploads to the JetBrains Marketplace. The token
    // comes from the CI secret JETBRAINS_PUBLISH_TOKEN (never commit it).
    publishing {
        token = providers.environmentVariable("JETBRAINS_PUBLISH_TOKEN")
    }

    // Marketplace requires signed plugins; supply the cert chain + key via env
    // when releasing (CERTIFICATE_CHAIN / PRIVATE_KEY / PRIVATE_KEY_PASSWORD).
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }
}

tasks {
    // Real JUnit 5 over the pure layer. The *SmokeMain harnesses (plain main(),
    // no @Test) are simply ignored by the JUnit runner; the smokeTest task below
    // still runs them as the aggregate gate. Pure classes never touch the SDK, so
    // this needs no platform test framework and runs headless in seconds.
    test {
        useJUnitPlatform()
        systemProperty("file.encoding", "UTF-8")
        testLogging { events("failed") }
    }
}

// The pure-core regression gate: run the src/test PureLogicSmokeMain harness
// (300+ assertions over the vscode-parity pure layers; exits 1 on any failure)
// without the JUnit/testFramework machinery the disabled `test` task would
// drag in. CI runs this on every push touching the plugin; locally:
//   ./gradlew smokeTest
tasks.register<JavaExec>("smokeTest") {
    group = "verification"
    description = "Run the pure-logic smoke harness (PureLogicSmokeMain)"
    dependsOn(tasks.named("compileTestJava"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.chainlesschain.ide.PureLogicSmokeMain")
    // Non-ASCII assertions (✓ ⚠ 行 …) — keep the JVM off the GBK codepage.
    jvmArgs("-Dfile.encoding=UTF-8")
}

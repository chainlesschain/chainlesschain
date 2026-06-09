// ChainlessChain IDE Bridge — JetBrains plugin.
//
// Build requires the IntelliJ Platform SDK (downloaded by the Gradle plugin at
// build time). The protocol/server/lockfile/tools core under
// com.chainlesschain.ide is pure JDK and is also compiled + interop-tested
// independently (see README "Verification").
plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.chainlesschain"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Community is enough — the bridge uses only platform + terminal APIs.
        intellijIdeaCommunity("2024.2")
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null } // no hard upper bound
        }
    }
}

tasks {
    // The interop probe main lives under src/test and is not shipped.
    test {
        enabled = false
    }
}

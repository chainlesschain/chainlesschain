package com.chainlesschain.android.feature.ai.cowork.skills.loader

import android.content.Context
import com.chainlesschain.android.feature.ai.cowork.skills.model.Skill
import com.chainlesschain.android.feature.ai.cowork.skills.model.SkillSource
import com.chainlesschain.android.feature.ai.cowork.skills.registry.SkillRegistry
import timber.log.Timber
import java.io.File

/**
 * 3-layer skill loader matching the desktop architecture:
 *
 * 1. **Bundled**: `assets/skills/` — shipped with APK (lowest priority)
 * 2. **Managed**: `{filesDir}/skills/managed/` — downloaded from marketplace
 * 3. **Workspace**: User-specified directory (highest priority, overrides all)
 *
 * Later layers override earlier ones by skill name.
 */
class SkillLoader(
    private val context: Context,
    private val parser: SkillMdParser,
    private val registry: SkillRegistry
) {

    companion object {
        private const val TAG = "SkillLoader"
        private const val BUNDLED_SKILLS_DIR = "skills"
        private const val MANAGED_SKILLS_DIR = "skills/managed"
    }

    private var workspacePath: String? = null

    /**
     * Set the workspace skills directory (highest priority layer).
     */
    fun setWorkspacePath(path: String?) {
        workspacePath = path
    }

    /**
     * Load all skills from all 3 layers into the registry.
     * Order: bundled → managed → workspace (later overrides earlier).
     *
     * @return total number of skills loaded
     */
    fun loadAll(): Int {
        registry.clear()

        val bundledCount = loadBundled()
        val managedCount = loadManaged()
        val workspaceCount = loadWorkspace()

        val total = registry.size
        Timber.i("$TAG: Loaded $total skills (bundled=$bundledCount, managed=$managedCount, workspace=$workspaceCount)")
        return total
    }

    /**
     * Layer 1: Load bundled skills from assets/skills/.
     */
    fun loadBundled(): Int {
        var count = 0
        try {
            val assetManager = context.assets
            val files = assetManager.list(BUNDLED_SKILLS_DIR) ?: emptyArray()

            for (filename in files) {
                if (!filename.endsWith(".md")) continue

                try {
                    val content = assetManager.open("$BUNDLED_SKILLS_DIR/$filename")
                        .bufferedReader()
                        .use { it.readText() }

                    val skill = parser.parse(
                        content = content,
                        source = SkillSource.BUNDLED,
                        sourcePath = "assets/$BUNDLED_SKILLS_DIR/$filename"
                    )

                    if (skill != null) {
                        registry.register(skill)
                        count++
                    }
                } catch (e: Exception) {
                    Timber.w(e, "$TAG: Failed to load bundled skill: $filename")
                }
            }
        } catch (e: Exception) {
            Timber.w(e, "$TAG: Failed to list bundled skills")
        }

        Timber.d("$TAG: Loaded $count bundled skills")
        return count
    }

    /**
     * Layer 2: Load managed skills from internal storage (marketplace downloads).
     */
    fun loadManaged(): Int {
        val dir = File(context.filesDir, MANAGED_SKILLS_DIR)
        if (!dir.exists()) {
            dir.mkdirs()
            return 0
        }
        return loadFromDirectory(dir, SkillSource.MANAGED)
    }

    /**
     * Layer 3: Load workspace skills from user-specified directory.
     */
    fun loadWorkspace(): Int {
        val path = workspacePath ?: return 0
        val dir = File(path)
        if (!dir.exists() || !dir.isDirectory) {
            Timber.w("$TAG: Workspace path does not exist: $path")
            return 0
        }
        return loadFromDirectory(dir, SkillSource.WORKSPACE)
    }

    /**
     * Load all SKILL.md files from a filesystem directory.
     */
    private fun loadFromDirectory(dir: File, source: SkillSource): Int {
        var count = 0

        val files = dir.listFiles { file ->
            file.isFile && file.name.endsWith(".md")
        } ?: emptyArray()

        for (file in files) {
            try {
                val content = file.readText(Charsets.UTF_8)
                val skill = parser.parse(
                    content = content,
                    source = source,
                    sourcePath = file.absolutePath
                )
                if (skill != null) {
                    registry.register(skill)
                    count++
                }
            } catch (e: Exception) {
                Timber.w(e, "$TAG: Failed to load skill from ${file.name}")
            }
        }

        Timber.d("$TAG: Loaded $count skills from ${dir.absolutePath} (source=$source)")
        return count
    }

    /**
     * Reload all skills (useful after marketplace install or workspace change).
     */
    fun reload(): Int = loadAll()

    /**
     * Install a skill file to the managed directory.
     *
     * @param filename Skill filename (e.g. "my-skill.md")
     * @param content  SKILL.md content
     * @return true if installed successfully
     */
    fun installManaged(filename: String, content: String): Boolean {
        return try {
            val dir = File(context.filesDir, MANAGED_SKILLS_DIR)
            dir.mkdirs()

            val file = File(dir, filename)
            file.writeText(content, Charsets.UTF_8)

            // Parse and register immediately
            val skill = parser.parse(content, SkillSource.MANAGED, file.absolutePath)
            if (skill != null) {
                registry.register(skill)
                Timber.i("$TAG: Installed managed skill: ${skill.name}")
                true
            } else {
                file.delete()
                false
            }
        } catch (e: Exception) {
            Timber.e(e, "$TAG: Failed to install managed skill: $filename")
            false
        }
    }

    /**
     * Uninstall a managed skill.
     */
    fun uninstallManaged(skillName: String): Boolean {
        val dir = File(context.filesDir, MANAGED_SKILLS_DIR)
        val files = dir.listFiles { f -> f.name.endsWith(".md") } ?: return false

        for (file in files) {
            try {
                val content = file.readText()
                val skill = parser.parse(content, SkillSource.MANAGED, file.absolutePath)
                if (skill?.name == skillName) {
                    file.delete()
                    registry.unregister(skillName)
                    Timber.i("$TAG: Uninstalled managed skill: $skillName")
                    return true
                }
            } catch (_: Exception) { }
        }
        return false
    }
}

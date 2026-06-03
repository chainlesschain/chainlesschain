package com.chainlesschain.android.feature.ai.tools

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CcAllowlistTest {

    // ---------- happy path ----------

    @Test fun `note list with limit allowed`() {
        val r = CcAllowlist.check("note", listOf("list", "--limit", "10"))
        assertTrue(r is GateResult.Allow)
    }

    @Test fun `search with no subcommand allowed (allowedSubcommands=null)`() {
        val r = CcAllowlist.check("search", listOf("RAG", "--limit", "20"))
        assertTrue(r is GateResult.Allow)
    }

    @Test fun `status with no args allowed`() {
        assertTrue(CcAllowlist.check("status", emptyList()) is GateResult.Allow)
    }

    @Test fun `skill list allowed`() {
        assertTrue(CcAllowlist.check("skill", listOf("list")) is GateResult.Allow)
    }

    // ---------- E5 — write/delete denied ----------

    @Test fun `note delete denied — write op not in allowlist`() {
        val r = CcAllowlist.check("note", listOf("delete", "--id", "abc"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("'delete'"))
    }

    @Test fun `memory clear denied`() {
        val r = CcAllowlist.check("memory", listOf("clear"))
        assertTrue(r is GateResult.Deny)
    }

    @Test fun `unknown top-level command denied`() {
        assertTrue(CcAllowlist.check("rm", listOf("-rf", "/")) is GateResult.Deny)
    }

    // ---------- B17 fix — allowedSubcommands missing rejected ----------

    @Test fun `note without subcommand denied (B17 fix) — all-flag args`() {
        // B17 fix catches the "all-flag" case (firstOrNull { !it.startsWith("--") } == null).
        // Previously silently passed → cc CLI printed usage error.
        val r = CcAllowlist.check("note", listOf("--json"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("requires a subcommand"))
        assertTrue(r.reason.contains("list"))
    }

    @Test fun `note with no subargs at all denied (B17 fix) — empty list`() {
        val r = CcAllowlist.check("note", emptyList())
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("requires a subcommand"))
    }

    @Test fun `note flag-value-mistaken-as-positional denied with subcommand-not-in-allowlist`() {
        // Pre-existing limitation (not B17 specifically): `--limit 10` puts "10"
        // in subargs, which is then mistaken for a positional. Gate still denies,
        // just via the "not in allowlist" branch instead of "requires subcommand".
        // Acceptable v1 behavior — user-visible result is "denied".
        val r = CcAllowlist.check("note", listOf("--limit", "10"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("'10'"))
    }

    @Test fun `memory without subcommand denied`() {
        val r = CcAllowlist.check("memory", listOf("--json"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("requires a subcommand"))
    }

    // ---------- shell-meta rejection ----------

    @Test fun `semicolon in arg denied`() {
        val r = CcAllowlist.check("search", listOf("foo; rm -rf /"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("forbidden char"))
    }

    @Test fun `pipe in arg denied`() {
        assertTrue(CcAllowlist.check("search", listOf("foo|bar")) is GateResult.Deny)
    }

    @Test fun `backtick in arg denied`() {
        assertTrue(CcAllowlist.check("search", listOf("foo`whoami`")) is GateResult.Deny)
    }

    @Test fun `dollar sign in arg denied`() {
        assertTrue(CcAllowlist.check("search", listOf("foo\$bar")) is GateResult.Deny)
    }

    @Test fun `newline in arg denied`() {
        assertTrue(CcAllowlist.check("search", listOf("foo\nbar")) is GateResult.Deny)
    }

    @Test fun `space in arg denied (no shell split tricks)`() {
        assertTrue(CcAllowlist.check("search", listOf("foo bar")) is GateResult.Deny)
    }

    // ---------- arg validation ----------

    @Test fun `empty arg denied`() {
        assertTrue(CcAllowlist.check("search", listOf("")) is GateResult.Deny)
    }

    @Test fun `over-long arg denied`() {
        val long = "a".repeat(300)
        assertTrue(CcAllowlist.check("search", listOf(long)) is GateResult.Deny)
    }

    @Test fun `too many args denied`() {
        val many = List(20) { "a" }
        assertTrue(CcAllowlist.check("search", many) is GateResult.Deny)
    }

    // ---------- flag validation ----------

    @Test fun `unknown flag denied`() {
        val r = CcAllowlist.check("note", listOf("list", "--evil", "x"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("--evil"))
    }

    @Test fun `int flag out of range denied`() {
        val r = CcAllowlist.check("note", listOf("list", "--limit", "500"))
        assertTrue(r is GateResult.Deny)
        assertTrue((r as GateResult.Deny).reason.contains("range"))
    }

    @Test fun `int flag non-int denied`() {
        val r = CcAllowlist.check("note", listOf("list", "--limit", "abc"))
        assertTrue(r is GateResult.Deny)
    }

    @Test fun `int flag missing value denied`() {
        assertTrue(CcAllowlist.check("note", listOf("list", "--limit")) is GateResult.Deny)
    }

    @Test fun `flag value as next flag denied`() {
        // --limit followed by --json should NOT consume --json as the value
        assertTrue(CcAllowlist.check("note", listOf("list", "--limit", "--json")) is GateResult.Deny)
    }

    @Test fun `equals form for int flag`() {
        assertTrue(CcAllowlist.check("note", listOf("list", "--limit=10")) is GateResult.Allow)
    }

    @Test fun `string-limited too long denied`() {
        val r = CcAllowlist.check("note", listOf("show", "--id", "x".repeat(200)))
        assertTrue(r is GateResult.Deny)
    }

    @Test fun `bool flag toggle (no value)`() {
        assertTrue(CcAllowlist.check("note", listOf("list", "--json")) is GateResult.Allow)
    }

    @Test fun `bool flag with equals true`() {
        assertTrue(CcAllowlist.check("note", listOf("list", "--json=true")) is GateResult.Allow)
    }

    @Test fun `bool flag with equals non-bool denied`() {
        assertTrue(CcAllowlist.check("note", listOf("list", "--json=lol")) is GateResult.Deny)
    }

    // ---------- applyDefaults ----------

    @Test fun `applyDefaults injects --limit when missing`() {
        val out = CcAllowlist.applyDefaults("note", listOf("list"))
        assertEquals(listOf("list", "--limit", "20"), out)
    }

    @Test fun `applyDefaults preserves existing --limit`() {
        val out = CcAllowlist.applyDefaults("note", listOf("list", "--limit", "5"))
        assertEquals(listOf("list", "--limit", "5"), out)
    }

    @Test fun `applyDefaults preserves --limit=5 form`() {
        val out = CcAllowlist.applyDefaults("note", listOf("list", "--limit=5"))
        assertEquals(listOf("list", "--limit=5"), out)
    }

    @Test fun `applyDefaults no-op when spec has no defaultLimit`() {
        val out = CcAllowlist.applyDefaults("status", emptyList())
        assertEquals(emptyList(), out)
    }

    @Test fun `applyDefaults no-op for unknown command`() {
        val out = CcAllowlist.applyDefaults("nonexistent", listOf("foo"))
        assertEquals(listOf("foo"), out)
    }

    // ---------- version comparison ----------

    @Test fun `version exactly matching minimum is OK`() {
        assertTrue(CcAllowlist.versionAtLeast("0.162.0"))
    }

    @Test fun `version higher than minimum is OK`() {
        assertTrue(CcAllowlist.versionAtLeast("0.162.2"))
        assertTrue(CcAllowlist.versionAtLeast("0.163.0"))
        assertTrue(CcAllowlist.versionAtLeast("1.0.0"))
    }

    @Test fun `version below minimum rejected`() {
        assertFalse(CcAllowlist.versionAtLeast("0.161.99"))
        assertFalse(CcAllowlist.versionAtLeast("0.100.0"))
    }

    @Test fun `version with v prefix accepted`() {
        assertTrue(CcAllowlist.versionAtLeast("v0.162.0"))
    }

    @Test fun `version with prerelease suffix treated as base`() {
        // "0.162.0-alpha.5" → strips prerelease → 0.162.0 → equals min
        assertTrue(CcAllowlist.versionAtLeast("0.162.0-alpha.5"))
    }

    @Test fun `version with build metadata`() {
        assertTrue(CcAllowlist.versionAtLeast("0.162.1+build.42"))
    }

    @Test fun `garbage version rejected`() {
        assertFalse(CcAllowlist.versionAtLeast("not.a.version"))
        assertFalse(CcAllowlist.versionAtLeast(""))
    }

    // ---------- subargs that look like injection but are safe through ProcessBuilder ----------

    @Test fun `slash in path string-limited still ok`() {
        // FORBIDDEN_CHARS doesn't include /, and --id is STRING_LIMITED — paths
        // legit. ProcessBuilder bypasses shell so no risk.
        // (Note: depending on cc CLI semantics, ids are usually opaque, but
        // the gate doesn't artificially reject them.)
        val r = CcAllowlist.check("note", listOf("show", "--id", "abc/def"))
        assertTrue(r is GateResult.Allow)
    }
}

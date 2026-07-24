package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Applies and independently verifies an exact owner-only Windows DACL.
 *
 * <p>Java's {@code AclFileAttributeView} cannot control or verify the
 * SE_DACL_PROTECTED inheritance bit, so it is not sufficient for this bearer
 * token boundary. This helper uses Windows' .NET ACL APIs through the bundled
 * non-interactive PowerShell host, then reads the final descriptor back in the
 * same process. The lockfile token is never passed to the child process.
 */
final class WindowsOwnerOnlyAcl {

    private static final long TIMEOUT_SECONDS = 30;
    private static final int OUTPUT_LIMIT = 64 * 1024;

    private static final String APPLY_AND_VERIFY_SCRIPT = String.join("\n",
            "param([string]$target)",
            "$ErrorActionPreference = 'Stop'",
            "function Read-OwnerAccessAcl([string]$path) {",
            "  $sections =",
            "    [System.Security.AccessControl.AccessControlSections]::Access -bor",
            "    [System.Security.AccessControl.AccessControlSections]::Owner",
            "  if ([System.IO.Directory]::Exists($path)) {",
            "    return [System.Security.AccessControl.DirectorySecurity]::new(",
            "      $path, $sections)",
            "  }",
            "  if ([System.IO.File]::Exists($path)) {",
            "    return [System.Security.AccessControl.FileSecurity]::new(",
            "      $path, $sections)",
            "  }",
            "  throw \"ACL target does not exist: $path\"",
            "}",
            "$item = Get-Item -LiteralPath $target -Force",
            "$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()",
            "$currentSid = $identity.User",
            "$currentAcl = Read-OwnerAccessAcl $target",
            "$currentOwner = $currentAcl.GetOwner(",
            "  [System.Security.Principal.SecurityIdentifier]).Value",
            "if ($currentOwner -ne $currentSid.Value) {",
            "  throw \"ACL target is not owned by the current identity: $target\"",
            "}",
            "$rights = [System.Security.AccessControl.FileSystemRights]::FullControl",
            "$propagation = [System.Security.AccessControl.PropagationFlags]::None",
            "$allow = [System.Security.AccessControl.AccessControlType]::Allow",
            "if ($item.PSIsContainer) {",
            "  $security = [System.Security.AccessControl.DirectorySecurity]::new()",
            "  $inheritance =",
            "    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor",
            "    [System.Security.AccessControl.InheritanceFlags]::ObjectInherit",
            "  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(",
            "    $currentSid, $rights, $inheritance, $propagation, $allow)",
            "  $security.SetOwner($currentSid)",
            "  $security.SetAccessRuleProtection($true, $false)",
            "  $security.AddAccessRule($rule) | Out-Null",
            "  [System.IO.DirectoryInfo]::new($target).SetAccessControl($security)",
            "} else {",
            "  $security = [System.Security.AccessControl.FileSecurity]::new()",
            "  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(",
            "    $currentSid, $rights,",
            "    [System.Security.AccessControl.InheritanceFlags]::None,",
            "    $propagation, $allow)",
            "  $security.SetOwner($currentSid)",
            "  $security.SetAccessRuleProtection($true, $false)",
            "  $security.AddAccessRule($rule) | Out-Null",
            "  [System.IO.FileInfo]::new($target).SetAccessControl($security)",
            "}",
            "$acl = Read-OwnerAccessAcl $target",
            "$owner = $acl.GetOwner(",
            "  [System.Security.Principal.SecurityIdentifier]).Value",
            "$rules = @($acl.GetAccessRules(",
            "  $true, $true, [System.Security.Principal.SecurityIdentifier]))",
            "$ownerOnly = $acl.AreAccessRulesProtected -and",
            "  $owner -eq $currentSid.Value -and $rules.Count -eq 1",
            "if ($ownerOnly) {",
            "  foreach ($actual in $rules) {",
            "    $hasFullControl = (",
            "      $actual.FileSystemRights -band $rights",
            "    ) -eq $rights",
            "    if ($actual.IdentityReference.Value -ne $currentSid.Value -or",
            "        $actual.AccessControlType -ne $allow -or",
            "        -not $hasFullControl -or $actual.IsInherited) {",
            "      $ownerOnly = $false",
            "      break",
            "    }",
            "  }",
            "}",
            "if (-not $ownerOnly) {",
            "  throw (\"final ACL is not owner-only for $target \" +",
            "    \"(protected=$($acl.AreAccessRulesProtected), \" +",
            "    \"owner=$owner, current=$($currentSid.Value), \" +",
            "    \"aceCount=$($rules.Count))\")",
            "}");

    @FunctionalInterface
    interface Runner {
        Result run(List<String> command, long timeoutSeconds) throws IOException;
    }

    static final class Result {
        final int exitCode;
        final String output;

        Result(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output == null ? "" : output;
        }
    }

    private WindowsOwnerOnlyAcl() {}

    static void enforce(Path target) throws IOException {
        enforce(target, WindowsOwnerOnlyAcl::runProcess);
    }

    /** Test seam: executes the real command plan through an injected runner. */
    static void enforce(Path target, Runner runner) throws IOException {
        List<String> command = Arrays.asList(
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "& { " + APPLY_AND_VERIFY_SCRIPT + " }",
                target.toAbsolutePath().toString());
        Result result = runner.run(command, TIMEOUT_SECONDS);
        if (result == null || result.exitCode != 0) {
            String detail = result == null ? "no process result" : result.output.trim();
            if (detail.isEmpty()) {
                detail = "PowerShell ACL command exited with status "
                        + (result == null ? "unknown" : result.exitCode);
            }
            throw new IOException(detail);
        }
    }

    private static Result runProcess(List<String> command, long timeoutSeconds)
            throws IOException {
        Process process = new ProcessBuilder(command)
                .redirectErrorStream(true)
                .start();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        AtomicReference<IOException> readFailure = new AtomicReference<>();
        Thread reader = new Thread(() -> drainBounded(
                process.getInputStream(), output, readFailure),
                "chainlesschain-ide-acl-output");
        reader.setDaemon(true);
        reader.start();

        final boolean completed;
        try {
            completed = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new IOException("interrupted while applying Windows ACL", interrupted);
        }
        if (!completed) {
            process.destroyForcibly();
            throw new IOException(
                    "PowerShell ACL command timed out after "
                            + timeoutSeconds + " seconds");
        }
        try {
            reader.join(5_000);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted while reading Windows ACL output",
                    interrupted);
        }
        if (readFailure.get() != null) throw readFailure.get();
        return new Result(process.exitValue(),
                output.toString(StandardCharsets.UTF_8));
    }

    private static void drainBounded(InputStream input,
                                     ByteArrayOutputStream output,
                                     AtomicReference<IOException> failure) {
        try (InputStream in = input) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) >= 0) {
                int remaining = OUTPUT_LIMIT - output.size();
                if (remaining > 0) {
                    output.write(buffer, 0, Math.min(read, remaining));
                }
            }
        } catch (IOException error) {
            failure.compareAndSet(null, error);
        }
    }
}

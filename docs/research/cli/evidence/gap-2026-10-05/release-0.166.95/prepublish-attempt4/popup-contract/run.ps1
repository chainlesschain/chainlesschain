$ErrorActionPreference = 'Stop'
$contractRoot = 'C:\code\chainlesschain\.work\astra-popup-dispatch-contract-20261009'
$contractJdk = 'C:\code\chainlesschain\.work\jdk21-release-validation\jdk-21.0.12.1+1'
$rhinoJar = 'C:\code\chainlesschain\packages\jetbrains-plugin\build\idea-sandbox\zip-isolation-check\IC-2024.2\plugins_runIdeForUiTests\robot-server-plugin\lib\rhino-1.7.15.jar'
$contractClasspath = (Get-Content -Raw -LiteralPath (Join-Path $contractRoot 'runtime-classpath.txt')).Trim()
$contractClasspath = $rhinoJar + ';' + $contractClasspath
$contractClasses = Join-Path $contractRoot 'classes'
New-Item -ItemType Directory -Path $contractClasses -Force | Out-Null
Copy-Item -LiteralPath 'C:\code\chainlesschain\packages\jetbrains-plugin\src\uiTest\java\com\chainlesschain\ide\uitest\IdeUiSmokeTest.java' -Destination (Join-Path $contractRoot 'IdeUiSmokeTest.source.java')
Copy-Item -LiteralPath 'C:\code\chainlesschain\packages\jetbrains-plugin\build\classes\java\uiTest\com\chainlesschain\ide\uitest\IdeUiSmokeTest.class' -Destination (Join-Path $contractRoot 'IdeUiSmokeTest.class')
& (Join-Path $contractJdk 'bin\javac.exe') -encoding UTF-8 -cp $contractClasspath -d $contractClasses (Join-Path $contractRoot 'src\PopupDispatchContract.java') (Join-Path $contractRoot 'src\com\intellij\openapi\application\ApplicationManager.java') 1> (Join-Path $contractRoot 'compile.stdout.log') 2> (Join-Path $contractRoot 'compile.stderr.log')
if ($LASTEXITCODE -ne 0) { throw "Contract javac failed: $LASTEXITCODE" }
$launchClasspath = $contractClasses + ';' + $contractClasspath
& (Join-Path $contractJdk 'bin\java.exe') '-Djava.awt.headless=true' -cp $launchClasspath PopupDispatchContract $contractRoot 1> (Join-Path $contractRoot 'run.stdout.log') 2> (Join-Path $contractRoot 'run.stderr.log')
$contractExit = $LASTEXITCODE
@{exitCode=$contractExit; capturedAt=[DateTime]::UtcNow.ToString('o'); rhinoSha256=(Get-FileHash -LiteralPath $rhinoJar -Algorithm SHA256).Hash.ToLowerInvariant(); runtimeClasspathSha256=(Get-FileHash -LiteralPath (Join-Path $contractRoot 'runtime-classpath.txt') -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $contractRoot 'run-metadata.json')
Get-Content -LiteralPath (Join-Path $contractRoot 'run.stdout.log')
if ($contractExit -ne 0) { Get-Content -LiteralPath (Join-Path $contractRoot 'run.stderr.log'); throw "Contract Java failed: $contractExit" }

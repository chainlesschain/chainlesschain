$env:JAVA_HOME = "C:\Program Files\Zulu\zulu-17"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "JAVA_HOME set to: $env:JAVA_HOME"
Write-Host "Java version:"
& java -version

Write-Host "`nAccepting Android SDK licenses..."
Write-Output "y`ny`ny`ny`ny`ny`ny`ny`ny" | C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat --licenses

Write-Host "`nInstalling required SDK components (this may take a few minutes)..."
& C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Write-Host "`nAndroid SDK setup complete!"

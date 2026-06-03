@echo off
set JAVA_HOME=C:\Program Files\Zulu\zulu-17
set PATH=%JAVA_HOME%\bin;%PATH%

echo Accepting Android SDK licenses...
echo y | C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat --licenses

echo.
echo Installing required SDK components...
C:\Android\sdk\cmdline-tools\latest\bin\sdkmanager.bat "platform-tools" "platforms;android-35" "build-tools;35.0.0"

echo.
echo Android SDK setup complete!
echo SDK Location: C:\Android\sdk

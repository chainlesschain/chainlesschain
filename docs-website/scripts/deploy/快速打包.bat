@echo off
:: 切换到项目根目录
cd /d "%~dp0..\.."
echo 正在打包网站文件...
powershell -Command "if(Test-Path 'chainlesschain-website.zip'){Remove-Item 'chainlesschain-website.zip' -Force}; Compress-Archive -Path 'index.html','logo.png','logo.svg','robots.txt','sitemap.xml','mobile-optimize.css','css','js','images','products','technology' -DestinationPath 'chainlesschain-website.zip' -Force"

echo.
echo 打包完成！
echo 文件位置: %cd%\chainlesschain-website.zip
echo.
dir chainlesschain-website.zip
echo.
echo 请查看"docs\guides\部署说明.md"了解部署步骤
echo.
pause

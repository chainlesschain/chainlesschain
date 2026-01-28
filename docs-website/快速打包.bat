@echo off
echo 正在打包网站文件...
powershell -Command "if(Test-Path 'chainlesschain-website.zip'){Remove-Item 'chainlesschain-website.zip' -Force}; Compress-Archive -Path 'index.html','logo.png','logo.svg','robots.txt','sitemap.xml','style-enhancements.css','visual-enhancements.css','fix-center.css','loading-animation.css','loading-simple.css','css','js','images','products','technology' -DestinationPath 'chainlesschain-website.zip' -Force"

echo.
echo 打包完成！
echo 文件位置: %cd%\chainlesschain-website.zip
echo.
dir chainlesschain-website.zip
echo.
echo 请查看"部署说明.md"了解部署步骤
echo.
pause

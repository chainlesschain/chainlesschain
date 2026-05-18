; ChainlessChain Windows Installer Script
; Built with Inno Setup 6.x
; https://jrsoftware.org/isinfo.php

#define MyAppName "ChainlessChain"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ChainlessChain Team"
#define MyAppURL "https://github.com/chainlesschain/chainlesschain"
#define MyAppExeName "chainlesschain.exe"
#define MyAppId "{{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}"

[Setup]
; Basic application info
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Installation directories
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes

; Output configuration
OutputDir=out\installer
OutputBaseFilename=ChainlessChain-Setup-{#MyAppVersion}
SetupIconFile=build\icon.ico

; Compression
Compression=lzma2/max
SolidCompression=yes

; Windows version requirements
MinVersion=10.0.17763
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

; Privileges
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

; Visual appearance
WizardStyle=modern
DisableWelcomePage=no
LicenseFile=LICENSE
InfoBeforeFile=INSTALL_INFO.md

; Uninstall
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main application files - include everything from the packaged app
; Excludes test files, docs, and other unnecessary files to reduce installer size
Source: "out\ChainlessChain-win32-x64\*"; DestDir: "{app}"; \
  Excludes: "\tests,\test,*.test.js,*.test.ts,*.spec.js,*.spec.ts,\coverage,\playwright-report,*.md,README*,CHANGELOG*,LICENSE.txt,\docs,\examples,*.map,*.log,\backend-services"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; Backend Docker services
Source: "out\ChainlessChain-win32-x64\backend-services\*"; DestDir: "{app}\backend-services"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; Start scripts
Source: "out\ChainlessChain-win32-x64\start-all.bat"; DestDir: "{app}"; Flags: ignoreversion

; Docker Desktop installer script
Source: "install-docker-desktop.bat"; DestDir: "{app}"; Flags: ignoreversion

; Data directory - create empty structure
; Note: User data will be stored in %APPDATA%\chainlesschain-desktop-vue

[Icons]
; Start Menu
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\启动 ChainlessChain (含后端)"; Filename: "{app}\start-all.bat"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\管理后端服务"; Filename: "{app}\backend-services\manage-backend.bat"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

; Desktop
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{autodesktop}\启动 ChainlessChain (含后端)"; Filename: "{app}\start-all.bat"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

; Quick Launch
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: quicklaunchicon

[Registry]
; File associations (optional - for .chain files if needed)
; Root: HKCR; Subkey: ".chain"; ValueType: string; ValueName: ""; ValueData: "ChainlessChainFile"; Flags: uninsdeletevalue
; Root: HKCR; Subkey: "ChainlessChainFile"; ValueType: string; ValueName: ""; ValueData: "ChainlessChain File"; Flags: uninsdeletekey
; Root: HKCR; Subkey: "ChainlessChainFile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
; Root: HKCR; Subkey: "ChainlessChainFile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

; Add to Windows App Paths
Root: HKLM64; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{#MyAppExeName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName}"; Flags: uninsdeletekey
Root: HKLM64; Subkey: "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{#MyAppExeName}"; ValueType: string; ValueName: "Path"; ValueData: "{app}"; Flags: uninsdeletekey

[Run]
; Option to launch application after installation
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up log files and temporary data (but preserve user data)
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\temp"

[Code]
// Custom installation logic

function IsDockerInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  // Check if docker.exe exists in PATH or common installation paths
  Result := FileExists('C:\Program Files\Docker\Docker\Docker Desktop.exe') or
            FileExists('C:\Program Files\Docker\Docker\resources\bin\docker.exe') or
            (Exec('cmd.exe', '/c where docker >nul 2>&1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0));
end;

function InitializeSetup(): Boolean;
var
  Response: Integer;
begin
  Result := True;

  // Check if Docker Desktop is installed
  if not IsDockerInstalled() then
  begin
    Response := MsgBox('ChainlessChain 需要 Docker Desktop 来运行后端服务。' + #13#10#13#10 +
                       '系统未检测到 Docker Desktop。' + #13#10#13#10 +
                       '您可以：' + #13#10 +
                       '  1. 现在取消安装，先安装 Docker Desktop' + #13#10 +
                       '     下载地址: https://www.docker.com/products/docker-desktop' + #13#10 +
                       '  2. 继续安装，稍后手动安装 Docker Desktop' + #13#10#13#10 +
                       '是否继续安装？',
                       mbConfirmation, MB_YESNO or MB_DEFBUTTON2);

    if Response = IDNO then
      Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Response: Integer;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Create data directories
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue'));
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue\data'));
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue\logs'));

    // Show Docker reminder if not installed
    if not IsDockerInstalled() then
    begin
      Response := MsgBox('安装完成！' + #13#10#13#10 +
                         '重要提醒：' + #13#10 +
                         'ChainlessChain 需要 Docker Desktop 来运行后端服务。' + #13#10#13#10 +
                         '系统未检测到 Docker Desktop。' + #13#10#13#10 +
                         '是否现在自动安装 Docker Desktop？' + #13#10 +
                         '（将自动下载约 500MB 并安装）' + #13#10#13#10 +
                         '选择"是"：自动安装 Docker Desktop' + #13#10 +
                         '选择"否"：稍后手动安装',
                         mbConfirmation, MB_YESNO or MB_DEFBUTTON1);

      if Response = IDYES then
      begin
        // Launch Docker Desktop installer script
        if Exec(ExpandConstant('{app}\install-docker-desktop.bat'), '', '', SW_SHOW, ewNoWait, ResultCode) then
        begin
          MsgBox('Docker Desktop 安装程序已启动' + #13#10 +
                 '请按照安装向导完成安装' + #13#10#13#10 +
                 '安装完成后请重启计算机',
                 mbInformation, MB_OK);
        end
        else
        begin
          MsgBox('启动 Docker Desktop 安装程序失败' + #13#10 +
                 '请手动运行: ' + ExpandConstant('{app}\install-docker-desktop.bat'),
                 mbError, MB_OK);
        end;
      end
      else
      begin
        MsgBox('您选择了稍后安装 Docker Desktop' + #13#10#13#10 +
               '请记得安装 Docker Desktop 后再运行 ChainlessChain：' + #13#10 +
               '  1. 手动下载: https://www.docker.com/products/docker-desktop' + #13#10 +
               '  2. 或运行: ' + ExpandConstant('{app}\install-docker-desktop.bat'),
               mbInformation, MB_OK);
      end;
    end
    else
    begin
      MsgBox('安装完成！' + #13#10#13#10 +
             '您可以使用以下方式启动：' + #13#10 +
             '  1. "启动 ChainlessChain (含后端)" - 一键启动前后端' + #13#10 +
             '  2. "管理后端服务" - 单独管理后端 Docker 服务' + #13#10#13#10 +
             '首次启动会下载约 2-3GB 的 Docker 镜像，请耐心等待。',
             mbInformation, MB_OK);
    end;
  end;
end;

function InitializeUninstall(): Boolean;
var
  Response: Integer;
  ResponseDocker: Integer;
  ResultCode: Integer;
begin
  Result := True;

  // Ask user if they want to preserve their data
  Response := MsgBox('是否保留您的 ChainlessChain 数据（笔记、设置等）？' + #13#10#13#10 +
                     '选择 "是" 保留数据以供将来重新安装使用' + #13#10 +
                     '选择 "否" 完全删除所有数据',
                     mbConfirmation, MB_YESNO);

  if Response = IDNO then
  begin
    // User chose to delete all data
    DelTree(ExpandConstant('{userappdata}\chainlesschain-desktop-vue'), True, True, True);

    // Ask about Docker containers and volumes
    ResponseDocker := MsgBox('是否同时清理 Docker 容器和数据卷？' + #13#10#13#10 +
                             '这将删除：' + #13#10 +
                             '  - 所有后端服务容器' + #13#10 +
                             '  - Ollama 模型数据' + #13#10 +
                             '  - 向量数据库数据' + #13#10 +
                             '  - PostgreSQL 和 Redis 数据' + #13#10#13#10 +
                             '注意：清理后需要重新下载约 2-3GB 的数据',
                             mbConfirmation, MB_YESNO or MB_DEFBUTTON2);

    if ResponseDocker = IDYES then
    begin
      // Stop and remove Docker containers
      Exec('cmd.exe', '/c cd /d "' + ExpandConstant('{app}') + '\backend-services" && docker-compose down -v',
           '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Additional cleanup - stop Docker containers if still running
    Exec('cmd.exe', '/c docker stop chainlesschain-ollama chainlesschain-qdrant chainlesschain-chromadb chainlesschain-postgres chainlesschain-redis >nul 2>&1',
         '', SW_HIDE, ewNoWait, ResultCode);
  end;
end;

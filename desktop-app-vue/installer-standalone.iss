; ChainlessChain Windows Installer Script - Standalone Version (No Docker)
; Built with Inno Setup 6.x
; https://jrsoftware.org/isinfo.php

#define MyAppName "ChainlessChain Standalone"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "ChainlessChain Team"
#define MyAppURL "https://github.com/chainlesschain/chainlesschain"
#define MyAppExeName "chainlesschain.exe"
#define MyAppId "{{A1B2C3D4-E5F6-7890-ABCD-EF1234567891}"

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
OutputBaseFilename=ChainlessChain-Standalone-Setup-{#MyAppVersion}
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
InfoBeforeFile=INSTALL_INFO_STANDALONE.md

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
Source: "out\ChainlessChain-win32-x64\*"; DestDir: "{app}"; \
  Excludes: "\tests,\test,*.test.js,*.test.ts,*.spec.js,*.spec.ts,\coverage,\playwright-report,*.md,README*,CHANGELOG*,LICENSE.txt,\docs,\examples,*.map,*.log,\backend-standalone,\backend-config"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; Standalone backend services (if exists)
Source: "out\ChainlessChain-win32-x64\backend-standalone\*"; DestDir: "{app}\backend-standalone"; \
  Flags: ignoreversion recursesubdirs createallsubdirs; Check: BackendStandaloneExists

; Cloud backend configuration (if exists)
; Source: "out\ChainlessChain-win32-x64\backend-config\*"; DestDir: "{app}\backend-config"; \
;   Flags: ignoreversion recursesubdirs createallsubdirs; Check: BackendConfigExists

; Installation info
Source: "INSTALL_INFO_STANDALONE.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Start Menu
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\管理后端服务"; Filename: "{app}\backend-standalone\manage-backend.bat"; Check: BackendStandaloneExists
; Name: "{group}\后端配置说明"; Filename: "{app}\backend-config\README.md"; Check: BackendConfigExists
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

; Desktop
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

; Quick Launch
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: quicklaunchicon

[Registry]
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

function BackendStandaloneExists: Boolean;
begin
  Result := DirExists(ExpandConstant('{app}\backend-standalone'));
end;

function BackendConfigExists: Boolean;
begin
  Result := DirExists(ExpandConstant('{app}\backend-config'));
end;

function InitializeSetup(): Boolean;
begin
  Result := True;

  // No Docker requirement check for standalone version
  // Just show welcome message
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Response: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Create data directories
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue'));
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue\data'));
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue\logs'));

    // Show installation complete message
    if BackendStandaloneExists then
    begin
      MsgBox('安装完成！' + #13#10#13#10 +
             '独立版后端服务已安装' + #13#10#13#10 +
             '启动方式：' + #13#10 +
             '  1. 双击桌面图标启动应用' + #13#10 +
             '  2. 后端服务会自动在后台运行' + #13#10 +
             '  3. 可通过"管理后端服务"手动控制' + #13#10#13#10 +
             '服务地址：' + #13#10 +
             '  - Project Service: http://localhost:9090' + #13#10 +
             '  - AI Service: http://localhost:8001',
             mbInformation, MB_OK);
    end
    else if BackendConfigExists then
    begin
      MsgBox('安装完成！' + #13#10#13#10 +
             '云端版已安装' + #13#10#13#10 +
             '重要：需要配置后端服务地址' + #13#10#13#10 +
             '配置步骤：' + #13#10 +
             '  1. 找到安装目录下的 backend-config 文件夹' + #13#10 +
             '  2. 编辑 backend-config.env 文件' + #13#10 +
             '  3. 填入您的后端服务地址和 API 密钥' + #13#10 +
             '  4. 保存并启动应用' + #13#10#13#10 +
             '详细说明请查看 backend-config\README.md',
             mbInformation, MB_OK);
    end
    else
    begin
      MsgBox('安装完成！' + #13#10#13#10 +
             '前端应用已安装' + #13#10#13#10 +
             '注意：需要配置后端服务' + #13#10#13#10 +
             '您可以：' + #13#10 +
             '  1. 使用 Docker 部署后端服务' + #13#10 +
             '  2. 使用独立编译的后端服务' + #13#10 +
             '  3. 连接到云端后端服务' + #13#10#13#10 +
             '在应用设置中配置后端服务地址',
             mbInformation, MB_OK);
    end;
  end;
end;

function InitializeUninstall(): Boolean;
var
  Response: Integer;
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
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Stop backend services if running
    if BackendStandaloneExists then
    begin
      Exec('cmd.exe', '/c taskkill /F /IM project-service.exe /T >nul 2>&1', '', SW_HIDE, ewNoWait, ResultCode);
      Exec('cmd.exe', '/c taskkill /F /IM ai-service.exe /T >nul 2>&1', '', SW_HIDE, ewNoWait, ResultCode);
    end;
  end;
end;

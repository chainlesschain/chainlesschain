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
  Excludes: "\tests,\test,*.test.js,*.test.ts,*.spec.js,*.spec.ts,\coverage,\playwright-report,*.md,README*,CHANGELOG*,LICENSE.txt,\docs,\examples,*.map,*.log"; \
  Flags: ignoreversion recursesubdirs createallsubdirs

; Data directory - create empty structure
; Note: User data will be stored in %APPDATA%\chainlesschain-desktop-vue

[Icons]
; Start Menu
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

; Desktop
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

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

function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;

  // Check if .NET Framework or other prerequisites are installed (if needed)
  // Currently ChainlessChain is a standalone Electron app, so no prerequisites needed
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Create data directories
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue'));
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue\data'));
    CreateDir(ExpandConstant('{userappdata}\chainlesschain-desktop-vue\logs'));
  end;
end;

function InitializeUninstall(): Boolean;
var
  Response: Integer;
begin
  Result := True;

  // Ask user if they want to preserve their data
  Response := MsgBox('Do you want to keep your ChainlessChain data (notes, settings, etc.)?' + #13#10#13#10 +
                     'Select "Yes" to keep your data for future installations.' + #13#10 +
                     'Select "No" to completely remove all data.',
                     mbConfirmation, MB_YESNO);

  if Response = IDNO then
  begin
    // User chose to delete all data
    DelTree(ExpandConstant('{userappdata}\chainlesschain-desktop-vue'), True, True, True);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Additional cleanup if needed
  end;
end;

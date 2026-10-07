; One Setup.exe around the MSI of an app. The MSI stays the source of truth for what gets
; installed (files, Start Menu shortcut, file associations, Add/Remove Programs entry), so this
; wizard adds a familiar single file, a Vietnamese UI and the license page, nothing else.
; Compiled by scripts/windows/make-setup.ps1, which writes defs.iss (AppName, AppVersion, Publisher,
; AppFolder, ExeName, MsiFile, MsiName, IconFile, LicenseFile, OutDir, OutName, optional NoVietnamese).
; Saved as UTF-8 with BOM: Inno Setup reads a script without BOM as ANSI.

#include "defs.iss"

[Setup]
AppId=store.thaipro.{#AppName}.Setup
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
AppPublisherURL=https://thaipro.store/phan-mem
AppSupportURL=https://thaipro.store/phan-mem
CreateAppDir=no
DisableProgramGroupPage=yes
DisableReadyPage=yes
Uninstallable=no
CreateUninstallRegKey=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=none
SolidCompression=no
WizardStyle=modern
SetupIconFile={#IconFile}
LicenseFile={#LicenseFile}
OutputDir={#OutDir}
OutputBaseFilename={#OutName}

[Languages]
#ifndef NoVietnamese
Name: "vi"; MessagesFile: "Vietnamese.isl"
#endif
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
#ifndef NoVietnamese
vi.Installing=Đang cài đặt %1...
vi.InstallFailed=Cài đặt %1 không thành công (mã lỗi %2). Hãy thử chạy lại, hoặc tải bản .msi trên trang tải.
vi.LaunchApp=Mở %1 ngay
#endif
en.Installing=Installing %1...
en.InstallFailed=Installing %1 failed (error code %2). Try again, or download the .msi from the download page.
en.LaunchApp=Launch %1 now

[Files]
Source: "{#MsiFile}"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Run]
Filename: "{commonpf64}\{#AppFolder}\{#ExeName}"; Description: "{cm:LaunchApp,{#AppName}}"; Flags: postinstall nowait skipifsilent unchecked

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Args: String;
begin
  if CurStep <> ssPostInstall then
    exit;

  if WizardSilent then
    Args := '/i "' + ExpandConstant('{tmp}\{#MsiName}') + '" /qn /norestart'
  else
    Args := '/i "' + ExpandConstant('{tmp}\{#MsiName}') + '" /passive /norestart';

  WizardForm.StatusLabel.Caption := FmtMessage(CustomMessage('Installing'), ['{#AppName}']);
  if not Exec(ExpandConstant('{sys}\msiexec.exe'), Args, '', SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode) then
    ResultCode := -1;

  { 0 = done, 3010 = done but a restart is pending }
  if (ResultCode = 0) or (ResultCode = 3010) then
    exit;

  { 1602 / 1223 = the user cancelled the Windows Installer dialog: stop quietly }
  if (ResultCode <> 1602) and (ResultCode <> 1223) then
    SuppressibleMsgBox(FmtMessage(CustomMessage('InstallFailed'), ['{#AppName}', IntToStr(ResultCode)]), mbError, MB_OK, IDOK);
  Abort;
end;

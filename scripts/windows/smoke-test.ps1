<#
.SYNOPSIS
  Install an app from its Setup.exe on this (CI) machine, check what Windows now knows about it,
  uninstall it, and check it is gone.

.DESCRIPTION
  Usage: scripts/windows/smoke-test.ps1 -App <app>   (any folder under apps/ with an app.env)
  Checks: the Add/Remove Programs entry, the executable, the Start Menu shortcut and, for the PDF
  and image apps, the "Open with" registration (plus Default apps for PrintCraft). It never launches the app (no GPU on CI).
#>
param([Parameter(Mandatory = $true)] [string] $App)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'app-config.ps1')
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Dist = Join-Path $Root "build\$App\dist\release"
$conf = Get-AppConfig $App
$cfg = @{
  Name = $conf.NAME; Folder = $conf.FOLDER; Exe = $conf.EXE; Setup = "$($conf.FILE_PREFIX)-*-windows-x64-setup.exe"
  ProgId = $conf.SMOKE_PROGID; Ext = $conf.SMOKE_EXT; Registered = ($conf.SMOKE_REGISTERED -eq '1'); Nsis = ($conf.INSTALLER -eq 'nsis')
}

function Find-Arp([string] $name) {
  Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -like "$name*" } | Select-Object -First 1
}
function Assert-That([bool] $ok, [string] $what) {
  if ($ok) { Write-Output "ok   $what" } else { throw "FAILED: $what" }
}

$Setup = Get-ChildItem -Path $Dist -Filter $cfg.Setup | Select-Object -First 1
if (-not $Setup) { throw "no $($cfg.Setup) in $Dist" }
Write-Output "==> install $($Setup.Name) silently"
$silent = if ($cfg.Nsis) { @('/S', '/allusers') } else { @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$env:RUNNER_TEMP\setup-$App.log") }
$p = Start-Process -FilePath $Setup.FullName -ArgumentList $silent -Wait -PassThru
Assert-That ($p.ExitCode -eq 0) "Setup.exe exit code is 0 (was $($p.ExitCode))"

$exe = Join-Path $env:ProgramFiles "$($cfg.Folder)\$($cfg.Exe)"
$arp = Find-Arp $cfg.Name
Assert-That (Test-Path $exe) "executable installed at $exe"
Assert-That ($null -ne $arp) "Add/Remove Programs lists '$($cfg.Name)'"
Assert-That (Test-Path (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$($cfg.Name).lnk")) 'Start Menu shortcut exists'
if ($cfg.ProgId) {
  $withProgids = Get-Item "HKLM:\Software\Classes\$($cfg.Ext)\OpenWithProgids" -ErrorAction SilentlyContinue
  Assert-That ($null -ne $withProgids -and ($withProgids.GetValueNames() -contains $cfg.ProgId)) "$($cfg.Ext) lists $($cfg.ProgId) under Open with"
  if ($cfg.Registered) {
    $reg = Get-ItemProperty 'HKLM:\Software\RegisteredApplications' -ErrorAction SilentlyContinue
    Assert-That ($null -ne $reg -and $null -ne $reg.PSObject.Properties[$cfg.Name]) "$($cfg.Name) is listed in Settings > Default apps"
  }
}

if ($conf.SMOKE_HEALTH_URL) {
  Write-Output "==> start the app and wait for $($conf.SMOKE_HEALTH_URL)"
  $proc = Start-Process -FilePath $exe -PassThru
  $answered = $false
  for ($i = 0; $i -lt 90 -and -not $answered; $i++) {
    Start-Sleep -Seconds 1
    try { $answered = (Invoke-WebRequest -UseBasicParsing -Uri $conf.SMOKE_HEALTH_URL -TimeoutSec 2).StatusCode -eq 200 } catch { $answered = $false }
  }
  taskkill /PID $proc.Id /T /F | Out-Null
  if (-not $answered) {
    $log = Join-Path $env:APPDATA "$($conf.NAME)\server.log"
    if (Test-Path $log) { Write-Output '--- server.log'; Get-Content $log -Tail 40 }
  }
  Assert-That $answered 'the installed app starts and answers on its local address'
}

Write-Output '==> uninstall through the Add/Remove Programs entry'
$entry = Get-ItemProperty $arp.PSPath
if ($cfg.Nsis) {
  Assert-That ($entry.UninstallString -match '^"([^"]+)"') 'the uninstall command is readable'
  $uninstaller = $Matches[1]
  $installDir = Split-Path $uninstaller
  # _?= keeps the NSIS uninstaller in this process, so -Wait really waits for it.
  $u = Start-Process -FilePath $uninstaller -ArgumentList '/S', '/allusers', "_?=$installDir" -Wait -PassThru
  Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
  Assert-That ($u.ExitCode -eq 0) "uninstaller exit code is 0 (was $($u.ExitCode))"
} else {
  $productCode = $arp.PSChildName
  $u = Start-Process -FilePath msiexec.exe -ArgumentList '/x', $productCode, '/qn', '/norestart' -Wait -PassThru
  Assert-That ($u.ExitCode -eq 0) "msiexec /x exit code is 0 (was $($u.ExitCode))"
}
Assert-That (-not (Test-Path $exe)) 'executable removed'
Assert-That ($null -eq (Find-Arp $cfg.Name)) 'Add/Remove Programs entry removed'
Write-Output "$App smoke test passed"

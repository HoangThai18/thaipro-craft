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
  ProgId = $conf.SMOKE_PROGID; Ext = $conf.SMOKE_EXT; Registered = ($conf.SMOKE_REGISTERED -eq '1')
}

function Find-Arp([string] $name) {
  Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -eq $name } | Select-Object -First 1
}
function Assert-That([bool] $ok, [string] $what) {
  if ($ok) { Write-Output "ok   $what" } else { throw "FAILED: $what" }
}

$Setup = Get-ChildItem -Path $Dist -Filter $cfg.Setup | Select-Object -First 1
if (-not $Setup) { throw "no $($cfg.Setup) in $Dist" }
Write-Output "==> install $($Setup.Name) silently"
$p = Start-Process -FilePath $Setup.FullName -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$env:RUNNER_TEMP\setup-$App.log" -Wait -PassThru
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

Write-Output '==> uninstall through the MSI entry'
$productCode = $arp.PSChildName
$u = Start-Process -FilePath msiexec.exe -ArgumentList '/x', $productCode, '/qn', '/norestart' -Wait -PassThru
Assert-That ($u.ExitCode -eq 0) "msiexec /x exit code is 0 (was $($u.ExitCode))"
Assert-That (-not (Test-Path $exe)) 'executable removed'
Assert-That ($null -eq (Find-Arp $cfg.Name)) 'Add/Remove Programs entry removed'
Write-Output "$App smoke test passed"

<#
.SYNOPSIS
  Wrap the MSI of an app in a single Setup.exe (Inno Setup).

.DESCRIPTION
  Usage: scripts/windows/make-setup.ps1 -App <photocraft|printcraft|opencut>
  Reads build/<app>/dist/release/*-windows-x64.msi and writes the Setup.exe next to it.
  Installs Inno Setup with Chocolatey when ISCC.exe is missing. The Vietnamese wizard needs
  Inno Setup 6.5 or newer; with an older one the wizard is English only (a warning says so).
#>
param([Parameter(Mandatory = $true)] [ValidateSet('photocraft', 'printcraft', 'opencut')] [string] $App)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Build = Join-Path $Root "build\$App"

# Per-app facts that the MSIs fix: install folder, executable, icon, license page.
$cfg = switch ($App) {
  'photocraft' { @{ Name = 'PhotoCraft'; Folder = 'PhotoCraft'; Exe = 'photocraft.exe'; Msi = 'photocraft-*-windows-x64.msi'; Icon = 'assets\app-icon\photocraft.ico'; License = 'LICENSE-MIT'; Out = 'photocraft'; Publisher = 'ArtCraft team (rebuilt by thaipro.store)' } }
  'printcraft' { @{ Name = 'PrintCraft'; Folder = 'PrintCraft'; Exe = 'printcraft.exe'; Msi = 'printcraft-*-windows-x64.msi'; Icon = 'assets\app-icon\printcraft.ico'; License = 'LICENSE-MIT'; Out = 'printcraft'; Publisher = 'ArtCraft team (rebuilt by thaipro.store)' } }
  'opencut'    { @{ Name = 'ThaiCutCut'; Folder = 'ThaiCutCut'; Exe = 'thaicutcut.exe'; Msi = 'thaicutcut-*-windows-x64.msi'; Icon = 'packaging\windows\thaicutcut.ico'; License = 'LICENSE'; Out = 'thaicutcut'; Publisher = 'thaipro.store' } }
}

$Dist = Join-Path $Build 'dist\release'
$Msi = Get-ChildItem -Path $Dist -Filter $cfg.Msi | Select-Object -First 1
if (-not $Msi) { throw "no $($cfg.Msi) in $Dist" }
$Version = ($Msi.BaseName -replace "^$($cfg.Out)-", '') -replace '-windows-x64$', ''

$Iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $Iscc) {
  foreach ($dir in @("${env:ProgramFiles(x86)}\Inno Setup 6", "$env:ProgramFiles\Inno Setup 6")) {
    if (Test-Path (Join-Path $dir 'ISCC.exe')) { $Iscc = Join-Path $dir 'ISCC.exe'; break }
  }
}
if (-not $Iscc) {
  Write-Output '==> installing Inno Setup'
  choco install innosetup -y --no-progress | Out-Null
  $Iscc = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'
}
if (-not (Test-Path $Iscc)) { throw 'ISCC.exe not found' }
$IsccVersion = [version](Get-Item $Iscc).VersionInfo.FileVersion
Write-Output "Inno Setup $IsccVersion"

$work = Join-Path $Root 'build\setup-work'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $work | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'setup.iss') $work
Copy-Item (Join-Path $PSScriptRoot 'Vietnamese.isl') $work

$q = { param($v) '"' + ($v -replace '"', '""') + '"' }
$outName = "$($cfg.Out)-$Version-windows-x64-setup"
$defs = @(
  "#define AppName $(& $q $cfg.Name)", "#define AppVersion $(& $q $Version)", "#define Publisher $(& $q $cfg.Publisher)",
  "#define AppFolder $(& $q $cfg.Folder)", "#define ExeName $(& $q $cfg.Exe)",
  "#define MsiFile $(& $q $Msi.FullName)", "#define MsiName $(& $q $Msi.Name)",
  "#define IconFile $(& $q (Join-Path $Build $cfg.Icon))", "#define LicenseFile $(& $q (Join-Path $Build $cfg.License))",
  "#define OutDir $(& $q $Dist)", "#define OutName $(& $q $outName)"
)
if ($IsccVersion -lt [version]'6.5.0') {
  Write-Warning "Inno Setup $IsccVersion is older than 6.5: the Vietnamese wizard language is skipped"
  $defs += '#define NoVietnamese'
}
Set-Content -Path (Join-Path $work 'defs.iss') -Value $defs -Encoding ascii

& $Iscc /Q (Join-Path $work 'setup.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }
Get-Item (Join-Path $Dist "$outName.exe") | Format-Table Name, Length

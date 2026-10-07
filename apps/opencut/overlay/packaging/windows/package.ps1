<#
.SYNOPSIS
  Build and package ThaiCutCut 2.0 for Windows (x64).

.DESCRIPTION
  Produces, in $env:DIST (default: dist/release):
    thaicutcut2-<version>-windows-x64.msi            per-machine installer (WiX v5)
    thaicutcut2-<version>-windows-x64-portable.zip   thaicutcut2.exe + license notices

  The binary links the C runtime statically (+crt-static), so neither package needs the Visual
  C++ redistributable. Nothing is signed: Windows SmartScreen warns on first launch.

  Needs: Rust (MSVC toolchain + x86_64-pc-windows-msvc) and WiX v5:
    dotnet tool install --global wix --version 5.0.2
#>
param([switch] $SkipBuild)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-Native([string] $What, [scriptblock] $Block) {
  Write-Output "==> $What"
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

# The version lives in one place: [workspace.package] version in the root Cargo.toml.
$Version = $null
$inPkg = $false
foreach ($line in Get-Content (Join-Path $Root 'Cargo.toml')) {
  if ($line -match '^\s*\[') { $inPkg = ($line.Trim() -eq '[workspace.package]'); continue }
  if ($inPkg -and $line -match '^\s*version\s*=\s*"([^"]+)"') { $Version = $Matches[1]; break }
}
if (-not $Version) { throw 'could not read [workspace.package] version from Cargo.toml' }
$MsiVersion = ($Version -split '-')[0]

$Target = 'x86_64-pc-windows-msvc'
$Dist = if ($env:DIST) { $env:DIST } else { Join-Path $Root 'dist\release' }
New-Item -ItemType Directory -Force -Path $Dist | Out-Null

Write-Output "ThaiCutCut 2.0 ($Version) for Windows x64 ($Target)"

if (-not $SkipBuild) {
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = '-C target-feature=+crt-static'
  Invoke-Native "cargo build ($Target)" { cargo build --release --locked -p opencut-desktop --target $Target }
}

$Exe = Join-Path $Root "target\$Target\release\thaicutcut2.exe"
if (-not (Test-Path $Exe)) { throw "missing $Exe" }

# PE header check: machine must be x64 and the subsystem GUI (2), or a console window opens with the app.
$bytes = [System.IO.File]::ReadAllBytes($Exe)
$pe = [BitConverter]::ToInt32($bytes, 0x3C)
$machine = [BitConverter]::ToUInt16($bytes, $pe + 4)
$subsystem = [BitConverter]::ToUInt16($bytes, $pe + 0x5C)
if ($machine -ne 0x8664) { throw ('thaicutcut2.exe machine is 0x{0:X}, expected 0x8664' -f $machine) }
if ($subsystem -ne 2) { throw "thaicutcut2.exe PE subsystem is $subsystem, expected 2 (Windows GUI)" }
Write-Output "ok thaicutcut2.exe: x64, GUI subsystem"

$Stage = Join-Path $Root 'target\windows-package'
Remove-Item -Recurse -Force $Stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item $Exe $Stage
Copy-Item (Join-Path $Root 'LICENSE') (Join-Path $Stage 'LICENSE-OpenCut.txt')
Copy-Item (Join-Path $Root 'THIRD_PARTY_LICENSES.md') $Stage
Copy-Item (Join-Path $Root 'packaging\README.txt') $Stage

$Msi = Join-Path $Dist "thaicutcut2-$Version-windows-x64.msi"
Invoke-Native 'wix build' {
  wix build (Join-Path $PSScriptRoot 'thaicutcut.wxs') -arch x64 `
    -d "Version=$MsiVersion" -d "BinDir=$Stage" -d "IconPath=$(Join-Path $PSScriptRoot 'thaicutcut.ico')" `
    -o $Msi
}
Remove-Item -Force -ErrorAction SilentlyContinue ([IO.Path]::ChangeExtension($Msi, '.wixpdb'))

$Portable = Join-Path $Root "target\thaicutcut2-$Version-windows-x64-portable"
Remove-Item -Recurse -Force $Portable -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Portable | Out-Null
Copy-Item (Join-Path $Stage '*') $Portable
$Zip = Join-Path $Dist "thaicutcut2-$Version-windows-x64-portable.zip"
Remove-Item -Force $Zip -ErrorAction SilentlyContinue
Compress-Archive -Path $Portable -DestinationPath $Zip

Get-Item $Msi, $Zip | Format-Table Name, Length

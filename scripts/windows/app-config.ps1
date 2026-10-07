# Dot-sourced by make-setup.ps1 and smoke-test.ps1: reads apps/<app>/app.env into one hashtable.
# FILE_PREFIX is the name the packages start with (defaults to the app); PUBLISHER is shown in the wizard.
function Get-AppConfig([string] $App) {
  $file = Join-Path $PSScriptRoot "..\..\apps\$App\app.env"
  if (-not (Test-Path $file)) { throw "unknown app '$App' (no apps/$App/app.env)" }
  $cfg = @{}
  foreach ($line in Get-Content $file) {
    if ($line -match '^\s*([A-Z_]+)=(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
  }
  if (-not $cfg.FILE_PREFIX) { $cfg.FILE_PREFIX = $App }
  if (-not $cfg.PUBLISHER) { $cfg.PUBLISHER = 'ArtCraft team (rebuilt by thaipro.store)' }
  foreach ($key in 'NAME', 'FOLDER', 'EXE', 'ICON', 'LICENSE_FILE') {
    if (-not $cfg[$key]) { throw "apps/$App/app.env is missing $key" }
  }
  $cfg
}

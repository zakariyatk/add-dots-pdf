# Packs the app built by `npx tauri build` into an MSIX for the Microsoft
# Store: the app's .exe, msix/Assets and msix/AppxManifest.xml (with the
# version filled in), plus resources.pri for the scaled logos.
#
#   pwsh msix/pack.ps1 -Version 1.0.42.0 [-Out ADD-DOTS-PDF.msix]
#
# The package is not signed: the Store signs it on upload. To install it on
# a computer first, sign it with a certificate whose subject is the
# manifest's Publisher (CI does that with a throwaway one, to test it).
param(
  [Parameter(Mandatory = $true)][string] $Version,
  [string] $Out = 'ADD-DOTS-PDF.msix'
)
$ErrorActionPreference = 'Stop'
# the Store wants four numbers, the last one 0
if ($Version -notmatch '^\d+\.\d+\.\d+\.0$') { throw "version '$Version' must look like 1.0.42.0 (the last number 0)" }

$here = $PSScriptRoot
$exe = Join-Path $here '..\src-tauri\target\release\adddots-pdf.exe'
if (-not (Test-Path $exe)) { throw "no app at ${exe}: run 'npx tauri build' first" }

# the Windows SDK's tools, newest version installed
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object { [version](Split-Path (Split-Path (Split-Path $_.FullName)) -Leaf) } | Select-Object -Last 1
if (-not $sdk) { throw 'makeappx.exe not found: the Windows 10/11 SDK is needed' }
$bin = Split-Path $sdk.FullName

$layout = Join-Path ([IO.Path]::GetTempPath()) ('adddots-msix-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $layout | Out-Null
try {
  Copy-Item $exe $layout
  Copy-Item (Join-Path $here 'Assets') (Join-Path $layout 'Assets') -Recurse
  $manifest = Get-Content (Join-Path $here 'AppxManifest.xml') -Raw
  $manifest = $manifest.Replace('{VERSION}', $Version).Replace('{EXE}', (Split-Path $exe -Leaf))
  Set-Content (Join-Path $layout 'AppxManifest.xml') $manifest -Encoding utf8

  # resources.pri: lets Windows pick the 16-256 px taskbar logos
  $cfg = Join-Path $layout 'priconfig.xml'
  & "$bin\makepri.exe" createconfig /cf $cfg /dq en-US /o | Out-Null
  if ($LASTEXITCODE) { throw "makepri createconfig failed ($LASTEXITCODE)" }
  & "$bin\makepri.exe" new /pr $layout /cf $cfg /of (Join-Path $layout 'resources.pri') /o | Out-Null
  if ($LASTEXITCODE) { throw "makepri new failed ($LASTEXITCODE)" }
  Remove-Item $cfg

  # makeappx checks the manifest against the schema as it packs
  & "$bin\makeappx.exe" pack /d $layout /p $Out /o
  if ($LASTEXITCODE) { throw "makeappx pack failed ($LASTEXITCODE)" }
  "ok  $Out  ($Version)"
} finally {
  Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
}

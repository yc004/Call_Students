param(
  [string]$Version = '1.18.0'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$classroomDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\classroom-app')).Path
$cacheDir = Join-Path $classroomDir '.cache\onnxruntime'
$archive = Join-Path $cacheDir "onnxruntime-win-x64-$Version.zip"
$extractDir = Join-Path $cacheDir "extract-$Version"
$depsDir = Join-Path $classroomDir 'native\deps\onnxruntime'
$downloadUrl = "https://github.com/microsoft/onnxruntime/releases/download/v$Version/onnxruntime-win-x64-$Version.zip"

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
if (-not (Test-Path $archive)) {
  Write-Host "[onnxruntime] downloading $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
}

if ((Get-Item $archive).Length -lt 1MB) {
  throw "ONNX Runtime archive is unexpectedly small: $archive"
}

if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -Path $archive -DestinationPath $extractDir -Force

$packageRoot = Get-ChildItem $extractDir -Directory | Select-Object -First 1
if (-not $packageRoot) { throw 'ONNX Runtime archive did not contain a package directory' }
$includeSource = Join-Path $packageRoot.FullName 'include'
$librarySource = Join-Path $packageRoot.FullName 'lib\onnxruntime.lib'
$runtimeSource = Join-Path $packageRoot.FullName 'lib\onnxruntime.dll'
if (-not (Test-Path $runtimeSource)) {
  $runtimeSource = Join-Path $packageRoot.FullName 'bin\onnxruntime.dll'
}

foreach ($required in @($includeSource, $librarySource, $runtimeSource)) {
  if (-not (Test-Path $required)) { throw "Required ONNX Runtime file is missing: $required" }
}

$includeTarget = Join-Path $depsDir 'include'
$libraryTarget = Join-Path $depsDir 'lib'
if (Test-Path $includeTarget) { Remove-Item -Recurse -Force $includeTarget }
New-Item -ItemType Directory -Force -Path $includeTarget, $libraryTarget | Out-Null
Copy-Item (Join-Path $includeSource '*') $includeTarget -Recurse -Force
Copy-Item $librarySource $libraryTarget -Force
Copy-Item $runtimeSource $libraryTarget -Force

Write-Host "[onnxruntime] prepared Windows x64 runtime $Version"

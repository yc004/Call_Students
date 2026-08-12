param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$UnpackedExecutable,
  [Parameter(Mandatory = $true)][string]$InstalledExecutableName,
  [Parameter(Mandatory = $true)][string]$InstallFolderName
)

$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path $Installer).Path
$unpackedPath = (Resolve-Path $UnpackedExecutable).Path
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$installDir = Join-Path $tempRoot $InstallFolderName

function Invoke-SmokeTest([string]$Executable, [string]$Label) {
  Write-Host "[smoke] starting ${Label}: $Executable"
  $safeLabel = $Label -replace '[^A-Za-z0-9_-]', '-'
  $stdoutPath = Join-Path $tempRoot "$safeLabel.stdout.log"
  $stderrPath = Join-Path $tempRoot "$safeLabel.stderr.log"
  $env:CLASSROOM_SMOKE_LOG = Join-Path $tempRoot 'classroom-smoke.log'
  $process = Start-Process -FilePath $Executable -ArgumentList @('--ci-smoke-test', '--enable-logging') `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -Wait -PassThru
  $exitCode = $process.ExitCode
  if ($exitCode -ne 0) {
    foreach ($logPath in @($stdoutPath, $stderrPath, (Join-Path $tempRoot 'classroom-smoke.log'))) {
      if (Test-Path $logPath) {
        Write-Host "[smoke] diagnostic log: $logPath"
        Get-Content $logPath | Write-Host
      }
    }
    throw "$Label failed with exit code $exitCode"
  }
  Write-Host "[smoke] $Label passed"
}

if ((Get-Item $installerPath).Length -lt 1MB) {
  throw "Installer is unexpectedly small: $installerPath"
}
if ($env:WINDOWS_SIGNING_ENABLED -eq 'true') {
  $signature = Get-AuthenticodeSignature $installerPath
  if ($signature.Status -ne 'Valid') {
    throw "Installer signature is not valid: $($signature.Status) $($signature.StatusMessage)"
  }
  Write-Host "[installer] Authenticode signature is valid"
}

Invoke-SmokeTest $unpackedPath 'unpacked application'

if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
Write-Host "[installer] installing silently to $installDir"
$installProcess = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
if ($installProcess.ExitCode -ne 0) { throw "Installer failed with exit code $($installProcess.ExitCode)" }

$installedExecutable = Join-Path $installDir $InstalledExecutableName
if (-not (Test-Path $installedExecutable)) {
  throw "Installed executable was not found: $installedExecutable"
}
Invoke-SmokeTest $installedExecutable 'installed application'

$digest = (Get-FileHash -Algorithm SHA256 $installerPath).Hash.ToLowerInvariant()
$checksumPath = "$installerPath.sha256"
"$digest  $(Split-Path $installerPath -Leaf)" | Set-Content -Path $checksumPath -Encoding ascii
Write-Host "[installer] verified and checksummed $(Split-Path $installerPath -Leaf)"

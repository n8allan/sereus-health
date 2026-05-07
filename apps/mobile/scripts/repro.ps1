# Single-trial reproduction loop for the Hermes V1 categories CREATE TABLE bug.
#
# Assumes Metro is already running on :8081 and the device/emulator is attached.
# Wipes app data, launches the app, watches logcat, and prints one of:
#   BUG     - "Failed to execute DDL: create table App.categories" hit
#   MASKED  - app started, repro completed, no DDL failure within window
#   TIMEOUT - neither outcome reached before the window expired
#
# Usage:
#   ./repro.ps1                # single trial
#   ./repro.ps1 -N 10          # N trials, prints summary
#   ./repro.ps1 -SaveLog path  # save full logcat to file (per-trial if -N>1)

param(
    [int]$N = 1,
    [int]$WindowSec = 20,
    [string]$Package = "org.sereus.health",
    [string]$Activity = "org.sereus.health/.MainActivity",
    [string]$SaveLog = ""
)

$ErrorActionPreference = "Stop"

function Invoke-OneTrial {
    param([int]$TrialIndex, [string]$LogPath)

    # 1. Wipe app data (force-stops the app and clears /data).
    & adb shell pm clear $Package | Out-Null

    # 2. Drain logcat so we only see this trial's output.
    & adb logcat -c

    # 3. Launch the app.
    & adb shell am start -n $Activity 2>&1 | Out-Null

    # 4. Stream logcat for up to $WindowSec seconds, looking for our markers.
    $startTime = Get-Date
    $result = "TIMEOUT"
    $reproDoneSeenAt = $null
    $logTmp = [System.IO.Path]::GetTempFileName()
    $logProc = Start-Process -FilePath "adb" -ArgumentList @("logcat", "-T", "1") `
        -NoNewWindow -PassThru -RedirectStandardOutput $logTmp

    try {
        while (((Get-Date) - $startTime).TotalSeconds -lt $WindowSec) {
            Start-Sleep -Milliseconds 250
            if (Test-Path $logTmp) {
                $content = Get-Content $logTmp -Raw -ErrorAction SilentlyContinue
                if ($content) {
                    # Production failure markers (the original bug we were chasing).
                    if ($content -match "Failed to execute DDL: create table App\.categories") {
                        $result = "BUG"
                        break
                    }
                    # Minimal-repro markers: REPRODUCED means the codegen bug fired
                    # in our standalone test; OK means the synthetic pattern is fine.
                    if ($content -match "\[hermes-v1-spread-await-repro\] REPRODUCED") {
                        $result = "BUG"
                        break
                    }
                    if (-not $reproDoneSeenAt -and ($content -match "\[hermes-v1-spread-await-repro\] OK" -or $content -match "\[hermes-v1-spread-await-repro\] ERROR")) {
                        $reproDoneSeenAt = Get-Date
                    }
                    # If repro completed and 4 more seconds passed without DDL failure, call it MASKED.
                    if ($reproDoneSeenAt -and ((Get-Date) - $reproDoneSeenAt).TotalSeconds -ge 4) {
                        $result = "MASKED"
                        break
                    }
                }
            }
        }
    }
    finally {
        Stop-Process -Id $logProc.Id -Force -ErrorAction SilentlyContinue
    }

    # Save logcat snapshot if requested, then clean up temp file.
    if ($LogPath) {
        Copy-Item $logTmp $LogPath -Force
    }
    Remove-Item $logTmp -Force -ErrorAction SilentlyContinue

    return $result
}

if ($N -eq 1) {
    $logPath = if ($SaveLog) { $SaveLog } else { "" }
    $result = Invoke-OneTrial -TrialIndex 1 -LogPath $logPath
    Write-Output $result
    if ($result -eq "BUG") { exit 1 }
    elseif ($result -eq "MASKED") { exit 0 }
    else { exit 2 }
} else {
    $results = @{ BUG = 0; MASKED = 0; TIMEOUT = 0 }
    for ($i = 1; $i -le $N; $i++) {
        $logPath = if ($SaveLog) { "$SaveLog.trial$i.log" } else { "" }
        $r = Invoke-OneTrial -TrialIndex $i -LogPath $logPath
        Write-Output ("trial {0,2}: {1}" -f $i, $r)
        $results[$r]++
    }
    Write-Output ""
    Write-Output ("summary  bug={0}/{3}  masked={1}/{3}  timeout={2}/{3}" -f $results.BUG, $results.MASKED, $results.TIMEOUT, $N)
}

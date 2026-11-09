# dsh-superagent Windows outer watchdog — ONE tick, then exits.
# Invoked every 15 minutes by dsh-superagent-guard.ps1 (the logon loop installed into the user
# Startup folder by install-guard-startup.cmd), or by hand for troubleshooting. Task Scheduler
# registration is refused in the environment this was built in, so the guard loop is the shipped
# mechanism; a scheduler you own may call this file directly instead. Each run self-terminates by
# design; the kill switch is the "disabled" marker the guard honours. Never force-kills anything.
#
# Actions (upstream docs/006 hourly-check semantics, ported to native Windows):
#   status exit 0  -> healthy. If a previous run had alerted, write RESOLVED once, reset counters.
#   status exit 1  -> not running / duplicate / unresponsive: run `restart --respect-stop`
#                     (an intentional `stop` marker is honoured and NOT resurrected). If the
#                     restart recovers (exit 0) log RECOVERED; otherwise count the consecutive
#                     failed restarts. After MaxFailedRestarts in a row, stop auto-restarting,
#                     raise ALERT with log excerpt; counter resets on any success.
#   status exit 2/3 -> running but a part errors / setup pending: NEVER restart. Raise ALERT
#                     only when the error signature changed since the last alert (no repeats).
#   status any     -> on raise/resolve, append ALERT|RESOLVED line to alerts.log for humans
#                     and for the assistant-side reminder poll to pick up.
# All state lives in %APPDATA%\Superagent\watchdog\: last-state.json, alerts.log, watchdog.log
# (rotated to 1 MiB). Exit code of this script is always 0: Task Scheduler must not retry-loop.
param([int]$MaxFailedRestarts = 3)
$ErrorActionPreference = 'Continue'
$Checkout = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Cmd = Join-Path $Checkout 'scripts\dsh-superagent.cmd'
$Dir = Join-Path $env:APPDATA 'Superagent\watchdog'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$StateFile = Join-Path $Dir 'last-state.json'
$AlertLog = Join-Path $Dir 'alerts.log'
$RunLog = Join-Path $Dir 'watchdog.log'

function Log($line) {
    $entry = "{0} {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $line
    Add-Content -LiteralPath $RunLog -Value $entry -Encoding UTF8
    if ((Get-Item $RunLog -ErrorAction SilentlyContinue).Length -gt 1MB) {
        $tail = Get-Content $RunLog -Tail 400
        Set-Content -LiteralPath "$RunLog.tmp" -Value $tail -Encoding UTF8
        Move-Item -LiteralPath "$RunLog.tmp" -Destination $RunLog -Force
    }
}
function Raise($kind, $signature, $detail) {
    $prev = $null
    if (Test-Path $StateFile) { $prev = Get-Content $StateFile -Raw | ConvertFrom-Json }
    $changed = -not $prev -or $prev.alertKind -ne $kind -or $prev.signature -ne $signature
    $state = if ($prev) { $prev } else { @{ failedRestarts = 0 } }
    $state | Add-Member -Force -NotePropertyMembers @{
        alertKind = $kind; signature = $signature; alertedAt = (Get-Date).ToString('o') }
    Set-Content $StateFile ($state | ConvertTo-Json -Compress) -Encoding UTF8
    if ($changed) {
        Add-Content $AlertLog ("{0} ALERT [{1}] {2} :: {3}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'),
            $kind, $signature, ($detail -replace "`r?`n", ' | ')) -Encoding UTF8
        Log "ALERT raised [$kind] $signature"
    } else { Log "alert persists, not repeated [$kind] $signature" }
}
function Resolve-Alert($reason) {
    if (-not (Test-Path $StateFile)) { return }
    $prev = Get-Content $StateFile -Raw | ConvertFrom-Json
    if ($prev.alertKind) {
        Add-Content $AlertLog ("{0} RESOLVED [{1}] {2}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'),
            $prev.alertKind, $reason) -Encoding UTF8
        Log "RESOLVED: $reason"
    }
    Set-Content $StateFile (@{ failedRestarts = 0 } | ConvertTo-Json -Compress) -Encoding UTF8
}

$out = & $Cmd status 2>&1
$code = $LASTEXITCODE
$json = ($out | Out-String)

switch ($code) {
    0 {
        Resolve-Alert 'status exit 0'
        Log 'ok'
    }
    1 {
        $state = @{}
        if (Test-Path $StateFile) { $state = Get-Content $StateFile -Raw | ConvertFrom-Json }
        $failed = [int]$state.failedRestarts
        if ($failed -ge $MaxFailedRestarts) {
            Raise 'unresponsive' 'restarts-exhausted' "exit 1 after $failed failed restarts; auto-heal paused until a human reads this"
            Log "giving up auto-restart after $failed failures"
        } else {
            $r = & $Cmd --respect-stop restart 2>&1
            $rc = $LASTEXITCODE
            if ($rc -ne 0) {
                # A restart that returned non-zero may still be booting: give the backend a
                # grace window and re-probe before counting it as a failed restart. Counting a
                # transient health-null during startup as a "failure" inflates the give-up budget.
                Start-Sleep -Seconds 45
                & $Cmd status *> $null
                if ($LASTEXITCODE -eq 0) { $rc = 0 }
            }
            $state.failedRestarts = $failed + $(if ($rc -eq 0) { 0 } else { 1 })
            Set-Content $StateFile ($state | ConvertTo-Json -Compress) -Encoding UTF8
            if ($rc -eq 0) {
                Resolve-Alert "restart recovered (was exit 1)"
                Log "restart recovered"
            } elseif ($rc -eq 1) {
                Raise 'unresponsive' "restart-failed-$($failed+1)" (($r | Out-String))
                Log "restart still failing (attempt $($failed+1))"
            } else {
                # restart surfaced a setup/part problem instead: hand it to those branches
                Log ("restart exit ${rc}: " + (($r | Out-String) -replace "`r?`n", ' | '))
            }
        }
    }
    { $_ -eq 2 -or $_ -eq 3 } {
        $sig = ($json -replace '\d{4}-\d\d-\d\dT[\d:.]+Z', 'T' -replace '\s+', ' ' -replace '\\\\', '\')
        $hash = [BitConverter]::ToString((New-Object Security.Cryptography.SHA256Managed).ComputeHash(
            [Text.Encoding]::UTF8.GetBytes($sig))).Replace('-', '').Substring(0, 16).ToLower()
        $kind = if ($code -eq 2) { 'part-error' } else { 'setup-pending' }
        Raise $kind $hash $json
        Log "exit $code signature $hash (no restart attempted)"
    }
    default {
        Raise 'unknown-status' "exit-$code" $json
    }
}
exit 0

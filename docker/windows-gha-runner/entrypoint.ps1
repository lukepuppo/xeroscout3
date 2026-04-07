param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Command
)

$ErrorActionPreference = "Stop"

function Invoke-CommandArray {
    param([string[]]$Args)

    if (-not $Args -or $Args.Count -eq 0) {
        return
    }

    if ($Args.Count -eq 1) {
        & $Args[0]
    }
    else {
        $rest = $Args[1..($Args.Count - 1)]
        & $Args[0] @rest
    }

    exit $LASTEXITCODE
}

if ($env:RUN_SMOKE_TEST -eq "1") {
    & C:\image-tools\smoke-test.ps1
    exit $LASTEXITCODE
}

if ($env:RUN_LOCAL_BUILD -eq "1") {
    & C:\image-tools\local-build.ps1
    exit $LASTEXITCODE
}

if ($Command.Count -gt 0) {
    Invoke-CommandArray -Args $Command
}

if (-not $env:RUNNER_URL -or -not $env:RUNNER_TOKEN) {
    Write-Host "Runner not configured. Set RUNNER_URL and RUNNER_TOKEN, or pass a command, or set RUN_SMOKE_TEST=1."
    Start-Sleep -Seconds 3600
    exit 0
}

Set-Location $env:RUNNER_ROOT

$runnerName = if ($env:RUNNER_NAME) { $env:RUNNER_NAME } else { "windows-docker-$env:COMPUTERNAME" }
$runnerLabels = if ($env:RUNNER_LABELS) { $env:RUNNER_LABELS } else { "self-hosted,windows,docker" }

& .\config.cmd `
    --unattended `
    --replace `
    --ephemeral `
    --name $runnerName `
    --work $env:RUNNER_WORKDIR `
    --labels $runnerLabels `
    --url $env:RUNNER_URL `
    --token $env:RUNNER_TOKEN

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

& .\run.cmd
exit $LASTEXITCODE

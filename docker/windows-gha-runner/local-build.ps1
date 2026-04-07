$ErrorActionPreference = "Stop"

$repoMount = if ($env:REPO_MOUNT) { $env:REPO_MOUNT } else { "C:\host-repo" }
$artifactMount = if ($env:ARTIFACT_MOUNT) { $env:ARTIFACT_MOUNT } else { "C:\artifacts" }
$workspaceRoot = "C:\workspace"
$workspaceRepo = Join-Path $workspaceRoot "repo"
$mainDir = Join-Path $workspaceRepo "main"
$rendererDir = Join-Path $workspaceRepo "renderer"
$gitBash = "C:\PortableGit\bin\bash.exe"
$installerScript = Join-Path $mainDir "installer\xeroscout_luke.iss"

if (-not (Test-Path $repoMount)) {
    throw "Repository mount not found: $repoMount"
}

New-Item -ItemType Directory -Path $workspaceRoot -Force | Out-Null
New-Item -ItemType Directory -Path $artifactMount -Force | Out-Null

if (Test-Path $workspaceRepo) {
    Remove-Item $workspaceRepo -Recurse -Force
}

Write-Host "Copying repository into container workspace..."
robocopy $repoMount $workspaceRepo /MIR /XD .git .github node_modules out dist installer\Output | Out-Null
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) {
    throw "robocopy failed with exit code $robocopyExit"
}

Write-Host "Rewriting installer source directory for container workspace..."
$installerLines = Get-Content $installerScript
$updatedInstallerLines = foreach ($line in $installerLines) {
    if ($line -like '#define MyAppSourceDir *') {
        '#define MyAppSourceDir "C:\workspace\repo\main"'
    }
    else {
        $line
    }
}
Set-Content -Path $installerScript -Value $updatedInstallerLines -Encoding ASCII
Get-Content $installerScript | Select-String -Pattern 'MyAppSourceDir'

Write-Host "Installing renderer dependencies..."
Set-Location $rendererDir
npm ci
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Installing main dependencies..."
Set-Location $mainDir
npm ci
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Running build_luke.sh inside Git Bash..."
& $gitBash -lc "cd /c/workspace/repo/main && ./build_luke.sh"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$installerExe = Get-ChildItem -Path $mainDir\installer -Filter *.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installerExe) {
    throw "No installer exe found in $mainDir\installer"
}

$squirrelExe = Get-ChildItem -Path $mainDir\out\make\squirrel.windows\x64 -Filter *.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1

Copy-Item $installerExe.FullName -Destination (Join-Path $artifactMount $installerExe.Name) -Force
if ($squirrelExe) {
    Copy-Item $squirrelExe.FullName -Destination (Join-Path $artifactMount $squirrelExe.Name) -Force
}

Write-Host "Build completed."
Write-Host "Exported installer: $($installerExe.Name)"
if ($squirrelExe) {
    Write-Host "Exported squirrel installer: $($squirrelExe.Name)"
}

Get-ChildItem $artifactMount | Select-Object Name, Length, LastWriteTime

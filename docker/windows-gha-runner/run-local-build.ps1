$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$artifactDir = Join-Path $PSScriptRoot "artifacts"
$imageName = "xeroscout/windows-gha-runner-test"

New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

docker build -t $imageName $PSScriptRoot
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

docker run --rm `
    -e RUN_LOCAL_BUILD=1 `
    -e REPO_MOUNT=C:\host-repo `
    -e ARTIFACT_MOUNT=C:\artifacts `
    -v "${repoRoot}:C:\host-repo" `
    -v "${artifactDir}:C:\artifacts" `
    $imageName

exit $LASTEXITCODE

$ErrorActionPreference = "Stop"

$root = "C:\smoke-test"
$appDir = Join-Path $root "app"
$releaseDir = Join-Path $root "releases"

if (Test-Path $root) {
    Remove-Item $root -Recurse -Force
}

New-Item -ItemType Directory -Path $appDir -Force | Out-Null

@"
{
  "name": "windows-gha-runner-smoke",
  "private": true,
  "version": "1.0.0",
  "description": "Throwaway smoke test for Electron Squirrel packaging in the Windows GitHub Actions runner image.",
  "devDependencies": {
    "electron": "36.3.2",
    "electron-packager": "17.1.2",
    "electron-winstaller": "5.4.0"
  }
}
"@ | Set-Content -Path (Join-Path $root "package.json") -Encoding ASCII

@"
{
  "name": "smoke-test-app",
  "productName": "SmokeTestApp",
  "description": "Smoke test app for Windows container packaging.",
  "author": "SmokeTest",
  "version": "1.0.0",
  "main": "main.js"
}
"@ | Set-Content -Path (Join-Path $appDir "package.json") -Encoding ASCII

@"
const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({ width: 640, height: 480, show: false });
  win.loadURL('data:text/html,<h1>SmokeTestApp</h1>');
}

app.whenReady().then(createWindow);
"@ | Set-Content -Path (Join-Path $appDir "main.js") -Encoding ASCII

@"
const { createWindowsInstaller } = require('electron-winstaller');

createWindowsInstaller({
  appDirectory: 'out\\SmokeTestApp-win32-x64',
  outputDirectory: 'releases',
  authors: 'SmokeTest',
  exe: 'SmokeTestApp.exe',
  setupExe: 'SmokeTestAppSetup.exe',
  noMsi: true
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
"@ | Set-Content -Path (Join-Path $root "build-squirrel.js") -Encoding ASCII

Set-Location $root

npm install
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

npx electron-packager app SmokeTestApp --platform=win32 --arch=x64 --out=out --overwrite
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

node .\build-squirrel.js
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$setupExe = Join-Path $releaseDir "SmokeTestAppSetup.exe"
$releasesFile = Join-Path $releaseDir "RELEASES"

if (-not (Test-Path $setupExe)) {
    throw "Expected Squirrel setup executable was not created: $setupExe"
}

if (-not (Test-Path $releasesFile)) {
    throw "Expected Squirrel RELEASES metadata file was not created: $releasesFile"
}

Write-Host "Smoke test succeeded."
Write-Host "Generated artifacts:"
Get-ChildItem $releaseDir | Select-Object Name, Length


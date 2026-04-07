# Windows GitHub Actions Runner Container

This directory contains a Windows container image for a self-hosted GitHub Actions runner with:

- the GitHub Actions runner binaries
- Node.js
- MinGit
- PortableGit with Bash
- Inno Setup
- a throwaway Electron + Squirrel smoke test
- a local build harness for this repository

## Purpose

This image is intended to verify that a Windows container host can:

- start a GitHub Actions runner container
- run Windows Node-based packaging workloads
- generate Squirrel Windows installer artifacts

## Build

Run from the repository root:

```powershell
docker build -t xeroscout/windows-gha-runner-test docker/windows-gha-runner
```

## Smoke Test

This does not build anything from the repository. It creates a temporary Electron app in `C:\smoke-test` inside the container and generates a Squirrel installer.

```powershell
docker run --rm -e RUN_SMOKE_TEST=1 xeroscout/windows-gha-runner-test
```

Expected success signals:

- `Smoke test succeeded.`
- a generated `SmokeTestAppSetup.exe`
- a generated `RELEASES` file

## Local Build Harness

This runs the repository's Windows build path inside the container without registering against GitHub. It:

- copies the repo into the container
- runs `npm ci` in `renderer` and `main`
- runs `main/build_luke.sh` under Git Bash
- copies the produced `.exe` installer artifacts back to `docker/windows-gha-runner/artifacts`

Run from the repository root:

```powershell
.\docker\windows-gha-runner\run-local-build.ps1
```

## Run As A GitHub Runner

Set the runner URL and a registration token:

```powershell
docker run --rm `
  -e RUNNER_URL=https://github.com/<owner>/<repo> `
  -e RUNNER_TOKEN=<registration-token> `
  -e RUNNER_NAME=windows-docker-runner `
  -e RUNNER_LABELS=self-hosted,windows,docker `
  xeroscout/windows-gha-runner-test
```

Notes:

- the container configures the runner as `--ephemeral`
- if you want a persistent runner, change the entrypoint logic before using it for production
- production use will likely need mounted work directories and more build tools than this smoke-test image includes

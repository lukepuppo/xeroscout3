# escape=`
FROM mcr.microsoft.com/windows/servercore:ltsc2022

SHELL ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

ARG RUNNER_VERSION=2.328.0
ARG NODE_VERSION=22.14.0
ARG MINGIT_VERSION=2.51.0
ARG PORTABLEGIT_VERSION=2.51.0
ARG INNOSETUP_VERSION=6.5.4

ENV RUNNER_VERSION=$RUNNER_VERSION `
    NODE_VERSION=$NODE_VERSION `
    MINGIT_VERSION=$MINGIT_VERSION `
    PORTABLEGIT_VERSION=$PORTABLEGIT_VERSION `
    INNOSETUP_VERSION=$INNOSETUP_VERSION `
    RUNNER_ROOT=C:\actions-runner `
    RUNNER_WORKDIR=_work `
    RUNNER_ALLOW_RUNASROOT=1 `
    GIT_CONFIG_NOSYSTEM=1

WORKDIR C:\

RUN $ErrorActionPreference = 'Stop'; `
    New-Item -ItemType Directory -Path C:\downloads -Force | Out-Null; `
    New-Item -ItemType Directory -Path C:\image-tools -Force | Out-Null; `
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; `
    Invoke-WebRequest -Uri ('https://github.com/actions/runner/releases/download/v{0}/actions-runner-win-x64-{0}.zip' -f $env:RUNNER_VERSION) -OutFile C:\downloads\actions-runner.zip; `
    Expand-Archive -Path C:\downloads\actions-runner.zip -DestinationPath $env:RUNNER_ROOT; `
    Invoke-WebRequest -Uri ('https://nodejs.org/dist/v{0}/node-v{0}-win-x64.zip' -f $env:NODE_VERSION) -OutFile C:\downloads\node.zip; `
    Expand-Archive -Path C:\downloads\node.zip -DestinationPath C:\downloads\node; `
    Move-Item -Path ('C:\downloads\node\node-v{0}-win-x64' -f $env:NODE_VERSION) -Destination C:\node; `
    Invoke-WebRequest -Uri ('https://github.com/git-for-windows/git/releases/download/v{0}.windows.1/MinGit-{0}-64-bit.zip' -f $env:MINGIT_VERSION) -OutFile C:\downloads\mingit.zip; `
    Expand-Archive -Path C:\downloads\mingit.zip -DestinationPath C:\mingit; `
    Invoke-WebRequest -Uri ('https://github.com/git-for-windows/git/releases/download/v{0}.windows.1/PortableGit-{0}-64-bit.7z.exe' -f $env:PORTABLEGIT_VERSION) -OutFile C:\downloads\portablegit.exe; `
    Start-Process -FilePath C:\downloads\portablegit.exe -ArgumentList '-oC:\PortableGit', '-y' -Wait -NoNewWindow; `
    Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile C:\downloads\innosetup.exe; `
    Start-Process -FilePath C:\downloads\innosetup.exe -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-' -Wait -NoNewWindow; `
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine'); `
    [Environment]::SetEnvironmentVariable('Path', ('C:\node;C:\mingit\cmd;C:\PortableGit\cmd;C:\PortableGit\bin;C:\image-tools;' + $machinePath), 'Machine'); `
    Remove-Item -Path C:\downloads -Recurse -Force

COPY entrypoint.ps1 C:\image-tools\entrypoint.ps1
COPY local-build.ps1 C:\image-tools\local-build.ps1
COPY smoke-test.ps1 C:\image-tools\smoke-test.ps1

ENTRYPOINT ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\image-tools\\entrypoint.ps1"]

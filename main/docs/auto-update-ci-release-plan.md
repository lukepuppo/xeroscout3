# XeroScout Automated Windows Builds and In-App Update Plan

## Summary

This document describes a new deployment feature for XeroScout:

- every merge to the `development` branch triggers an automated Windows build
- the build publishes Windows release artifacts to GitHub Releases
- the installed application can check for updates and install a newer release without manual USB or Google Drive transfer

This plan is written for the current repository layout and build system:

- Electron application in [`main/`](G:\programming\xeroscout3\main)
- renderer build in [`renderer/`](G:\programming\xeroscout3\renderer)
- Electron Forge packaging in [`main/forge.config.js`](G:\programming\xeroscout3\main\forge.config.js)
- current manual Windows build script in [`main/build_luke.sh`](G:\programming\xeroscout3\main\build_luke.sh)
- additional Inno Setup installer in [`main/installer/xeroscout_luke.iss`](G:\programming\xeroscout3\main\installer\xeroscout_luke.iss)

## Goals

The feature should remove the current manual distribution flow:

1. build locally with `build_luke.sh`
2. locate the generated `.exe`
3. upload it manually
4. download it elsewhere
5. copy it to a flash drive
6. distribute it by hand

The replacement flow should be:

1. merge to `development`
2. GitHub Actions builds the Windows release automatically
3. the release artifacts are published to GitHub Releases
4. the running app checks for an update
5. the app downloads and installs the update

## Recommended Architecture

### Build and release

Use a self-hosted Windows GitHub Actions runner.

Why:

- this project produces a Windows `.exe`
- it already depends on Windows-only tooling such as Inno Setup
- Windows packaging is simplest and most reliable on a Windows host

### Artifact hosting

Use GitHub Releases as the release source.

Why:

- builds can attach release assets directly to the repository
- the update source and code source stay in the same place
- release history is visible and auditable

### App update mechanism

Use Electron auto-update support for Windows release artifacts rather than the custom flash-drive workflow.

For this repository, the best fit is to make the app update from the Windows packaging output generated for Electron, not from the custom Inno installer alone.

Important constraint:

- Windows auto-update usually works best when the app is installed from the Electron Windows packaging/update format and the updater consumes the corresponding release metadata

### Packaging strategy note

There are two reasonable packaging directions for this repository.

Option 1:

- keep Electron Forge and adapt the existing Windows packaging and update path

Option 2:

- migrate later to a packaging flow built around a single installer and updater stack

For this project, the recommended starting point is still Option 1 because it is the smaller change from the current repository state. The application already uses Electron Forge and already has Windows packaging configured.

However, the current dual-installer setup has real maintenance cost:

- manual installer and auto-update packaging can diverge
- there are more moving parts to maintain
- versioning and user experience can become inconsistent
- separate installer technologies can target different install locations and create conflicting side-by-side installs on Windows

If the updater work becomes awkward under the current setup, a later migration to a single installer and updater path may be justified. That should be treated as a deliberate packaging refactor, not as a prerequisite for the first automation rollout.

Important Squirrel-specific implementation detail:

- if the Windows updater path continues to use Squirrel, the app must handle Squirrel startup events during install, update, and uninstall
- otherwise the app can launch multiple visible instances during install or update flows

Recommended implementation:

- add `electron-squirrel-startup` near the top of the main process entrypoint
- if it reports a Squirrel startup event, quit immediately and let the installer complete its work

Recommended packaging decision for this repo:

- if Squirrel remains the Windows update path, retire the custom Inno Setup installer for end-user distribution
- use the Squirrel-generated installer as both the normal installer and the offline fallback installer

This avoids split-brain installs where one installer writes to one Windows location and the updater writes to another.

## Important Recommendation About Docker

You mentioned a Windows machine with Docker and WSL2 support.

That machine can host the automation, but Docker is not the right primary tool for the Windows build in this case.

Use a native Windows self-hosted runner process on the Windows machine, not a Linux container in WSL2, because:

- the build creates a Windows desktop application
- packaging and installer generation are Windows-specific
- Inno Setup runs on Windows
- Electron Windows release generation is simpler on Windows directly

Docker or WSL2 can still be useful for unrelated services, but the release runner for this repository should be native Windows.

## Security and Runner Hardening

The self-hosted Windows runner should be treated as a build appliance, not as a general workstation.

Recommended controls:

- only run the release workflow on trusted branches such as `development` and `main`
- do not allow unreviewed pull requests from outside contributors to execute on the self-hosted runner
- prefer branch protection and required review before code can reach branches that trigger the runner
- run the runner under a dedicated low-privilege Windows account
- keep GitHub Actions secrets scoped to the environments and branches that actually need them

Important risk:

- a persistent self-hosted runner can accumulate build state between runs
- if the repository is public, any workflow that allows untrusted code to run on the runner is a serious security problem

The workflow should include explicit cleanup at the end of every run so the next build starts from a known state.

Recommended cleanup targets:

- repository workspace contents generated during the build
- `main/out`
- `main/dist`
- temporary packaging directories

Optional additional cleanup:

- `main/node_modules`
- `renderer/node_modules`

The optional `node_modules` cleanup is safer but slower. At minimum, generated build output should always be removed.

## High-Level Feature Design

The feature has two major parts.

### Part 1: Automated build and release pipeline

When code is merged into `development`:

- GitHub Actions runs on the self-hosted Windows runner
- dependencies are installed
- the renderer and main process are built
- Windows release artifacts are generated
- a GitHub Release is created or updated
- the generated installer and update assets are uploaded

### Part 2: In-app update flow

Inside XeroScout:

- the app can check GitHub Releases for a newer version
- the user can click `Check for updates`
- the app downloads the update
- the app prompts to restart and install

Optional later enhancement:

- automatic background check on app launch
- silent download with a notification when ready to install

## Current Repo State and What It Means

### Current build script

[`main/build_luke.sh`](G:\programming\xeroscout3\main\build_luke.sh) currently:

- deletes `out` and `dist`
- increments the patch version in `main/package.json`
- updates the version in `installer/xeroscout_luke.iss`
- runs `npm run main`
- runs `npm run make`
- runs Inno Setup manually

This is workable for local packaging, but it is not ideal as-is for CI because:

- CI should not mutate source-controlled version files in-place unless the workflow is designed around committing those changes
- CI versioning should be deterministic from tags, release numbers, or workflow inputs
- auto-update should use a stable release versioning rule

### Current Forge configuration

[`main/forge.config.js`](G:\programming\xeroscout3\main\forge.config.js) already includes:

- `@electron-forge/maker-squirrel`

That is a strong signal that this repo is already close to a Windows auto-update-capable packaging model.

### Current app code

[`main/src/main.ts`](G:\programming\xeroscout3\main\src\main.ts) does not currently integrate an updater. There is no existing `autoUpdater` setup, update IPC, or renderer button handling for application updates.

## Proposed Implementation Plan

## Phase 1: Prepare release packaging for CI

### Step 1: Split local-only behavior from CI behavior

Create a dedicated CI build path instead of reusing `build_luke.sh` exactly as-is.

Recommended outcome:

- keep `build_luke.sh` for local manual builds if you still want it
- add a CI-oriented script that does not auto-bump version files in the repo

Suggested new scripts:

- `main/build_ci.ps1` or `main/build_ci.sh`
- optional `main/scripts/set-version.ps1` if version is injected during CI

The CI script should:

- clean build output
- install dependencies deterministically using `npm ci`
- build renderer and main
- run packaging

It should not:

- edit tracked files unless the workflow is intentionally preparing a release commit

### Step 2: Define the release versioning strategy

Choose one version source and keep it consistent.

Recommended options:

1. Git tag driven
2. workflow input driven
3. branch build number plus semantic base version

Best production option:

- create releases from tags like `v3.0.53`
- CI reads the tag and sets the app version to `3.0.53`

Important rule:

- the app version visible to users, the packaged app version, and the GitHub Release version must all come from one source of truth

Recommended source of truth:

- the packaged application version as exposed by Electron at runtime

The workflow should set the version once and then use that same value for:

- package metadata
- release tagging or release naming
- update comparison logic
- UI display of the current version

If you want every merge to `development` to create installable builds without promoting all of them to production, use:

- branch builds for development prereleases such as `3.0.53-dev.12`
- tagged releases for production versions

Recommended stateless implementation for development prereleases:

- derive the prerelease suffix from the GitHub Actions run number
- example format: `3.0.53-beta.${{ github.run_number }}`

This avoids committing version bumps back to Git just to keep prerelease numbering sequential.

### Step 3: Decide which Windows artifacts to publish

Recommended release assets:

- Windows installer `.exe`
- Windows update packages and metadata required by the updater
- optional ZIP package for manual troubleshooting

The exact file names will depend on the final packaging configuration.

For this repository, if Squirrel is the updater path, the manual offline installer should be the same Squirrel-generated installer used for normal installs. Do not distribute the custom Inno Setup installer alongside it.

## Phase 2: Set up the self-hosted Windows runner

### Step 4: Prepare the Windows machine

Use a dedicated Windows machine or VM that stays online when merges happen.

Install:

- Git
- Node.js matching the project version requirements
- npm
- any C/C++ build tools needed by native Node modules such as `sqlite3`

Recommended machine setup:

- create a dedicated local account for the runner
- log in once and install all required software
- ensure the machine has access to the repository

### Step 5: Register a self-hosted GitHub Actions runner

On GitHub:

1. open the repository settings
2. go to `Actions` -> `Runners`
3. add a new self-hosted runner for Windows
4. follow the registration commands on the Windows machine

Recommended labels:

- `self-hosted`
- `windows`
- `x64`
- `xeroscout`

Run the runner as a Windows service so it survives logouts and restarts.

### Step 6: Validate the runner toolchain

Before building from Actions, verify manually on the runner machine:

- `node -v`
- `npm -v`
- `npm ci` succeeds in both `renderer` and `main`
- the current packaging flow works end-to-end

This step matters because the CI workflow will be unstable if the host is missing native build prerequisites.

### Step 6a: Validate branch and secret protections

Before enabling automatic releases, verify:

- only trusted branches trigger the release workflow on the self-hosted runner
- secrets are available only to the release workflow or environment that requires them
- any future pull-request workflows use GitHub-hosted runners unless there is a specific trusted reason not to

## Phase 3: Add GitHub Actions workflow

### Step 7: Create a Windows build workflow

Add a workflow file at:

- `.github/workflows/windows-development-release.yml`

Trigger rules:

- on push to `development`
- optionally on manual dispatch for testing

The workflow should:

1. check out the repository
2. set up Node
3. install dependencies in `renderer` using `npm ci`
4. install dependencies in `main` using `npm ci`
5. set the release version
6. build the application
7. package Windows artifacts
8. create or update a GitHub Release
9. upload artifacts

Recommended workflow behavior:

- branch merges to `development` create prereleases
- tagged builds create full releases

Recommended workflow safety behavior:

- do not trigger the release job on pull requests from forks
- clean generated artifacts and temporary state at the end of the workflow
- fail the workflow if the computed release version and packaged app version do not match
- use GitHub Actions `concurrency` so a newer push to the same branch cancels the older in-progress build instead of wasting runner time on obsolete commits

Cleanup implementation note:

- the cleanup step in GitHub Actions should use `if: always()` so it still runs when earlier build, package, or upload steps fail

### Step 8: Store secrets

If needed, configure:

- `GITHUB_TOKEN` for creating releases
- code-signing credentials later if signing is added

For public releases, `GITHUB_TOKEN` is often enough for workflow-side publishing.

## Phase 4: Add app-side update support

### Step 9: Add an updater library

Add an updater integration that supports Windows packaged app updates.

This will require changes in the main Electron process, likely centered around:

- [`main/src/main.ts`](G:\programming\xeroscout3\main\src\main.ts)
- [`main/src/main/preload.ts`](G:\programming\xeroscout3\main\src\main\preload.ts)
- relevant renderer-side UI files for settings or menu actions

Core updater responsibilities:

- check current app version
- query the release source
- compare versions
- download the update
- notify the user
- restart and install

Security note:

- keep updater control in the main process
- do not let renderer code construct arbitrary update URLs or invoke unrestricted IPC channels

### Step 10: Add IPC for update operations

Add IPC messages for:

- check for updates
- start download
- get current update status
- restart to install

Suggested status states:

- idle
- checking
- update-available
- no-update
- downloading
- downloaded
- error

IPC hardening requirements:

- keep `contextIsolation: true`
- keep `nodeIntegration: false`
- expose a narrow, typed preload API for updater operations rather than exposing generic `ipcRenderer.send()` or `ipcRenderer.invoke()` access
- namespace update IPC channels clearly, for example `updater:check`, `updater:status`, and `updater:install`

### Step 11: Add a UI entry point

Add one or both of the following:

- a menu item under `Help` or `File` called `Check for updates`
- a button in a settings/info screen

Recommended initial UX:

- user clicks `Check for updates`
- app shows status
- if update exists, app downloads it
- when complete, app explains that the update is staged and will be applied on restart
- offer actions such as `Restart now` and `Later`

### Step 12: Handle install timing safely

The app should not force shutdown in the middle of scouting work.

Recommended behavior:

- download in background
- prompt before restart
- let the user delay the restart until a safe moment
- make it clear in the UI that once the update is staged it will install on the next app restart

This matters because XeroScout appears to manage live event and data workflows. An update flow must not interrupt active use unexpectedly.

### Step 13: Back up local data before install

Before the app quits to apply an update, create a local backup of user data that could be hard to reconstruct.

At minimum, back up:

- SQLite databases
- configuration files
- any event data or cached project state required for a live competition workflow

Recommended behavior:

- create a timestamped backup in a known backup directory
- keep a small rolling history of backups
- surface the backup location in logs or in a user-visible status message

This is especially important for this repository because field use is likely time-sensitive and recovery needs to be simple.

### Step 14: Verify update package integrity

The updater should only install artifacts that pass the update framework's integrity checks.

Implementation note:

- if the selected updater framework already validates signed metadata or hashes, rely on that mechanism rather than inventing a second parallel verifier
- if the chosen release path does not provide strong built-in verification, add explicit artifact validation before prompting the user to restart

### Step 15: Add schema version checks for rollback safety

Backups alone are not enough if a newer app version changes the SQLite schema and an older app is later launched against that updated data.

Recommended behavior:

- store a database schema version in SQLite
- on startup, compare the database schema version against the maximum schema version supported by the current app
- if the database was created or migrated by a newer app version, stop normal startup and show a clear recovery message

The recovery message should tell the user:

- this data was modified by a newer version of XeroScout
- update the app again or restore a backup
- where the backup folder is located

## Phase 5: Release channel strategy

### Option A: Single development channel

Every merge to `development` publishes the latest build, and all installed clients update from it.

Pros:

- simplest setup

Cons:

- every merge is effectively deployable to all users

### Option B: Development prerelease plus production release

Recommended.

Behavior:

- `development` branch publishes prereleases
- a tagged release or `main` branch publishes production releases
- development/test machines can opt into prereleases
- field laptops/tablets can stay on stable

This is safer if the app is used in live competition environments.

If this option is used, the application should expose the channel choice explicitly.

Recommended UI:

- `Update channel: Stable / Beta`

Recommended logic:

- `Stable` only considers non-prerelease GitHub Releases
- `Beta` can consider prereleases from the `development` branch pipeline

Without this filtering, prerelease publishing will not reliably protect stable users from development updates.

### Prerelease retention

Development prereleases should not accumulate forever.

Recommended policy:

- keep production tagged releases indefinitely
- automatically prune old development prereleases on a schedule

Reason:

- Electron release assets are large
- too many prereleases make the GitHub Releases page harder to use
- excessive retained artifacts waste storage and clutter API responses

Reasonable cleanup policies:

- keep only the most recent 5 development prereleases
- or delete development prereleases older than 14 to 30 days

## Deployment Steps

This is the recommended rollout order.

### Stage 1: Infrastructure

1. prepare the Windows runner host
2. install all build dependencies
3. register the self-hosted GitHub runner
4. verify a manual build works on that machine

### Stage 2: CI packaging

1. add the GitHub Actions workflow
2. add CI-safe build scripts
3. configure release versioning
4. run the workflow manually
5. confirm artifacts appear in GitHub Releases

### Stage 3: App updater implementation

1. add updater dependency
2. wire update logic in the Electron main process
3. expose IPC to renderer
4. add `Check for updates` UI
5. test download and restart-install flow

### Stage 4: Controlled rollout

1. install a known baseline version manually
2. publish a newer prerelease from CI
3. test in-app update on one non-critical Windows machine
4. validate application data survives the update
5. expand rollout after verification

## Detailed Code Changes Expected

The exact implementation may vary, but expect changes in these areas.

### Build and workflow files

- add `.github/workflows/windows-development-release.yml`
- add a scheduled prerelease cleanup workflow or cleanup job
- add a CI-oriented build script under [`main/`](G:\programming\xeroscout3\main)
- possibly adjust [`main/package.json`](G:\programming\xeroscout3\main\package.json)
- possibly adjust [`main/forge.config.js`](G:\programming\xeroscout3\main\forge.config.js)

### Main process

- update bootstrap code in [`main/src/main.ts`](G:\programming\xeroscout3\main\src\main.ts)
- possibly add a dedicated updater module such as `main/src/main/updater.ts`

### Preload and renderer

- expose updater IPC from [`main/src/main/preload.ts`](G:\programming\xeroscout3\main\src\main\preload.ts)
- add UI and status handling in the renderer

## Operational Considerations

### Private vs public repository

If the repository or releases are private, the updater becomes more complicated because installed clients need authenticated access to release assets.

Simplest option:

- public release assets

If releases must remain private, you will likely need:

- a token-backed download mechanism
- or a separate authenticated update server

### GitHub API rate limits

If many machines on the same shared network check GitHub Releases at the same time, unauthenticated GitHub API requests can hit rate limits.

Recommended behavior:

- handle update-check HTTP failures gracefully
- show a user-friendly message for temporary rate-limit conditions
- include a fallback instruction to retry later or use the manual USB installer path

Recommended example message:

- `Update check temporarily blocked by network rate limits. Try again in a few minutes, or update manually using the current installer.`

### Code signing

Unsigned Windows executables can trigger SmartScreen warnings.

Recommended long-term improvement:

- sign the Windows installer and update packages with a code-signing certificate

The system will still function without signing, but user trust and install experience will be worse.

### Offline environments

If some devices are not always online:

- keep a manual installer release asset available
- preserve the existing offline install path as fallback

Recommended practical fallback:

- allow a machine that has already downloaded the current installer or update package to copy that artifact to USB for offline distribution

This does not need to be a first-pass app feature. A documented manual fallback using the exact CI-produced installer is sufficient for the first rollout. A future `Export update to USB` feature is optional, not required.

For consistency, the offline fallback installer should be the same installer technology used by the updater path, not a different Windows installer stack.

### SmartScreen and unsigned binaries

If the Windows installer is not code signed, users should expect SmartScreen friction.

Recommended plan:

- document the expected SmartScreen prompt and the manual bypass steps for trusted internal installs
- keep code signing on the roadmap as a quality and trust improvement

### Data safety

The update process must preserve user data, configuration, and local databases.

Before rollout, verify:

- install over an existing version does not erase app state
- updater restart does not corrupt open files
- active session workflows can be safely resumed after update

## Testing Plan

### CI tests

Validate:

- build succeeds on every push to `development`
- GitHub Release is created
- expected assets are attached

### Packaging tests

Validate:

- fresh install works on a clean Windows machine
- upgrade install works over an older version
- app launches correctly after upgrade

### Update tests

Validate:

1. install old version
2. publish newer release
3. click `Check for updates`
4. download update
5. restart and install
6. confirm new version is running
7. confirm user data remains intact
8. confirm the pre-install backup is usable if recovery is needed
9. confirm an older app build refuses to open a database migrated by a newer build and shows the recovery message

### Offline fallback tests

Validate:

1. download the release asset on one connected machine
2. copy the exact CI-produced installer to USB
3. update a second machine with no internet access
4. confirm the offline-updated machine reaches the same version as the online machine

### Network error tests

Validate:

1. simulate or trigger an update-check failure
2. confirm the app shows a clear user-facing error instead of a raw stack trace or cryptic HTTP message
3. if possible, confirm GitHub API rate-limit responses are mapped to a helpful retry-or-USB guidance message

## Rollback Plan

If a bad build is published:

- mark the release as not recommended or remove the prerelease
- publish a corrected higher version
- if needed, reinstall from the last known-good manual installer

Do not reuse the same version number for a corrected release. Always publish a newer version.

## Final Recommendation

For this repository, the safest and most maintainable rollout is:

1. keep the current local build flow as a fallback
2. add a native Windows self-hosted GitHub Actions runner
3. add a CI-specific Windows release workflow
4. publish release artifacts to GitHub Releases
5. add an in-app updater with a manual `Check for updates` button first
6. after that is stable, consider automatic background checks

Additionally:

- harden the self-hosted runner so only trusted branch code can execute there
- keep one source of truth for app and release versioning
- back up local data before applying updates
- document the SmartScreen workaround until code signing is in place
- support stable versus beta update channels if prereleases are introduced

## Proposed Deliverables

The complete feature can be considered done when all of the following exist:

- a Windows self-hosted GitHub Actions runner registered and online
- a workflow that builds on merge to `development`
- workflow concurrency configured so obsolete in-progress branch builds are cancelled
- GitHub Releases populated automatically with Windows assets
- old development prereleases pruned automatically
- app-side update logic in the Electron main process
- renderer UI for checking and applying updates
- documented release and rollback procedure

## Suggested Implementation Order For This Repo

1. create CI-safe build scripts
2. add workflow and publish artifacts manually from one test run
3. verify the release artifact format matches the intended updater flow
4. add updater module in the Electron main process
5. add UI and IPC
6. test updates on one machine
7. move broader distribution from USB/manual installs to release-based updates

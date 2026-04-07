#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PACKAGE_JSON="package.json"
INSTALLER_ISS="installer/xeroscout_luke.iss"
CLEAN_TARGETS=(out dist)

labelstep() {
    echo '##############################################################'
    echo '##############################################################'
    echo
    echo "$1"
    echo
    echo '##############################################################'
    echo '##############################################################'
}

fail() {
    echo "ERROR: $1" >&2
    exit 1
}

remove_artifact() {
    local target="$1"

    if [[ ! -e "$target" ]]; then
        echo "No existing artifact at $target"
        return
    fi

    rm -rf -- "$target"

    if [[ -e "$target" ]]; then
        echo "Cleanup verification failed for $target. Remaining contents:" >&2
        find "$target" -mindepth 0 -maxdepth 5 -print >&2 || true
        fail "Unable to continue until $target is fully deleted"
    fi

    echo "Deleted $target"
}

read_current_version() {
    node -p "require('./package.json').version"
}

increment_patch_version() {
    local version="$1"
    local major minor patch

    IFS='.' read -r major minor patch <<< "$version"

    [[ "$major" =~ ^[0-9]+$ ]] || fail "Invalid major version in $version"
    [[ "$minor" =~ ^[0-9]+$ ]] || fail "Invalid minor version in $version"
    [[ "$patch" =~ ^[0-9]+$ ]] || fail "Invalid patch version in $version"

    echo "${major}.${minor}.$((patch + 1))"
}

update_version_files() {
    local current_version="$1"
    local next_version="$2"
    local source_dir="$3"

    CURRENT_VERSION="$current_version" NEXT_VERSION="$next_version" node -e "
const fs = require('fs');
const path = process.argv[1];
const current = process.env.CURRENT_VERSION;
const next = process.env.NEXT_VERSION;
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));

if (pkg.version !== current) {
  console.error(\`Expected \${path} version \${current}, found \${pkg.version}\`);
  process.exit(1);
}

pkg.version = next;
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
" "$PACKAGE_JSON"

    CURRENT_VERSION="$current_version" NEXT_VERSION="$next_version" node -e "
const fs = require('fs');
const path = process.argv[1];
const current = process.env.CURRENT_VERSION;
const next = process.env.NEXT_VERSION;
const versionLine = /^#define MyAppVersion \"([^\"]+)\"$/m;
const text = fs.readFileSync(path, 'utf8');
const match = text.match(versionLine);

if (!match) {
  console.error(\`Could not find MyAppVersion in \${path}\`);
  process.exit(1);
}

if (match[1] !== current) {
  console.error(\`Expected \${path} version \${current}, found \${match[1]}\`);
  process.exit(1);
}

fs.writeFileSync(path, text.replace(versionLine, \`#define MyAppVersion \"\${next}\"\`));
" "$INSTALLER_ISS"

    SOURCE_DIR="$source_dir" node -e "
const fs = require('fs');
const path = process.argv[1];
const sourceDir = process.env.SOURCE_DIR;
const sourceLine = /^#define MyAppSourceDir \"([^\"]*)\"$/m;
const text = fs.readFileSync(path, 'utf8');

if (!sourceLine.test(text)) {
  console.error(\`Could not find MyAppSourceDir in \${path}\`);
  process.exit(1);
}

fs.writeFileSync(path, text.replace(sourceLine, \`#define MyAppSourceDir \"\${sourceDir.replace(/\\\\/g, '\\\\\\\\')}\"\`));
" "$INSTALLER_ISS"

    grep -q "\"version\": \"$next_version\"" "$PACKAGE_JSON" || fail "Failed to update $PACKAGE_JSON to $next_version"
    grep -q "^#define MyAppVersion \"$next_version\"$" "$INSTALLER_ISS" || fail "Failed to update $INSTALLER_ISS to $next_version"
}

labelstep 'Removing old artifacts'
for target in "${CLEAN_TARGETS[@]}"; do
    remove_artifact "$target"
done

labelstep 'Incrementing the build version'
current_version="$(read_current_version)"
next_version="$(increment_patch_version "$current_version")"
windows_script_dir="$(cygpath -w "$SCRIPT_DIR")"
update_version_files "$current_version" "$next_version" "$windows_script_dir"
echo "Version updated: $current_version -> $next_version"

labelstep 'Compiling the application'
npm run main

labelstep 'Creating the bundled electron application'
npm run make

labelstep 'Creating the installation package'
pushd installer > /dev/null
"/c/Program Files (x86)/Inno Setup 6/iscc.exe" xeroscout_luke.iss
popd > /dev/null

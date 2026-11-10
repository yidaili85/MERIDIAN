#!/usr/bin/env bash
# MERIDIAN installer: Linux x86_64 / arm64, Node 24, no npm dependencies.
set -Eeuo pipefail
umask 077
REPOSITORY_URL=${MERIDIAN_REPOSITORY_URL:-https://github.com/yidaili85/MERIDIAN.git}
REF=${MERIDIAN_REF:-master}
INSTALL_DIR=${MERIDIAN_INSTALL_DIR:-${HOME:?}/.local/share/meridian}
SOURCE_DIR=''
START=1
usage() {
  cat <<'HELP'
Usage: bash install.sh [--dir /absolute/path] [--source /path/to/checkout]
                       [--ref branch-or-tag] [--no-start]

Installs a private Node 24 runtime when required, checks SHA256 downloads,
creates a persistent config and database directory, tests an isolated release,
and starts the store on 127.0.0.1:3000. Does not configure TLS or payments.

A local checkout is used automatically when this script is inside the project.
Otherwise Git must already have permission to clone the private repository.
Run as a normal Linux user, not root. See README for optional reboot startup.
HELP
}
while (($#)); do
  case "$1" in
    --dir|--source|--ref) (($# >= 2)) || { usage >&2; exit 2; }; case "$1" in --dir) INSTALL_DIR=$2;; --source) SOURCE_DIR=$2;; --ref) REF=$2;; esac; shift 2;;
    --no-start) START=0; shift;;
    --help|-h) usage; exit 0;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2;;
  esac
done
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }
[[ $(uname -s) == Linux ]] || fail 'Linux is required (Debian 12+ / Ubuntu 22.04+ recommended).'
[[ $EUID -ne 0 || ${MERIDIAN_ALLOW_ROOT:-0} == 1 ]] || fail 'Run as a normal deployment user. Do not run the store as root. (Override for throwaway test boxes only: MERIDIAN_ALLOW_ROOT=1 bash install.sh)'
[[ $EUID -ne 0 ]] || printf 'WARNING: running as root because MERIDIAN_ALLOW_ROOT=1. Use a dedicated user in production.\n' >&2
[[ $INSTALL_DIR == /* && $INSTALL_DIR != / && $INSTALL_DIR =~ ^/[a-zA-Z0-9._/-]+$ ]] || fail '--dir must be an absolute path without spaces or special characters.'
for tool in curl git tar xz sha256sum mktemp sed awk chmod cp mv ln readlink nohup; do
  command -v "$tool" >/dev/null || fail "Missing $tool. On Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y ca-certificates curl git tar xz-utils coreutils"
done
case $(uname -m) in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) fail 'Only Linux x86_64 and arm64 are supported.';; esac
# Only lock/install into a directory owned by the current account.
mkdir -p "$INSTALL_DIR"
[[ -O $INSTALL_DIR ]] || fail 'Install directory must belong to the current account.'
INSTALL_DIR=$(cd "$INSTALL_DIR" && pwd -P)
[[ $INSTALL_DIR != / ]] || fail 'Refusing filesystem root.'
LOCK=$INSTALL_DIR/.install-lock
mkdir "$LOCK" 2>/dev/null || fail 'Another install may be running (.install-lock exists).'
WORK=$(mktemp -d "$INSTALL_DIR/.install-XXXXXX")
cleanup() { rm -rf -- "$WORK"; rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT
trap 'printf "Installation failed at line %s; config and database have been preserved.\n" "$LINENO" >&2' ERR
mkdir -p "$INSTALL_DIR/releases" "$INSTALL_DIR/shared/data" "$INSTALL_DIR/bin" "$INSTALL_DIR/runtime"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ -z $SOURCE_DIR && -f $SCRIPT_DIR/server.js && -f $SCRIPT_DIR/payments.js && -f $SCRIPT_DIR/mailer.js ]]; then SOURCE_DIR=$SCRIPT_DIR; fi
if [[ -n $SOURCE_DIR ]]; then
  SOURCE_DIR=$(cd -- "$SOURCE_DIR" && pwd -P)
  [[ -f $SOURCE_DIR/package.json && -f $SOURCE_DIR/server.js && -f $SOURCE_DIR/payments.js && -f $SOURCE_DIR/mailer.js && -f $SOURCE_DIR/smtp.js && -f $SOURCE_DIR/countries.js && -d $SOURCE_DIR/public && -d $SOURCE_DIR/test && -f $SOURCE_DIR/scripts/meridian.sh ]] || fail 'Source is not a complete MERIDIAN checkout.'
  log 'Using local project files (data and credentials will not be copied).'
else
  log 'Cloning the repository using existing Git authentication…'
  git clone --quiet --depth 1 --branch "$REF" -- "$REPOSITORY_URL" "$WORK/source" || fail 'Git clone failed. For a private repository, authenticate Git first or clone via SSH and run install.sh from that checkout.'
  SOURCE_DIR=$WORK/source
fi
# Preserve only application files. Never transfer an existing .env or data/.
RELEASE_ID=$(date -u +%Y%m%dT%H%M%S)-$$
RELEASE=$INSTALL_DIR/releases/$RELEASE_ID
mkdir "$RELEASE"
for file in package.json server.js payments.js mailer.js smtp.js countries.js README.md .env.example; do cp -- "$SOURCE_DIR/$file" "$RELEASE/$file"; done
cp -R -- "$SOURCE_DIR/public" "$SOURCE_DIR/test" "$RELEASE/"
NODE=''
if [[ -x $INSTALL_DIR/runtime/node/bin/node ]] && "$INSTALL_DIR/runtime/node/bin/node" -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)' 2>/dev/null; then
  NODE=$INSTALL_DIR/runtime/node/bin/node
elif command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)' 2>/dev/null; then
  NODE=$(readlink -f "$(command -v node)")
else
  log 'Installing private Node.js 24 runtime (official distribution, SHA256 verified)…'
  URL=https://nodejs.org/dist/latest-v24.x
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 2 "$URL/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
  ARTIFACT=$(awk -v suffix="-linux-$ARCH.tar.xz" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$WORK/SHASUMS256.txt")
  [[ $ARTIFACT =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || fail 'Could not resolve a unique official Node 24 artifact.'
  # Download the exact version rather than a moving latest URL.
  VERSION=${ARTIFACT#node-}; VERSION=${VERSION%-linux-*}
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 2 "https://nodejs.org/dist/$VERSION/$ARTIFACT" -o "$WORK/$ARTIFACT"
  (cd "$WORK" && awk -v f="$ARTIFACT" '$2==f {print}' SHASUMS256.txt | sha256sum --check --status) || fail 'Node archive checksum mismatch.'
  mkdir "$WORK/node"
  tar -xJf "$WORK/$ARTIFACT" -C "$WORK/node" --strip-components=1
  "$WORK/node/bin/node" -e 'require("node:sqlite")' || fail 'Node cannot run on this Linux distribution (glibc is required).'
  # Preserve the managed runtime if an older release is still using it.
  RUNTIME=$INSTALL_DIR/runtime/$VERSION-linux-$ARCH
  [[ ! -e $RUNTIME ]] || fail 'Runtime directory already exists; inspect it before retrying.'
  mv -- "$WORK/node" "$RUNTIME"
  ln -s "$RUNTIME" "$INSTALL_DIR/runtime/.node-$$"
  mv -Tf "$INSTALL_DIR/runtime/.node-$$" "$INSTALL_DIR/runtime/node"
  NODE=$INSTALL_DIR/runtime/node/bin/node
fi
"$NODE" -e 'require("node:sqlite")' || fail 'Node 24+ with built-in SQLite support is required.'
log 'Running repository tests with isolated test databases…'
(cd "$RELEASE" && MERIDIAN_INSTALLER_NESTED=1 "$NODE" --test)
CONFIG=$INSTALL_DIR/shared/config.env
if [[ ! -e $CONFIG ]]; then
  PASSWORD=$("$NODE" -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')
  cat > "$CONFIG" <<CONFIG
# Keep private. Not a shell script; loaded by Node --env-file.
HOST=127.0.0.1
PORT=3000
ADMIN_PASSWORD=$PASSWORD
COOKIE_SECURE=false
# PUBLIC_BASE_URL=https://shop.example.com
# PAYPAL_CLIENT_ID=
# PAYPAL_CLIENT_SECRET=
# PAYPAL_WEBHOOK_ID=
CONFIG
  unset PASSWORD
  log 'Generated a persistent administrator password in shared/config.env (not printed).'
else
  log 'Existing configuration preserved.'
fi
chmod 600 "$CONFIG"
# The installed manager uses its own runtime and persistent paths.
cp -- "$SOURCE_DIR/scripts/meridian.sh" "$INSTALL_DIR/bin/meridian.new"
chmod 700 "$INSTALL_DIR/bin/meridian.new"
mv -f -- "$INSTALL_DIR/bin/meridian.new" "$INSTALL_DIR/bin/meridian"
printf '%s\n' "$NODE" > "$INSTALL_DIR/runtime-path"
OLD_RELEASE=$(readlink "$INSTALL_DIR/current" 2>/dev/null || true)
ln -s "$RELEASE" "$INSTALL_DIR/.current-$$"
mv -Tf "$INSTALL_DIR/.current-$$" "$INSTALL_DIR/current"
if ((START)); then
  if ! "$INSTALL_DIR/bin/meridian" restart; then
    log 'New release did not become healthy. Restoring the previous release if present.'
    if [[ -n $OLD_RELEASE ]]; then
      ln -s "$OLD_RELEASE" "$INSTALL_DIR/.current-rollback-$$"
      mv -Tf "$INSTALL_DIR/.current-rollback-$$" "$INSTALL_DIR/current"
      "$INSTALL_DIR/bin/meridian" start || true
    fi
    fail 'Startup failed. See shared/server.log; no config or database was deleted.'
  fi
fi
log "Installed: $INSTALL_DIR"
log "Manage:    $INSTALL_DIR/bin/meridian {start|stop|restart|status|logs|run}"
log "Config:    $CONFIG"
log 'Read ADMIN_PASSWORD in your local configuration to sign in at /admin.'
log 'Payments remain disabled until configured. Public access requires your own HTTPS reverse proxy.'

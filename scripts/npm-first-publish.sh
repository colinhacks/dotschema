#!/usr/bin/env bash
# Run by the maintainer in a terminal before dotschema's first release: point the npm trusted publisher
# of `dotschema` at .github/workflows/release.yml, so that workflow can stage it (DESIGN.md,
# "Releasing"). Motherload's scripts/npm-first-publish.sh, for one package that npm already holds.
#
#   bash scripts/npm-first-publish.sh
#
# npm's trusted publishing cannot make a package's first publish: a trusted publisher can be configured
# only on a package that exists (`npm help trust`: "Package must exist"). `dotschema` exists, a 0.0.0
# placeholder the maintainer published on 2026-10-03, so this script publishes nothing; it stops if the
# package is missing. It trusts release.yml in colinhacks/dotschema, on its `npm` environment, for
# `npm stage publish` alone. The workflow can then fill npm's staged queue and nothing else; a version
# is served only once the maintainer approves it with 2FA (`stager`).
#
# The npm login is made for this run alone: npm's browser login, saved to a private file rather than
# ~/.npmrc, logged out and deleted when the script exits. One authenticator code serves every command
# while npm accepts it; when npm refuses it as expired, the script asks for the next one and carries on.
# Safe to run again: a trust already in place is checked, not created.
set -euo pipefail

repo=colinhacks/dotschema
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

v="$(npm --version)"
[ "$(printf '%s\n11.15.0\n' "$v" | sort -V | head -1)" = "11.15.0" ] || { echo "npm $v cannot configure a stage-only trusted publisher (need >= 11.15)"; exit 1; }

name="$(nub --node -p "require('$root/package.json').name")"

# Read without a login, before one is made: a package that does not exist cannot be trusted, and publishing it is not this script's to do.
if [ -z "$(npm view "$name" version 2>/dev/null)" ]; then
  echo "$name is not on npm, and a trusted publisher needs a package that exists; publish a 0.0.0 placeholder first (Motherload's scripts/npm-first-publish.sh shows how)."
  exit 1
fi
echo "✓ $name exists"

work="$(mktemp -d)"
cfg="$work/npmrc"
last="$work/last"
touch "$cfg"
chmod 600 "$cfg"
# Every npm command below reads and writes its login there. Through the environment, not --userconfig:
# `npm trust` accepts only its own flags, and reads `--userconfig <path>` as a stray positional argument.
export NPM_CONFIG_USERCONFIG="$cfg"
cleanup() {
  if grep -q '_authToken' "$cfg" 2>/dev/null; then
    npm logout > /dev/null 2>&1 && echo "logged out of npm" || echo "npm logout failed; revoke this machine's newest token at https://www.npmjs.com/settings/~/tokens"
  fi
  rm -rf "$work"
}
trap cleanup EXIT

echo "Sign in to npm in the browser (the login lasts for this run only):"
npm login --auth-type=web
user="$(npm whoami)"
echo "signed in as $user"

code=""
refused=0
# Runs an npm command that needs the account's 2FA with the last code given, its output in $last. When npm
# refuses the code, it asks for the next one and runs the command again; a refused code is never sent twice,
# and three refusals in a row stop the script rather than risk npm's rate limit on codes.
npm2fa() {
  while :; do
    if [ -z "$code" ]; then
      read -rsp "One-time code from the authenticator for $user: " code < /dev/tty
      echo
    fi
    if npm "$@" --otp="$code" < /dev/null > "$last" 2>&1; then refused=0; return 0; fi
    if grep -qiE 'EOTP|one-time pass' "$last"; then
      refused=$((refused + 1))
      [ "$refused" -lt 3 ] || { cat "$last"; echo "npm refused three codes in a row; stopping."; exit 1; }
      echo "npm refused that code (expired); enter the next one."
      code=""
      continue
    fi
    return 1
  done
}

# The package's trusted publisher is release.yml in colinhacks/dotschema, on its `npm` environment.
trusted() {
  npm2fa trust list "$1" --json || return 1
  grep -q "\"repository\": \"$repo\"" "$last" && grep -q '"file": "release.yml"' "$last" && grep -q '"environment": "npm"' "$last"
}

if trusted "$name"; then
  echo "✓ $name trusts $repo release.yml on the npm environment"
  exit 0
fi
echo "→ trusting $repo release.yml, environment npm, stage-only, for $name"
# Stage-only: --allow-publish would let a stolen push credential publish directly, which is how nub's unauthorized v0.9.4 shipped.
if ! npm2fa trust github "$name" --file release.yml --repo "$repo" --env npm --allow-stage-publish -y; then
  cat "$last"
  echo "trusting $name failed. npm keeps one trusted publisher per package: if one is already configured, read its id with \`npm trust list $name\`, revoke it with \`npm trust revoke $name --id <id>\`, and run this again."
  exit 1
fi
# npm's docs ask for a pause between trust calls, to stay under its rate limit
sleep 2
trusted "$name" || { cat "$last"; echo "$name does not trust $repo release.yml on the npm environment after the command; inspect it with \`npm trust list $name\`"; exit 1; }
echo "done: $name trusts $repo release.yml on the npm environment"

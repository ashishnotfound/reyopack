#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stage_dir="$(mktemp -d /tmp/reyo-pack-native-build.XXXXXX)"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

tar \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./out' \
  --exclude='./android' \
  -cf - -C "$repo_dir" . | tar -xf - -C "$stage_dir"
cp -a "$repo_dir/node_modules" "$stage_dir/node_modules"

# Next static export cannot contain server route handlers. The native bundle
# calls Supabase Auth, RPCs, Realtime, and Edge Functions directly instead.
mv "$stage_dir/src/app/api" "$stage_dir/native-api-disabled"

(cd "$stage_dir" && REYO_NATIVE_BUILD=1 npm run build)

if [[ -e "$repo_dir/out" ]]; then
  mv "$repo_dir/out" "$stage_dir/previous-out"
fi
cp -a "$stage_dir/out" "$repo_dir/out"

#!/usr/bin/env bash
# The CI jobs of .github/workflows/ci.yml, run on this machine: for when GitHub Actions cannot run them (out of minutes, a
# billing hold, runners not assigned). Each job runs the same commands as its CI job, in the same order; keep the two in step
# when ci.yml changes.
#
#   npm run ci:local                    check, native, host, outside (and native-desktop when xvfb-run is installed)
#   npm run ci:local -- check host      only the jobs named
#
# Needs what CI installs: Node, a C toolchain and cmake (native), Rust (host, outside), and for native-desktop the X11/GL
# development libraries and xvfb (see the apt-get line in ci.yml). Stops at the first failing step and says which job it was in.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
scratch="$(mktemp -d)"

all=(check native host outside native-desktop)
jobs=("$@")
explicit=1
if [ ${#jobs[@]} -eq 0 ]; then jobs=("${all[@]}"); explicit=0; fi
for job in "${jobs[@]}"; do
  case " ${all[*]} " in *" $job "*) ;; *) echo "unknown job '$job' (jobs: ${all[*]})" >&2; exit 2 ;; esac
done

current=""
trap 'status=$?; [ $status -ne 0 ] && [ -n "$current" ] && echo "ci:local: FAILED in job '\''$current'\''" >&2; rm -rf "$scratch"' EXIT

step() { echo; echo "== [$current] $*"; }
# The packaged game runs until stopped; stopping it after five seconds (status 124) is the pass.
runs_until_stopped() { (cd "$scratch" && "$@" || test $? -eq 124); }

step_setup() {
  current=setup
  step "npm ci"; npm ci
  step "npm run generate"; npm run generate
}

job_check() {
  step "npm test"; npm test --ignore-scripts
  step "npm run typecheck"; npm run typecheck --ignore-scripts
  step "npm run bench:check"; npm run bench:check
}

job_native() {
  step "librge, headless"; npm run native:build:headless
  step "C smoke test"; ctest --test-dir native/build-headless --output-on-failure
  step "Node host against the real library"
  RGE_REQUIRE_NATIVE=1 node --test --test-concurrency=1 "packages/player-node/test/*.test.ts" "packages/demo/test/*.test.ts"
  step "package the demo with Node (V8) and run it"
  npm run package -- --engine node --headless
  npm run package -- --entry parity.ts --name parity --engine node --headless
  node packages/demo/parity.ts > "$scratch/parity-node.json"
  (cd "$scratch" && "$root/packages/demo/dist/parity/parity" > "$scratch/parity-packaged.json")
  cmp "$scratch/parity-node.json" "$scratch/parity-packaged.json"
  runs_until_stopped timeout 5 "$root/packages/demo/dist/demo/demo"
}

job_host() {
  step "Rust host, headless"; npm run host:build:headless
  step "parity with Node, and host behaviour"
  RGE_HOST_BIN="$root/host/target/release/rge-host" RGE_REQUIRE_HOST=1 node --test --test-concurrency=1 packages/demo/test/parity.test.ts
  step "package the demo and run it"
  npm run package -- --engine quickjs --headless
  runs_until_stopped timeout 5 "$root/packages/demo/dist/demo/demo"
}

job_outside() {
  step "librge, headless"; npm run native:build:headless
  step "Rust host, headless"; npm run host:build:headless
  step "check:outside"; npm run check:outside
}

job_native-desktop() {
  step "librge (OpenGL window)"; npm run native:build
  step "C smoke test"; xvfb-run -a ctest --test-dir native/build --output-on-failure
  step "Node host against the real library"
  RGE_REQUIRE_NATIVE=1 RGE_NATIVE_LIB="$root/native/build/librge.so" \
    xvfb-run -a node --test --test-concurrency=1 "packages/player-node/test/*.test.ts" "packages/demo/test/*.test.ts"
  step "Rust host (OpenGL window)"; npm run host:build
  step "package the demo (QuickJS) and run it under a virtual display"
  npm run package -- --engine quickjs
  runs_until_stopped xvfb-run -a timeout 5 "$root/packages/demo/dist/demo/demo"
  step "package the demo with Node (V8) and run it under a virtual display"
  npm run package -- --engine node
  runs_until_stopped xvfb-run -a timeout 5 "$root/packages/demo/dist/demo/demo"
}

step_setup
ran=()
skipped=()
for job in "${jobs[@]}"; do
  if [ "$job" = native-desktop ] && ! command -v xvfb-run > /dev/null; then
    if [ $explicit -eq 1 ]; then echo "native-desktop needs xvfb-run and the X11/GL libraries (see ci.yml)" >&2; exit 1; fi
    skipped+=("native-desktop (no xvfb-run)")
    continue
  fi
  current="$job"
  "job_$job"
  ran+=("$job")
done
current=""

echo
echo "ci:local: passed: ${ran[*]}"
if [ ${#skipped[@]} -gt 0 ]; then echo "ci:local: NOT run: ${skipped[*]}"; fi

#!/usr/bin/env bash
# Publishes the site to GitHub Pages (https://mbarc.github.io/circuitoon/).
# GitHub Actions is disabled on the MBarc account, so Pages serves the gh-pages branch and
# this script is the deploy: validate, check the generated modules, test, build, then force-push
# dist/ to gh-pages.
set -euo pipefail
cd "$(dirname "$0")/.."

# The site serves the simulation engine; its source release (spec 2.2) must be public first.
tag=$(node -p "require('./public/sim/engine.json').release.split('/').pop()")
if ! gh release view "$tag" -R MBarc/circuitoon >/dev/null 2>&1; then
  echo "deploy: the engine release $tag is not on MBarc/circuitoon. Publish the engine release first: npm run engine:release from the worktree that built the engine." >&2
  exit 1
fi

npm run validate
npm run check:gen
npm test
npm run build
# Older plugins pin older Pyodide releases (firmware spec 2.7): keep every published py/<version>/.
node scripts/carry-py.mjs --remote "$(git remote get-url origin)"
touch dist/.nojekyll

remote=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD)"
git push -q -f "$remote" gh-pages
echo "Deployed. Live in about a minute at https://mbarc.github.io/circuitoon/"

#!/usr/bin/env bash
# Publishes the site to GitHub Pages (https://mbarc.github.io/circuitoon/).
# GitHub Actions is disabled on the MBarc account, so Pages serves the gh-pages branch and
# this script is the deploy: validate, check the generated modules, test, build, then force-push
# dist/ to gh-pages.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run validate
npm run check:gen
npm test
npm run build
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

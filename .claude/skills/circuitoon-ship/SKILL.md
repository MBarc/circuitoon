---
name: circuitoon-ship
description: Merge a finished Circuitoon branch to main, deploy it to GitHub Pages and confirm the live site works, then record it in Michael's vault. Use this whenever Circuitoon work is reviewed and ready to go live, when Michael says merge, deploy, ship, publish or "put it live", or after any change to the Circuitoon site he should see. Michael relies on Claude to run every Circuitoon deploy.
---

# Shipping Circuitoon

GitHub Actions is disabled on the MBarc account, so there is no CI: this workflow is the only gate between a branch and the live site at https://mbarc.github.io/circuitoon/. Michael expects Claude to run it without being asked once work is reviewed, and to confirm the live site actually loads.

## Before merging
- The work passed its reviews (task reviews and a final whole-branch review for multi-part work). Parts with pinouts need an independent pinout check (see `circuitoon-add-part`).
- The branch is clean (`git status`), and nothing else is mid-flight on it. Check `git worktree list`: never switch branches inside a worktree another agent is using; do the merge from a checkout that is free.

## Steps
1. From a checkout where `main` can be checked out:
   ```bash
   git checkout main && git pull
   git merge --no-ff <branch> -m "Merge <branch>: <one line of what users get>

   Co-Authored-By: <attribution line from the session>"
   ```
2. Verify the merged result, not just the branch:
   `npm run validate && npm run check:gen && npm test && npm run build`. If anything fails, stop; nothing is pushed yet, so the merge is local and recoverable.
3. `git push`, then `npm run deploy` (validates, tests, builds and force-pushes `dist/` to `gh-pages`).
4. `node .claude/skills/circuitoon-ship/scripts/verify-live.mjs [--expect-parts N] [--shot <scratchpad>/live.png]`. It waits until the live page serves this build, then checks the start screen, the sample sheet and page errors. Read the screenshot. If the live site never picks up the build, run `gh api repos/MBarc/circuitoon/pages/builds -X POST`.
5. For a user-facing change worth seeing, reproduce the scenario Michael cares about on the live site (for example the sheet from his screenshot) and look at it.
6. Clean up: `git branch -d <branch>`, remove finished worktrees (`git worktree remove <path>`), delete the plan's SDD workspace under `.superpowers/sdd/`.
7. Record it in the vault: add a dated line under "Milestones" in `C:/Users/micha/Desktop/Claude/Projects/Circuitoon.md` (what shipped, merge SHA, anything deferred), then commit in the vault:
   ```bash
   git -C "C:/Users/micha/Desktop/Claude" add Projects/Circuitoon.md
   git -C "C:/Users/micha/Desktop/Claude" commit -m "projects: Circuitoon <what shipped>"
   ```
   Do not push the vault unless asked.

## Reporting
Lead with the live URL and what Michael can now do there. Mention anything verified on the live site, anything deferred, and any decision he may want to change. Keep it short.

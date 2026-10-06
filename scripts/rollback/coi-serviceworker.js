// Kill switch for the cross-origin isolation service worker (firmware spec 2.5). A deployed service
// worker outlives a revert, so rolling isolation back means deploying THIS file in its place:
//   cp scripts/rollback/coi-serviceworker.js public/coi-serviceworker.js && npm run deploy
// In a page (index.html still loads it as a script) it does nothing. As the service worker, the
// browser installs it as an update; it unregisters itself and reloads every page it controlled, which
// then load uncontrolled, as before isolation. Keep it next to the vendored worker's history.
// Once deployed, it must stay at that path for good: deleting the file makes the browser's update
// check fail, and browsers that had the isolating worker then keep it indefinitely. For the same
// reason a plain `git revert` of the isolation work without this file leaves returning visitors on
// the old isolating worker. With it deployed, src/isolation.test.ts skips the isolating worker's
// tests (it sees the kill switch in public/), so the deploy's `npm test` still passes.
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting())
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.registration
        .unregister()
        .then(() => self.clients.matchAll({ type: 'window' }))
        .then((clients) => Promise.all(clients.map((c) => c.navigate(c.url)))),
    )
  })
}

// Kill switch for the cross-origin isolation service worker (firmware spec 2.5). A deployed service
// worker outlives a revert, so rolling isolation back means deploying THIS file in its place:
//   cp scripts/rollback/coi-serviceworker.js public/coi-serviceworker.js && npm run deploy
// In a page (index.html still loads it as a script) it does nothing. As the service worker, the
// browser installs it as an update; it unregisters itself and reloads every page it controlled, which
// then load uncontrolled, as before isolation. Keep it next to the vendored worker's history.
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

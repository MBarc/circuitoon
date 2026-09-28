import { useEffect, useState } from 'react'
import { Landing } from './Landing.tsx'
import { EditorApp } from './editor/EditorApp.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { routeOf } from './route.ts'

// Hash routes keep deep links working on GitHub Pages, which has no server-side routing.
function useHash() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function App() {
  const hash = useHash()
  const route = routeOf(hash)
  // Keyed on the route (not the whole hash) so following a link out of the error screen starts
  // fresh, while a link payload leaving the address bar (#/editor?d=... to #/editor) keeps the open
  // editor mounted with its document.
  return <ErrorBoundary key={route}>{route.startsWith('#/editor') ? <EditorApp /> : <Landing />}</ErrorBoundary>
}

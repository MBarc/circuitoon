import { useEffect, useState } from 'react'
import { Landing } from './Landing.tsx'
import { EditorApp } from './editor/EditorApp.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

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
  // Keyed on the hash so following a link out of the error screen starts fresh.
  return <ErrorBoundary key={hash}>{hash.startsWith('#/editor') ? <EditorApp /> : <Landing />}</ErrorBoundary>
}

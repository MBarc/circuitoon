import { useEffect, useState } from 'react'
import { Landing } from './Landing.tsx'
import { Editor } from './editor/Editor.tsx'

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
  return hash.startsWith('#/editor') ? <Editor /> : <Landing />
}

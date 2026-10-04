// The colour theme switch: one icon button that cycles System, Light and Dark. The landing page
// header, the editor's start screen and its toolbar each carry one.
import { THEME_LABEL, nextChoice, useTheme } from './theme.ts'

export function ThemeSwitch() {
  const { choice, theme, setChoice } = useTheme()
  const next = nextChoice(choice)
  const now = choice === 'system' ? `System (${THEME_LABEL[theme]}, follows your device)` : THEME_LABEL[choice]
  const label = `Theme: ${now}. Switch to ${THEME_LABEL[next]}`
  return (
    <button type="button" className="theme-switch" data-theme-choice={choice} aria-label={label} title={label} onClick={() => setChoice(next)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {choice === 'light' && (
          <>
            <path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="5" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="1.8" />
          </>
        )}
        {choice === 'dark' && (
          <path d="M10.67 4.51A8.5 8.5 0 1 0 19.42 14.14A6.8 6.8 0 0 1 10.67 4.51Z" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" />
        )}
        {choice === 'system' && (
          <>
            <rect x="2.5" y="3.5" width="19" height="13" rx="2.2" fill="var(--paper)" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 5.6a4.4 4.4 0 0 0 0 8.8Z" fill="var(--yellow)" />
            <path d="M12 5.6a4.4 4.4 0 0 1 0 8.8a4.4 4.4 0 0 1 0-8.8Z" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
            <path d="M8.5 20.5h7M12 16.8v3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  )
}

import type { Severity } from '../format/checks.ts'

/**
 * A problem's severity as a small sticker, the same mark the canvas pins on the parts involved: a
 * red square with "!" for an error, a yellow hazard triangle for a warning, a green disc with a
 * check for a clean sheet.
 */
export function SeverityMark({ severity, at }: { severity: Severity | 'ok'; at?: { x: number; y: number; size: number } }) {
  return (
    <svg className={`sev-mark ${severity}`} viewBox="0 0 20 20" aria-hidden="true" x={at?.x} y={at?.y} width={at?.size} height={at?.size}>
      {severity === 'error' && (
        <>
          <rect x={2} y={2} width={16} height={16} rx={4} />
          <path d="M10 5.6v5.4" />
          <circle cx={10} cy={14.2} r={1.25} />
        </>
      )}
      {severity === 'warning' && (
        <>
          <path className="shape" d="M10 2.2 18.4 17H1.6Z" />
          <path d="M10 7.4v4.6" />
          <circle cx={10} cy={14.4} r={1.15} />
        </>
      )}
      {severity === 'ok' && (
        <>
          <circle className="shape" cx={10} cy={10} r={8} />
          <path d="m6.3 10.3 2.6 2.6 4.9-5.4" />
        </>
      )}
    </svg>
  )
}

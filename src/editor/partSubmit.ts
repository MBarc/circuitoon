// Submit to library: copy the part JSON to the clipboard and open the repo's part submission issue
// form with the name and maker filled in. GitHub fills issue form fields from URL query parameters
// named by each field's `id` (docs: "Syntax for GitHub's form schema", the `id` key), so these ids
// must match .github/ISSUE_TEMPLATE/part-submission.yml. The JSON itself goes through the clipboard:
// a part can be longer than a URL may be.
export const ISSUE_FORM = 'https://github.com/MBarc/circuitoon/issues/new'
export const SUBMIT_TEMPLATE = 'part-submission.yml'
/** Field ids in the issue form that the URL fills. */
export const FIELD_IDS = { name: 'part-name', maker: 'maker' } as const

/** The issue form URL with the title, part name and maker filled in. */
export function submissionUrl(name: string, maker?: string): string {
  const q = new URLSearchParams({ template: SUBMIT_TEMPLATE, title: `Part: ${name}`, [FIELD_IDS.name]: name })
  if (maker?.trim()) q.set(FIELD_IDS.maker, maker.trim())
  return `${ISSUE_FORM}?${q.toString()}`
}

/** Copies `text`: the async clipboard where allowed, else a hidden textarea and execCommand. True when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied (no permission or no focus): fall back below.
  }
  try {
    const ta = Object.assign(document.createElement('textarea'), { value: text })
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * Opens the issue form in a new tab, then copies the part file text. The tab opens first and
 * synchronously, inside the click: a browser opens a new tab only while the click's user activation
 * lasts, and waiting for the clipboard (a permission prompt) can use it up. `copied` says whether the
 * copy worked, so the caller can offer Copy part or Export file when it did not; `url` is the form,
 * for a link in case the tab was blocked anyway.
 */
export function submitToLibrary(text: string, name: string, maker?: string): { url: string; copied: Promise<boolean> } {
  const url = submissionUrl(name, maker)
  window.open(url, '_blank', 'noopener')
  return { url, copied: copyText(text) }
}

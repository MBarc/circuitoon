// The route of a location hash: everything before its query. "#/editor?d=..." is "#/editor", so a
// link payload and its cleanup never count as a navigation (App keys the page on this).
export function routeOf(hash: string): string {
  const q = hash.indexOf('?')
  return q < 0 ? hash : hash.slice(0, q)
}

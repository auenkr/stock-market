/** A symbol is a company URL path, never an extracted exchange ticker. */
export function validCompanyPath(path: string) {
  return /^\/company\/(?:[A-Z0-9](?:[A-Z0-9&_-]|%26)*|id\/\d+)\/(?:consolidated\/)?$/i.test(path.endsWith("/") ? path : `${path}/`);
}

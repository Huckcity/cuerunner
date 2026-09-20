// A route as it may sit in an attribute, in one place.
//
// Every page that renders a declared route — a storefront link, the one inbox, a mailto — puts
// it inside markup, and each of them has to escape the same way: a live address can carry an
// ampersand, and a quote would otherwise read as the end of the attribute. The escaper lives
// here rather than in every module that interpolates a route, so a route is escaped one way;
// `table.mjs` beside it is the same idea for the markup the pages share.

/**
 * The characters markup would read, escaped. A route goes into an attribute, never into prose:
 * the words around it are the author's, and this is only for the value.
 */
export function attr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

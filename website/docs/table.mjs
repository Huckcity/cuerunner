// The site's table markup, in one place.
//
// A guide's table, the free-versus-Pro tables and the price table are the same wrapper, the
// same classes and the same row shape, so the page modules share this rather than carrying a
// copy each: the markup a page serves is then held by one source, and a change to it (a class,
// a wrapper) reaches every table instead of the one it was edited in.

/**
 * One table as the site serves it: the header row and the rows it was handed, each as a list
 * of cells. Pure string work, so a caller renders a page without writing anything and
 * scripts/docs-build.test.ts can hold the committed HTML to it. The markup is what
 * website/pro.html has always served, so the site's own classes carry it and a page needs
 * nothing added to the stylesheet.
 */
export function table(headers, rows) {
  const head = `<tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr>`
  const body = rows
    .map(cells => `            <tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`)
    .join('\n')
  return `      <div class="table-wrap">
        <table>
          <thead>${head}</thead>
          <tbody>
${body}
          </tbody>
        </table>
      </div>`
}

/**
 * The lines of a script document, in the one place both readers agree on them.
 *
 * A file that ends with a newline ends with a newline, not with an empty line: counting
 * that phantom would put a number in the gutter that no cue should ever be pinned to,
 * and the panel and the tablet would disagree about which line a cue fires on.
 */
export function scriptLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

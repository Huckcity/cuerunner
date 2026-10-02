// Server-sent events, as far as SSCv2 uses them: `event:` and `data:` and nothing else
// (the spec forbids the other EventSource fields). The stream arrives in chunks that end
// wherever the network cut them, so the parser keeps the unfinished line between feeds.

export interface SseEvent {
  /** `message` when the server named none, which is what every state push is. */
  event: string
  data: string
}

/** The most one unfinished event may hold. A receiver never sends more; a broken peer might. */
const MAX_PENDING = 256 * 1024

export interface SseParser {
  feed(chunk: string): void
}

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
  let buffer = ''
  let event = ''
  let data: string[] = []

  const dispatch = (): void => {
    if (data.length > 0) onEvent({ event: event || 'message', data: data.join('\n') })
    event = ''
    data = []
  }

  return {
    feed(chunk) {
      buffer += chunk
      // A bound on what is held: an event that never ends is a fault in the peer, and
      // growing without limit on it is how a bad receiver becomes a bad app.
      if (buffer.length > MAX_PENDING) throw new Error('event stream line too long')

      let newline = buffer.search(/\r\n|\n|\r/)
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        const terminator = /^\r\n/.test(buffer.slice(newline)) ? 2 : 1
        // A lone \r at the very end may be the first half of \r\n: wait for the rest.
        if (buffer[newline] === '\r' && terminator === 1 && newline === buffer.length - 1) break
        buffer = buffer.slice(newline + terminator)

        if (line === '') dispatch()
        else if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        // Comments (":") and any other field are ignored, as the EventSource spec says.
        newline = buffer.search(/\r\n|\n|\r/)
      }
    }
  }
}

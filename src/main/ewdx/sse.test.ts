import { describe, it, expect } from 'vitest'
import { createSseParser } from './sse'
import type { SseEvent } from './sse'

function parse(...chunks: string[]): SseEvent[] {
  const events: SseEvent[] = []
  const parser = createSseParser(event => events.push(event))
  for (const chunk of chunks) parser.feed(chunk)
  return events
}

describe('createSseParser', () => {
  it('reads the named events and the unnamed pushes a receiver sends', () => {
    expect(
      parse('event: open\ndata: {"sessionUUID":"a"}\n\ndata: {"/api/x":{"value":1}}\n\n')
    ).toEqual([
      { event: 'open', data: '{"sessionUUID":"a"}' },
      { event: 'message', data: '{"/api/x":{"value":1}}' }
    ])
  })

  it('holds a half-delivered event until the rest of it arrives', () => {
    expect(parse('data: {"/api/x":', '{"value":1}}\n', '\n')).toEqual([
      { event: 'message', data: '{"/api/x":{"value":1}}' }
    ])
  })

  it('does not split a CRLF that the network cut in half', () => {
    expect(parse('data: a\r', '\n\r', '\n')).toEqual([{ event: 'message', data: 'a' }])
  })

  it('joins several data lines with a newline and ignores comments and other fields', () => {
    expect(parse(': keepalive\nid: 4\ndata: one\ndata: two\n\n')).toEqual([
      { event: 'message', data: 'one\ntwo' }
    ])
  })

  it('does not dispatch an event with no data', () => {
    expect(parse('event: ping\n\n')).toEqual([])
  })

  it('refuses a line that never ends rather than holding it forever', () => {
    const parser = createSseParser(() => undefined)
    expect(() => parser.feed('data: ' + 'x'.repeat(300 * 1024))).toThrow(/too long/)
  })
})

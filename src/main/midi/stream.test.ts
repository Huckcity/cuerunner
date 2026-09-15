// The framing a desk's socket hands over: messages split across reads, several in one
// read, running status where the status byte was sent once, and SysEx in pieces with
// realtime bytes interrupting. A per-message decoder cannot see any of that, so this is
// where the stream is held to what a real one does.
import { describe, it, expect } from 'vitest'
import { createMidiStream } from './stream'

describe('a MIDI byte stream', () => {
  it('hands out a message that arrived in two reads as one message', () => {
    const stream = createMidiStream()
    expect(stream.push([0x90, 0x3c])).toEqual([])
    expect(stream.push([0x7f])).toEqual([[0x90, 0x3c, 0x7f]])
  })

  it('hands out the messages of one read separately', () => {
    const stream = createMidiStream()
    expect(stream.push([0x90, 0x3c, 0x7f, 0xb0, 0x07, 0x64, 0xc0, 0x05])).toEqual([
      [0x90, 0x3c, 0x7f],
      [0xb0, 0x07, 0x64],
      [0xc0, 0x05]
    ])
  })

  it('keeps running status, which is how a desk sends a burst of mutes', () => {
    const stream = createMidiStream()
    // The Avantis document's own example: 9B 00 7F, then two more notes with the status
    // byte left out.
    expect(stream.push([0x9b, 0x00, 0x7f, 0x01, 0x7f, 0x02, 0x7f])).toEqual([
      [0x9b, 0x00, 0x7f],
      [0x9b, 0x01, 0x7f],
      [0x9b, 0x02, 0x7f]
    ])
  })

  it('carries running status across reads', () => {
    const stream = createMidiStream()
    stream.push([0x9b, 0x00])
    expect(stream.push([0x7f, 0x01])).toEqual([[0x9b, 0x00, 0x7f]])
    expect(stream.push([0x7f])).toEqual([[0x9b, 0x01, 0x7f]])
  })

  it('reassembles a SysEx split mid-message', () => {
    const stream = createMidiStream()
    // The Avantis name get: header, 0N, 01, CH, F7 — split after the header.
    expect(stream.push([0xf0, 0x00, 0x00, 0x1a])).toEqual([])
    expect(stream.push([0x50, 0x10, 0x01, 0x00, 0x0b, 0x01, 0x00, 0xf7])).toEqual([
      [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x10, 0x01, 0x00, 0x0b, 0x01, 0x00, 0xf7]
    ])
  })

  it('lets a realtime byte interrupt without disturbing anything', () => {
    const stream = createMidiStream()
    // Clock and active sensing arrive inside other messages on a live stream. Neither is
    // part of the message and neither ends it.
    expect(stream.push([0x90, 0xf8, 0x3c, 0xfe, 0x7f])).toEqual([[0x90, 0x3c, 0x7f]])
    expect(stream.push([0xf0, 0x01, 0xf8, 0x02, 0xf7])).toEqual([[0xf0, 0x01, 0x02, 0xf7]])
  })

  it('does not invent a message from data that lost its status byte', () => {
    const stream = createMidiStream()
    expect(stream.push([0x3c, 0x7f])).toEqual([])
    // The status that follows is read from a clean state rather than as the tail of a
    // message nobody sent.
    expect(stream.push([0x90, 0x3c, 0x7f])).toEqual([[0x90, 0x3c, 0x7f]])
  })

  it('frames a system message the show has no use for instead of losing its place', () => {
    const stream = createMidiStream()
    // Song position (F2, two data bytes) in front of a note: the note is what the show
    // keeps, and it is only read correctly if the system message was framed too.
    expect(stream.push([0xf2, 0x10, 0x20, 0x90, 0x3c, 0x7f])).toEqual([
      [0xf2, 0x10, 0x20],
      [0x90, 0x3c, 0x7f]
    ])
  })

  it('drops a SysEx that never terminates rather than growing for ever', () => {
    const stream = createMidiStream()
    stream.push([0xf0, ...new Array(4097).fill(0x01)])
    expect(stream.push([0x90, 0x3c, 0x7f])).toEqual([[0x90, 0x3c, 0x7f]])
  })

  it('does not keep running status across a system message, which cancels it', () => {
    const stream = createMidiStream()
    stream.push([0xf1, 0x20])
    // A lone data byte after a system common message belongs to no message at all.
    expect(stream.push([0x3c, 0x7f])).toEqual([])
  })
})

/**
 * What a desk's MIDI-over-TCP link is called.
 *
 * One naming, two ends: the service that owns the socket names the desk this way when it
 * publishes what the desk said, and the show names the same string when it says which device
 * a trigger or the desk's own buttons come from. They have to agree, or a show listens to a
 * device that never speaks — which is why this is here rather than written out at each end.
 */
export function deskLinkName(host: string, port: number): string {
  return `${host}:${port}`
}

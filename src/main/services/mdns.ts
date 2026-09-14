// The mDNS bits the presence service needs, with no socket anywhere in sight: one
// query for a service type, and a parser for whatever the network answers with. DNS
// packets are the one part of this that a test can hold entirely in its hands, so they
// are kept apart from the socket that carries them.

/** QTYPE/QCLASS numbers, as they appear on the wire. */
const TYPE_A = 1
const TYPE_PTR = 12
const TYPE_TXT = 16
const TYPE_SRV = 33
const CLASS_IN = 1

const HEADER = 12
/** A name is a handful of labels; a packet that jumps more than this is lying. */
const MAX_JUMPS = 64

export interface DnsRecord {
  name: string
  /** Numeric QTYPE, so a record keeps whatever the wire actually said. */
  type: number
  ttl: number
  /** The record's rdata, exactly as it arrived. */
  data: Buffer
}

export interface PresenceDevice {
  /** The full instance name, which is what stays the same across announcements. */
  id: string
  name: string
  host: string
  address: string
  port: number
  txt: Record<string, string>
}

/**
 * Where a record's bytes started in the packet it came from. A name inside rdata — an
 * SRV target, a PTR instance — may be a compression pointer into the rest of the
 * message, so decoding it needs the message rather than just the rdata.
 */
const origins = new WeakMap<DnsRecord, { packet: Buffer; start: number }>()

/**
 * The browse question for one service type. The id is zero because mDNS answers are
 * matched on names, and the flags ask a standard, non-recursive query: nobody is a
 * directory here, and a responder that does not know answers all the same.
 */
export function buildPtrQuery(service: string): Buffer {
  const name = encodeName(service)
  const query = Buffer.alloc(HEADER + name.length + 4)
  query.writeUInt16BE(1, 4)
  name.copy(query, HEADER)
  query.writeUInt16BE(TYPE_PTR, HEADER + name.length)
  query.writeUInt16BE(CLASS_IN, HEADER + name.length + 2)
  return query
}

/**
 * One name out of a packet, following compression pointers, and where the name ended.
 *
 * Truncation and pointer loops both leave a name that is merely short rather than an
 * exception: the network is full of other people's mDNS, and a malformed packet there
 * is not this service's problem to report.
 */
export function decodeName(packet: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = []
  let cursor = offset
  /** Where the name ends in the original stream, set at the first pointer. */
  let end = -1
  let jumps = 0

  while (cursor < packet.length) {
    const length = packet[cursor]
    if (length === 0) {
      cursor += 1
      break
    }
    if ((length & 0xc0) === 0xc0) {
      // A pointer to earlier in the packet: keep reading there, but the caller has to
      // move on from the two bytes it actually asked us to read.
      if (cursor + 1 >= packet.length) {
        cursor = packet.length
        break
      }
      if (end < 0) end = cursor + 2
      if (++jumps > MAX_JUMPS) {
        cursor = packet.length
        break
      }
      cursor = ((length & 0x3f) << 8) | packet[cursor + 1]
      continue
    }
    if ((length & 0xc0) !== 0) {
      // The 0x40 and 0x80 label types are reserved; nothing a show owns sends them.
      cursor = packet.length
      break
    }
    if (cursor + 1 + length > packet.length) {
      cursor = packet.length
      break
    }
    labels.push(packet.toString('utf8', cursor + 1, cursor + 1 + length))
    cursor += 1 + length
  }

  return { name: labels.join('.'), next: end >= 0 ? end : cursor }
}

/**
 * Every record in a response, from the answer, authority and additional sections —
 * a responder is free to put the SRV, TXT and A records in the additional section,
 * and most of them do.
 *
 * A packet that ends mid-record yields the records that were whole before it; the
 * caller decides whether the partial answer said anything useful.
 */
export function parseDnsRecords(packet: Buffer): DnsRecord[] {
  const records: DnsRecord[] = []
  if (packet.length < HEADER) return records

  let offset = HEADER
  const questions = packet.readUInt16BE(4)
  for (let i = 0; i < questions; i++) {
    offset = decodeName(packet, offset).next + 4
    if (offset > packet.length) return records
  }

  const counts = [packet.readUInt16BE(6), packet.readUInt16BE(8), packet.readUInt16BE(10)]
  for (const count of counts) {
    for (let i = 0; i < count; i++) {
      const parsed = readRecord(packet, offset)
      if (!parsed) return records
      records.push(parsed.record)
      offset = parsed.next
    }
  }
  return records
}

/**
 * What a response says is on the network. A PTR answer is what makes an instance a
 * device; the records that name its address are attached to it, and a response that
 * carries only some of them leaves the rest empty rather than guessing.
 */
export function presenceDevices(records: DnsRecord[]): PresenceDevice[] {
  const devices = new Map<string, PresenceDevice>()

  for (const record of records) {
    if (record.type !== TYPE_PTR) continue
    const instance = rdataName(record)
    if (!instance) continue
    // The PTR target is "<instance>.<service>"; the label is what the panel shows.
    const suffix = `.${record.name}`
    devices.set(instance, {
      id: instance,
      name: instance.endsWith(suffix) ? instance.slice(0, -suffix.length) : instance,
      host: '',
      address: '',
      port: 0,
      txt: {}
    })
  }

  // SRV before A: the A record is named after the SRV target, so the host has to be
  // known before an address can be hung on it.
  for (const record of records) {
    if (record.type !== TYPE_SRV || record.data.length < 6) continue
    const device = devices.get(record.name)
    if (!device) continue
    device.port = record.data.readUInt16BE(4)
    device.host = rdataName(record, 6)
  }

  for (const record of records) {
    if (record.type !== TYPE_A || record.data.length < 4) continue
    const data = record.data
    const address = `${data[0]}.${data[1]}.${data[2]}.${data[3]}`
    for (const device of devices.values()) {
      if (device.host === record.name) device.address = address
    }
  }

  for (const record of records) {
    if (record.type !== TYPE_TXT) continue
    const device = devices.get(record.name)
    if (!device) continue
    for (const [key, value] of txtEntries(record.data)) device.txt[key] = value
  }

  return [...devices.values()]
}

/** One record and where the next one starts, or null when the packet ran out. */
function readRecord(packet: Buffer, offset: number): { record: DnsRecord; next: number } | null {
  const { name, next } = decodeName(packet, offset)
  if (next + 10 > packet.length) return null
  const type = packet.readUInt16BE(next)
  const ttl = packet.readUInt32BE(next + 4)
  // The class sits at next + 2 and is ignored: a browse only cares about internet-class
  // records, which is what every responder a show owns emits.
  const length = packet.readUInt16BE(next + 8)
  const start = next + 10
  const end = start + length
  if (end > packet.length) return null
  const record: DnsRecord = { name, type, ttl, data: packet.subarray(start, end) }
  origins.set(record, { packet, start })
  return { record, next: end }
}

/** A name inside a record's rdata, read from the packet when one is known. */
function rdataName(record: DnsRecord, offset = 0): string {
  const origin = origins.get(record)
  if (!origin) return decodeName(record.data, offset).name
  return decodeName(origin.packet, origin.start + offset).name
}

/**
 * The key/value strings a TXT record carries. A string with no "=" is a key that
 * exists and has no value, and one with nothing after the "=" reads the same way.
 */
function txtEntries(data: Buffer): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  let offset = 0
  while (offset < data.length) {
    const length = data[offset]
    const end = offset + 1 + length
    if (end > data.length) break
    const entry = data.toString('utf8', offset + 1, end)
    offset = end
    if (entry.length === 0) continue
    const equals = entry.indexOf('=')
    entries.push(equals < 0 ? [entry, ''] : [entry.slice(0, equals), entry.slice(equals + 1)])
  }
  return entries
}

/** A name as length-prefixed labels with the root label to end it. */
function encodeName(name: string): Buffer {
  const labels = name
    .split('.')
    .filter(label => label.length > 0)
    .map(label => {
      const bytes = Buffer.from(label, 'utf8')
      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    })
  return Buffer.concat([...labels, Buffer.from([0])])
}

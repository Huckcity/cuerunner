// The published free/Pro record and the gate, read together.
//
// The catalogue is the record an operator reads and the only statement of the free/Pro
// line; the enforcement is in the code — a service's `pro` flag that `ServiceHost` refuses
// on, an `isPro` check in a handler, and the scene cue the runner refuses (AD-15's one
// cue-type gate). Nothing read the two at once, so a Pro class could ship unrecorded and a
// recorded one could drift: the catalogue named the wireless service `wireless` where the
// code's id is `rf`, and the free desk send beside the Pro service on the same socket was
// decided in prose alone.
//
// Every class here is derived from the code — services from `defaultServices()`, gated
// channels from the handlers' own source, cue types from `CUE_TYPES`/`PRO_CUE_TYPES` — and
// the record is parsed rather than listed a second time (the `settingsSections` pattern).
// Both directions fail: a class the code enforces that the record does not name, and a
// recorded class the code does not enforce. The recorded free identifiers are held the
// other way, because AD-15 forbids the gate from removing anything from the free tier — a
// gate that reaches `midi:sendTcp` is a shipped entitlement withdrawn, not a tidy-up.
//
// The record is the input, so a run that cannot read it fails here rather than passing
// against nothing. Its parser is `./catalog`, which the site's free-versus-Pro page reads as
// well (scripts/pro-page.test.ts): one reading of the record for both guards.
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CUE_TYPES, PRO_CUE_TYPES } from '../../shared/cue'
import { CHANNEL_TABLES } from '../../shared/ipc'
import { defaultServices } from '../show/runtime'
import { BOUNDARY_HEADER, CUE_TABLE_HEADER, boundaryItems, cueClasses, readRecord, tableRows } from './catalog'
import type { BoundaryItem, GateClass } from './catalog'

/** The repository root, from this file: src/main/license → the checkout. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A source the scan reads: the name its failures write, and its text. */
interface Source {
  name: string
  text: string
}

function source(relativePath: string): Source {
  return { name: relativePath, text: readFileSync(join(root, relativePath), 'utf-8') }
}

/**
 * The files that register main's handlers, tests excluded: a gate can land in any of
 * them, not only in the one that carries the seven today.
 */
function registeringSources(): Source[] {
  const dir = 'src/main/ipc'
  return readdirSync(join(root, dir))
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => source(`${dir}/${name}`))
}

function parse(file: Source): ts.SourceFile {
  return ts.createSourceFile(file.name, file.text, ts.ScriptTarget.Latest, true)
}

// ---- the code --------------------------------------------------------------

interface ServiceClass {
  id: string
  pro: boolean
}

/** The services the app builds, with the flag the host refuses them on. */
function serviceClasses(): ServiceClass[] {
  return defaultServices().map(service => ({ id: service.id, pro: service.pro === true }))
}

/** Every channel literal the shared layer declares, from the composition point Story 4.2 built. */
function declaredChannels(): Set<string> {
  const declared = new Set<string>()
  for (const table of CHANNEL_TABLES) {
    for (const channel of Object.values(table)) declared.add(channel)
  }
  return declared
}

/**
 * The declared channel tables, by the name the handlers call them by: `SCRIPT_CHANNELS.
 * readDocument` is read as `script:readDocument` from the one place that literal lives,
 * never restated here. The tables are found the way the handlers import them — every
 * `export const <NAME>_CHANNELS = { … } as const` in the shared layer.
 */
function channelTables(): Map<string, Map<string, string>> {
  const present = new Map<string, Map<string, string>>()
  const ipcDir = join(root, 'src', 'shared', 'ipc')
  const files = [
    ...readdirSync(ipcDir).filter(name => name.endsWith('.ts')).map(name => join(ipcDir, name)),
    join(root, 'src', 'shared', 'audio.ts')
  ]
  for (const name of files) {
    for (const statement of parse({ name, text: readFileSync(name, 'utf-8') }).statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.name.text.endsWith('_CHANNELS')) continue
        const initializer = declaration.initializer
        // `EVENT_CHANNELS` is a list rather than a table and has no members to resolve.
        if (initializer === undefined || !ts.isAsExpression(initializer) || !ts.isObjectLiteralExpression(initializer.expression)) {
          continue
        }
        const members = new Map<string, string>()
        for (const property of initializer.expression.properties) {
          if (!ts.isPropertyAssignment(property)) {
            throw new Error(`${name}: ${declaration.name.text} has a member this scan cannot read, so a channel it names would go unchecked`)
          }
          const member = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null
          if (member === null || !ts.isStringLiteral(property.initializer)) {
            throw new Error(`${name}: ${declaration.name.text}.${property.getText()} is not a plain string literal, so the channel behind it cannot be resolved`)
          }
          members.set(member, property.initializer.text)
        }
        present.set(declaration.name.text, members)
      }
    }
  }
  return present
}

const sharedChannelTables = channelTables()

/** One `ipcMain.handle` call: the channel it registers, and whether the licence is asked inside it. */
interface Registration {
  channel: string
  gated: boolean
}

/**
 * Every channel main registers, with whether its handler asks the licence. `isPro` is the
 * predicate the handlers import from the shared licence module: a handler that reaches for
 * it anywhere inside its own body is the gate — the checks sit in plain callbacks and in
 * `refusalValue` callbacks alike — and the channel it is registered on is the class the
 * record has to name.
 *
 * A handler registered any other way — through a helper that takes the channel — is
 * invisible here by design, the way a settings read reached through an alias is in
 * `settingsSections.test.ts`; it is made visible by registering it with `ipcMain.handle`.
 */
function registrations(file: Source): Registration[] {
  const found: Registration[] = []

  const resolve = (expression: ts.Expression | undefined): string => {
    if (expression === undefined) throw new Error(`${file.name}: an ipcMain.handle call names no channel`)
    if (ts.isStringLiteral(expression)) return expression.text
    const table = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
      ? expression.expression
      : null
    const member = ts.isPropertyAccessExpression(expression)
      ? expression.name.text
      : ts.isElementAccessExpression(expression) &&
          expression.argumentExpression !== undefined &&
          ts.isStringLiteral(expression.argumentExpression)
        ? expression.argumentExpression.text
        : null
    if (table === null || !ts.isIdentifier(table) || member === null) {
      throw new Error(
        `${file.name}: this scan cannot resolve the channel "${expression.getText()}" — it reads a literal or a member of a declared channel table`
      )
    }
    const channel = sharedChannelTables.get(table.text)?.get(member)
    if (channel === undefined) {
      throw new Error(
        `${file.name}: ${table.text}.${member} is not a channel the shared layer declares, so the class of the registration cannot be checked`
      )
    }
    return channel
  }

  const asksLicence = (handler: ts.Node): boolean => {
    let asks = false
    const walk = (node: ts.Node): void => {
      if (asks) return
      if (ts.isIdentifier(node) && node.text === 'isPro') {
        asks = true
        return
      }
      ts.forEachChild(node, walk)
    }
    walk(handler)
    return asks
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'handle' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'ipcMain'
    ) {
      const handler = node.arguments[1]
      if (handler === undefined) throw new Error(`${file.name}: an ipcMain.handle call registers no handler`)
      found.push({ channel: resolve(node.arguments[0]), gated: asksLicence(handler) })
    }
    ts.forEachChild(node, visit)
  }

  visit(parse(file))
  return found
}

// ---- record against code ---------------------------------------------------

/** What the record has to say about the services, both ways. */
function serviceProblems(items: readonly BoundaryItem[], services: readonly ServiceClass[]): string[] {
  const problems: string[] = []
  for (const service of services) {
    const row = items.find(item => item.kind === 'service' && item.identifier === service.id)
    if (row === undefined) {
      problems.push(`\`${service.id}\` is a service in the code and the record does not name it`)
      continue
    }
    const enforced: GateClass = service.pro ? 'pro' : 'free'
    if (row.class !== enforced) {
      problems.push(`\`${service.id}\` is ${enforced} in the code and the record calls it ${row.class}`)
    }
  }
  return problems
}

/** What the record has to say about the gated channels, both ways. */
function channelProblems(items: readonly BoundaryItem[], gated: readonly string[]): string[] {
  const recorded = items
    .filter(item => item.kind === 'channel' && item.class === 'pro')
    .map(item => item.identifier)
  return [
    ...gated
      .filter(channel => !recorded.includes(channel))
      .map(channel => `\`${channel}\` has an \`isPro\` check in main and the record does not name it as Pro`),
    ...recorded
      .filter(channel => !gated.includes(channel))
      .map(channel => `the record names \`${channel}\` as Pro and no \`isPro\` check reaches its handler: the gate was removed, or the record is stale`)
  ]
}

/**
 * The recorded free identifiers, held the other way: AD-15 forbids the gate from removing
 * anything from the free tier, so a recorded free class that a gate or a `pro` flag now
 * reaches is a shipped entitlement withdrawn.
 */
function freeProblems(items: readonly BoundaryItem[], services: readonly ServiceClass[], gated: readonly string[]): string[] {
  const problems: string[] = []
  for (const item of items) {
    if (item.class !== 'free') continue
    if (item.kind === 'channel' && gated.includes(item.identifier)) {
      problems.push(`\`${item.identifier}\` is recorded free and an \`isPro\` check now reaches its handler`)
    }
    if (item.kind === 'service' && services.find(service => service.id === item.identifier)?.pro === true) {
      problems.push(`\`${item.identifier}\` is recorded free and the service now carries \`pro\``)
    }
  }
  return problems
}

/** Every row resolved against the code, so no class is compared against nothing. */
function resolutionProblems(
  items: readonly BoundaryItem[],
  services: readonly ServiceClass[],
  declared: ReadonlySet<string>
): string[] {
  return items
    .filter(item =>
      item.kind === 'service'
        ? !services.some(service => service.id === item.identifier)
        : !declared.has(item.identifier)
    )
    .map(item => `the record names the ${item.kind} \`${item.identifier}\`, which the code does not have: a row that resolves to nothing classifies nothing`)
}

/** The record's cue table and the cue types the code has, both ways, with the Pro rows as declared. */
function cueProblems(rows: ReadonlyMap<string, GateClass>): string[] {
  const types = new Set<string>(CUE_TYPES)
  const declared = new Set<string>(PRO_CUE_TYPES)
  const recorded = new Set<string>(CUE_TYPES.filter(type => rows.get(type) === 'pro'))
  return [
    ...CUE_TYPES.filter(type => !rows.has(type)).map(type => `the code has the cue type "${type}" and the record's cue table does not name it`),
    ...[...rows.keys()].filter(type => !types.has(type)).map(type => `the record's cue table names "${type}", which is not a cue type in the code`),
    ...[...recorded]
      .filter(type => !declared.has(type))
      .map(type => `the record calls the cue type "${type}" Pro and \`PRO_CUE_TYPES\` does not`),
    ...[...declared]
      .filter(type => !recorded.has(type))
      .map(type => `\`PRO_CUE_TYPES\` names "${type}" and the record's cue table does not call it Pro`)
  ]
}

describe('the published free/Pro record', () => {
  const record = readRecord()
  const items = boundaryItems(record)
  const services = serviceClasses()
  const gated = registeringSources()
    .flatMap(file => registrations(file))
    .filter(entry => entry.gated)
    .map(entry => entry.channel)

  it('records every service with the class its `pro` flag enforces', () => {
    expect(serviceProblems(items, services)).toEqual([])
  })

  it('records every channel main gates, and only those', () => {
    expect(channelProblems(items, gated)).toEqual([])
  })

  it('leaves every recorded free identifier ungated', () => {
    expect(freeProblems(items, services, gated)).toEqual([])
  })

  it('resolves every recorded identifier to a code fact', () => {
    expect(resolutionProblems(items, services, declaredChannels())).toEqual([])
  })

  it('matches the cue table to the cue types the code has', () => {
    expect(cueProblems(cueClasses(record))).toEqual([])
  })

  it('reads the cue type class in the runner rather than spelling a literal', () => {
    // The scene refusal is AD-15's one renderer-side gate, and the class it refuses is a
    // declaration: a type added to `PRO_CUE_TYPES` has to be refused where it runs, and a
    // runner that spelled 'scene' again would leave the declaration decorative.
    const reads: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && (node.text === 'isProCueType' || node.text === 'PRO_CUE_TYPES')) {
        reads.push(node.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(parse(source('src/renderer/src/engine/CueEngine.ts')))

    expect(
      reads,
      'CueEngine.ts does not read `PRO_CUE_TYPES`: the scene refusal has to ask the cue-type declaration, or a Pro cue type added to it is enforced nowhere'
    ).not.toEqual([])
  })
})

describe('the record reader', () => {
  const record = [
    '# A record',
    '',
    '| Item | Kind | Identifier | Class |',
    '| --- | --- | --- | --- |',
    '| Desk link | service | `midi-tcp` | Pro |',
    '| OSC send | channel | `osc:send` | free |',
    '',
    'Prose after the table.',
    '',
    '| Type | Key | What it does |',
    '| --- | --- | --- |',
    '| audio | free | Plays a file. |'
  ].join('\n')

  it('reads the table it was asked for and stops at its end', () => {
    expect(tableRows(record, BOUNDARY_HEADER)).toEqual([
      ['Desk link', 'service', '`midi-tcp`', 'Pro'],
      ['OSC send', 'channel', '`osc:send`', 'free']
    ])
    expect(tableRows(record, CUE_TABLE_HEADER)).toEqual([['audio', 'free', 'Plays a file.']])
  })

  it('fails loudly when the table is not there', () => {
    expect(() => tableRows('# nothing to read here', BOUNDARY_HEADER)).toThrow('carries no "Item | Kind | Identifier | Class" table')
    expect(() => tableRows('', CUE_TABLE_HEADER)).toThrow('carries no "Type | Key | What it does" table')
  })

  it('refuses a table with no rule line and a row it cannot parse', () => {
    // A header with no rule under it is not a table this reader knows, and a line that
    // opens like a row but does not close like one is the table going wrong rather than
    // ending — reading it as the end would drop every row after it.
    const noRule = [
      '| Item | Kind | Identifier | Class |',
      '| Desk link | service | `midi-tcp` | Pro |'
    ].join('\n')
    const brokenRow = [
      '| Item | Kind | Identifier | Class |',
      '| --- | --- | --- | --- |',
      '| Desk link | service | `midi-tcp` | Pro',
      '| OSC send | channel | `osc:send` | free |'
    ].join('\n')

    expect(() => tableRows(noRule, BOUNDARY_HEADER)).toThrow('has no rule line under its header')
    expect(() => tableRows(brokenRow, BOUNDARY_HEADER)).toThrow('has a line that is not a row')
  })

  it('names a class it cannot read rather than treating it as free', () => {
    const rogue = [
      '| Item | Kind | Identifier | Class |',
      '| --- | --- | --- | --- |',
      '| Desk link | service | `midi-tcp` | enterprise |'
    ].join('\n')

    expect(() => boundaryItems(rogue)).toThrow('states the class "enterprise", which is neither free nor Pro')
  })

  it('refuses a row of a kind it cannot resolve', () => {
    const rogue = [
      '| Item | Kind | Identifier | Class |',
      '| --- | --- | --- | --- |',
      '| Scenes view | surface | `scenes` | Pro |'
    ].join('\n')

    expect(() => boundaryItems(rogue)).toThrow('names "scenes" with kind "surface"')
  })

  it('resolves a registration through the table its channel is declared in', () => {
    const synthetic: Source = {
      name: 'Synthetic.ts',
      text: [
        'ipcMain.handle(SCRIPT_CHANNELS.readFile, async () => read())',
        'ipcMain.handle(SCRIPT_CHANNELS.readDocument, async () => {',
        '  if (!isPro(license.status())) return null',
        '  return read()',
        '})'
      ].join('\n')
    }

    expect(registrations(synthetic)).toEqual([
      { channel: 'script:readFile', gated: false },
      { channel: 'script:readDocument', gated: true }
    ])
  })

  it('names a registration it cannot resolve rather than skipping it', () => {
    const unchecked: Source = {
      name: 'Synthetic.ts',
      text: ["const channel = 'script:readFile'", 'ipcMain.handle(channel, async () => null)'].join('\n')
    }
    const elsewhere: Source = {
      name: 'Synthetic.ts',
      text: ['ipcMain.handle(SCRIPT_CHANNELS.readEverything, async () => null)'].join('\n')
    }

    expect(() => registrations(unchecked)).toThrow('cannot resolve the channel "channel"')
    expect(() => registrations(elsewhere)).toThrow('SCRIPT_CHANNELS.readEverything is not a channel the shared layer declares')
  })
})

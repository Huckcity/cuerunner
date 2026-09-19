// A service's declaration is the only record of which `ShowSettings` sections its
// `start()` reads — the host keeps no map from an id to a slice — so this file holds the
// declaration and the code together. It parses each service's own source and fails when
// `start()` reads a section the service has not declared, or declares one `start()` never
// reads. The other half of the same story is here too: `ServiceHost.ts` must name no
// service id, or the host is a place to remember again.
//
// An id-keyed switch drifted exactly this way: the companion's arm claimed `script`,
// which `CompanionService.start()` has never read, so a script edit dropped the tablet's
// stream for nothing. A declaration that matches its code cannot say that.
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultServices } from '../show/runtime'

/** The services directory, where a service's own file resolves by its class name. */
const here = dirname(fileURLToPath(import.meta.url))

/** A source the guard reads: the name its failure report writes, and its text. */
interface Source {
  name: string
  text: string
}

function parse(file: Source): ts.SourceFile {
  return ts.createSourceFile(file.name, file.text, ts.ScriptTarget.Latest, true)
}

/** The shapes a class's `start` can take: a method, or a property holding a function. */
type StartFunction = ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression

/** The parameter list and body a start-shaped declaration carries, whichever shape it is. */
function functionOf(member: ts.MethodDeclaration | ts.PropertyDeclaration): StartFunction | null {
  if (ts.isMethodDeclaration(member)) return member
  if (
    member.initializer !== undefined &&
    (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
  ) {
    return member.initializer
  }
  return null
}

/**
 * One class's `start()`, or the reason the guard cannot read the service: a class that
 * moved to another file, or was renamed, is named here rather than skipped.
 */
function startOf(file: Source, className: string): StartFunction {
  for (const node of parse(file).statements) {
    if (!ts.isClassDeclaration(node) || node.name?.text !== className) continue
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member) && !ts.isPropertyDeclaration(member)) continue
      if (!ts.isIdentifier(member.name) || member.name.text !== 'start') continue
      const start = functionOf(member)
      if (start) return start
    }
    throw new Error(`${file.name}: ${className} has no start() the guard can read`)
  }
  throw new Error(`${file.name}: no class ${className} — a service that moves is reported, not skipped`)
}

/**
 * The `ShowSettings` sections one service's `start()` reads, in source order and once
 * each: a `settings.<section>` access, a literal `settings['<section>']`, and a section
 * destructured straight off the settings parameter. A read reached any other way — through
 * an alias, or a key computed at runtime — is invisible here by design; it is made
 * visible by being written as `settings.<section>` in the service's own file, never by
 * relaxing this scan.
 */
function readSections(file: Source, className: string): string[] {
  const start = startOf(file, className)
  const body = start.body
  if (!body) throw new Error(`${file.name}: ${className}.start() has no body to read`)
  const settings = start.parameters[1]
  if (!settings || !ts.isIdentifier(settings.name)) {
    throw new Error(`${file.name}: ${className}.start() takes no settings parameter to read`)
  }
  const parameter = settings.name.text
  const reads: string[] = []
  const read = (section: string): void => {
    if (!reads.includes(section)) reads.push(section)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === parameter) {
      read(node.name.text)
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === parameter) {
      const key = node.argumentExpression
      if (key && (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) read(key.text)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === parameter
    ) {
      for (const element of node.name.elements) {
        // A rest element names every remaining section at once — `const { oscIn, ...rest }`
        // reads no section called `rest` — so it is not a read to hold against the
        // declaration.
        if (element.dotDotDotToken) continue
        const section = element.propertyName ?? element.name
        if (ts.isIdentifier(section)) read(section.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return reads
}

/**
 * Everything the guard has to say about one service: the reads it has not declared, and
 * the declarations its `start()` never reads. Empty means the declaration and the code
 * agree — which is the whole of the claim the host relies on.
 */
function mismatches(file: Source, className: string, declared: readonly string[]): string[] {
  const reads = readSections(file, className)
  return [
    ...reads
      .filter(section => !declared.includes(section))
      .map(section => `${file.name}: start() reads settings.${section}, which is not declared`),
    ...declared
      .filter(section => !reads.includes(section))
      .map(section => `${file.name}: declares "${section}", which start() never reads`)
  ]
}

/**
 * Every source-level mention of a service id in the host, as the failure report writes it:
 * a string or no-substitution template literal that is the id, an id carried in a
 * segment of a template literal, and an identifier that is the id in constant spelling
 * (`OSC_IN` for `osc-in`). A map rebuilt through a constant, an import or a computed key
 * is therefore as visible as the switch it replaces.
 */
function idMentions(file: Source, ids: readonly string[]): string[] {
  const found: string[] = []
  const mention = (message: string): void => {
    if (!found.includes(message)) found.push(message)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (ids.includes(node.text)) mention(`${file.name} names "${node.text}"`)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const carried = ids.find(id => node.text.includes(id))
      if (carried !== undefined) mention(`${file.name} carries "${carried}" in a template literal`)
    } else if (ts.isIdentifier(node)) {
      const spelled = node.text.toLowerCase().replace(/_/g, '-')
      const id = ids.find(candidate => candidate === spelled)
      if (id !== undefined) mention(`${file.name} names "${node.text}", which is "${id}"`)
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(file))
  return found
}

describe('the services’ settings declarations', () => {
  it('reads exactly the sections each service declares', () => {
    for (const service of defaultServices()) {
      const className = service.constructor.name
      // The class name is the file name: a service that moves is read where it says it is.
      const file: Source = {
        name: `${className}.ts`,
        text: readFileSync(join(here, `${className}.ts`), 'utf-8')
      }
      expect(mismatches(file, className, service.settingsSections), className).toEqual([])
    }
  })

  it('keeps no service id in the host', () => {
    // The host enumerates the declarations the services carry; an id here is the switch
    // coming back, and a configure that moved one section would restart the wrong things.
    const ids = defaultServices().map(service => service.id)
    const named = idMentions(
      {
        name: 'ServiceHost.ts',
        text: readFileSync(join(here, '..', 'bus', 'ServiceHost.ts'), 'utf-8')
      },
      ids
    )
    expect(named).toEqual([])
  })
})

describe('the guard itself', () => {
  const SYNTHETIC: Source = {
    name: 'Synthetic.ts',
    text: [
      'class Synthetic {',
      '  start(context: ServiceContext, settings: ShowSettings): void {',
      '    void context',
      '    void settings.oscIn',
      "    void settings['midiIn']",
      '    const { desk, ...others } = settings',
      '    // settings.script is a comment, not a read',
      "    const note = 'settings.cast'",
      '    void desk',
      '    void others',
      '    void note',
      '    void settings.oscIn.port',
      '  }',
      '}',
      'class Other {',
      '  start(settings: ShowSettings): void {',
      '    void settings.rf',
      '  }',
      '}'
    ].join('\n')
  }

  it('reads a member access, a literal key and a destructured section, and nothing else', () => {
    // The other class's `settings.rf` is not this class's start(): the declaration is what
    // *this* service reads. A nested read is the same read as its first property, and a
    // rest element (`...others`) names no section at all.
    expect(readSections(SYNTHETIC, 'Synthetic')).toEqual(['oscIn', 'midiIn', 'desk'])
  })

  it('reads a start written as a class property holding a function', () => {
    const arrow: Source = {
      name: 'ArrowService.ts',
      text: [
        'class ArrowService {',
        '  start = (context: ServiceContext, settings: ShowSettings): void => {',
        '    void context',
        '    void settings.presence',
        '  }',
        '}'
      ].join('\n')
    }

    expect(readSections(arrow, 'ArrowService')).toEqual(['presence'])
    expect(mismatches(arrow, 'ArrowService', ['presence'])).toEqual([])
  })

  it('names the file and the section when a read is undeclared and a declaration unread', () => {
    const rogue: Source = {
      name: 'RogueService.ts',
      text: [
        'class RogueService {',
        '  start(context: ServiceContext, settings: ShowSettings): void {',
        '    void context',
        '    void settings.companion',
        '  }',
        '}'
      ].join('\n')
    }

    expect(mismatches(rogue, 'RogueService', ['oscIn'])).toEqual([
      'RogueService.ts: start() reads settings.companion, which is not declared',
      'RogueService.ts: declares "oscIn", which start() never reads'
    ])
  })

  it('names a class it cannot find rather than skipping the service', () => {
    expect(() => readSections(SYNTHETIC, 'MovedService')).toThrow('Synthetic.ts: no class MovedService')
  })

  it('finds a service id however the host spells it, through a constant included', () => {
    const host: Source = {
      name: 'ServiceHost.ts',
      text: [
        "const OSC_IN = 'osc-in'",
        'const SECTIONS: Record<string, string[]> = { [OSC_IN]: [] }',
        'function describeChange(id: string): string {',
        '  return `the ${SECTIONS[id]} reader is companion`',
        '}'
      ].join('\n')
    }

    expect(idMentions(host, ['osc-in', 'companion'])).toEqual([
      'ServiceHost.ts names "OSC_IN", which is "osc-in"',
      'ServiceHost.ts names "osc-in"',
      'ServiceHost.ts carries "companion" in a template literal'
    ])
  })
})

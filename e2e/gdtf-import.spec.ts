// A GDTF fixture type, imported through the real window and the real main process: the file is
// a zip written here by hand — a description and a model beside it, no downloaded fixture — and
// the Patch tab's own file input is handed it, the way an operator's pick arrives. Main reads
// the archive and the XML; the window adds the type, patches it, and the faders say which of a
// channel's functions a value is in. A file that is not GDTF is refused with a sentence.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'
import { writeZip } from '../src/main/workspace/zip'

let app: ElectronApplication
let page: Page
let root: string

const DESCRIPTION = [
  '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
  '<GDTF DataVersion="1.2">',
  '  <FixtureType Name="Spot" ShortName="SP" LongName="Suite Spot 300" Manufacturer="Suite Lights" FixtureTypeID="5A2C1F1E-0000-4000-8000-000000000002">',
  '    <AttributeDefinitions><Attributes>',
  '      <Attribute Name="Dimmer" Pretty="Dim"/>',
  '      <Attribute Name="Shutter1" Pretty="Shutter"/>',
  '      <Attribute Name="Pan" Pretty="Pan"/>',
  '    </Attributes></AttributeDefinitions>',
  '    <DMXModes>',
  '      <DMXMode Name="Standard" Geometry="Base"><DMXChannels>',
  '        <DMXChannel DMXBreak="1" Offset="1,2" Geometry="Yoke" InitialFunction="Yoke_Pan.Pan.Pan 1">',
  '          <LogicalChannel Attribute="Pan"><ChannelFunction Name="Pan 1" Attribute="Pan" DMXFrom="0/1" Default="32768/2"/></LogicalChannel>',
  '        </DMXChannel>',
  '        <DMXChannel DMXBreak="1" Offset="3" Geometry="Beam" InitialFunction="Beam_Shutter1.Shutter1.Open">',
  '          <LogicalChannel Attribute="Shutter1">',
  '            <ChannelFunction Name="Closed" Attribute="Shutter1" DMXFrom="0/1" Default="0/1"/>',
  '            <ChannelFunction Name="Open" Attribute="Shutter1" DMXFrom="32/1" Default="32/1"/>',
  '            <ChannelFunction Name="Strobe" Attribute="Shutter1" DMXFrom="64/1" Default="64/1"/>',
  '          </LogicalChannel>',
  '        </DMXChannel>',
  '        <DMXChannel DMXBreak="1" Offset="4,5,6" Geometry="Beam">',
  '          <LogicalChannel Attribute="Dimmer"><ChannelFunction Name="Dimmer 1" Attribute="Dimmer" DMXFrom="0/3" Default="0/3"/></LogicalChannel>',
  '        </DMXChannel>',
  '      </DMXChannels></DMXMode>',
  '    </DMXModes>',
  '  </FixtureType>',
  '</GDTF>'
].join('\n')

test.beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-ship-gdtf-e2e-'))
  ;({ app, page } = await launchApp())
  await page.getByRole('tab', { name: /Lighting/ }).click()
})

test.afterEach(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

test('imports a GDTF file, patches it, and the faders name a channel’s functions', async () => {
  const file = path.join(root, 'Suite Lights@Suite Spot 300.gdtf')
  await writeZip(file, [
    { name: 'models/3ds/Base.3ds', data: Buffer.alloc(4096, 3) },
    { name: 'description.xml', data: Buffer.from(DESCRIPTION) }
  ])
  await page.locator('input[aria-label="GDTF fixture file"]').setInputFiles(file)
  await expect(page.locator('.lighting-note[role="status"]')).toHaveText(
    'Imported Suite Spot 300: 1 mode. Dim in Standard is 24-bit: its two most significant bytes are driven and the rest held at zero.'
  )
  await expect(page.getByRole('table', { name: 'Fixture types' })).toContainText('Suite Lights Suite Spot 300')
  await expect(page.getByRole('table', { name: 'Fixture types' })).toContainText('imported')

  // The new type is the one chosen: patch one, six slots wide.
  await page.locator('#patch-name').fill('Spot')
  await page.getByRole('button', { name: 'Patch', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Fixtures' }).locator('tbody tr')).toContainText('1–6')

  await page.locator('.lighting-tab', { hasText: 'Faders' }).click()
  const shutter = page.locator('.lighting-fixture[data-fixture="Spot"] .lighting-fader', { hasText: 'Shutter' })
  // At rest it is where its initial function puts it: Open.
  await expect(shutter.locator('[data-testid="fader-function"]')).toHaveText('Open')
  await shutter.locator('input[type="range"]').evaluate(input => {
    const element = input as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, '0.9')
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(shutter.locator('[data-testid="fader-function"]')).toHaveText('Strobe')
})

test('refuses a file that is not GDTF, and adds nothing', async () => {
  const file = path.join(root, 'not-a-fixture.gdtf')
  fs.writeFileSync(file, 'this is not a zip')
  const types = page.getByRole('table', { name: 'Fixture types' })
  const before = await types.locator('tbody tr').count()
  await page.locator('input[aria-label="GDTF fixture file"]').setInputFiles(file)
  await expect(page.locator('.lighting-error')).toHaveText('not-a-fixture.gdtf: that file is not a zip archive, so it is not a GDTF file')
  await expect(types.locator('tbody tr')).toHaveCount(before)
})

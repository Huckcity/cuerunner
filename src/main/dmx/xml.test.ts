// The bounded XML reader: what a fixture description is made of, read; and what XML can do to a
// machine that trusts it, refused with a sentence.
import { describe, expect, it } from 'vitest'
import { childNamed, childrenNamed, parseXml, XML_LIMITS } from './xml'

describe('reading a document', () => {
  it('reads elements and their attributes, and steps over everything else', () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- a comment -->\n' +
        '<GDTF DataVersion="1.2"><FixtureType Name=\'Spot &amp; Wash\' Note="&lt;&#65;&#x42;&quot;&apos;&gt;">' +
        'text that says nothing<![CDATA[ <not an element> ]]><DMXModes/></FixtureType></GDTF>\n'
    )
    expect(root.name).toBe('GDTF')
    expect(root.attributes).toEqual({ DataVersion: '1.2' })
    const fixture = childNamed(root, 'FixtureType')
    expect(fixture?.attributes).toEqual({ Name: 'Spot & Wash', Note: '<AB"\'>' })
    expect(childrenNamed(fixture!, 'DMXModes')).toHaveLength(1)
  })

  it('refuses a document type declaration, which is where entity expansion lives', () => {
    expect(() =>
      parseXml('<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaaaaaa">]><GDTF Name="&a;"/>')
    ).toThrow('its XML carries a document type declaration, which is not read')
  })

  it('refuses an entity it does not define, and a character that does not exist', () => {
    expect(() => parseXml('<GDTF Name="&secret;"/>')).toThrow('its XML uses an entity it does not define (&secret;), which is not read')
    expect(() => parseXml('<GDTF Name="&#0;"/>')).toThrow(/names a character that does not exist/)
    expect(() => parseXml('<GDTF Name="&#xD800;"/>')).toThrow(/names a character that does not exist/)
  })

  it('refuses a document that is not one well-formed tree, saying where', () => {
    expect(() => parseXml('<GDTF><A></B></GDTF>')).toThrow(/<\/B> closes <A>/)
    expect(() => parseXml('<GDTF>')).toThrow(/<GDTF> is never closed/)
    expect(() => parseXml('<GDTF/><Second/>')).toThrow(/a second root element/)
    expect(() => parseXml('<GDTF Name=unquoted/>')).toThrow(/is not quoted/)
    expect(() => parseXml('<GDTF A="1" A="2"/>')).toThrow(/carries A twice/)
    expect(() => parseXml('stray text <GDTF/>')).toThrow(/text before the first element/)
    expect(() => parseXml('   ')).toThrow('it holds no XML element at all')
    expect(() => parseXml('<GDTF><!-- never closed </GDTF>')).toThrow(/a comment that never ends/)
  })

  it('is bounded: the length, the element count, the depth, the attributes and a value', () => {
    const small = { ...XML_LIMITS, chars: 40, elements: 3, depth: 2, attributesPerElement: 2, valueChars: 8 }
    expect(() => parseXml(`<GDTF>${' '.repeat(50)}</GDTF>`, small)).toThrow(/longer than/)
    expect(() => parseXml('<a><b/><c/><d/></a>', small)).toThrow('its XML has more than 3 elements, more than this app reads')
    expect(() => parseXml('<a><b><c></c></b></a>', small)).toThrow('its XML nests deeper than the 2 levels this app reads')
    expect(() => parseXml('<a x="1" y="2" z="3"/>', small)).toThrow('its XML has an element with more than 2 attributes')
    expect(() => parseXml('<a x="123456789"/>', small)).toThrow('its XML has an attribute longer than the 8 characters this app reads')
  })
})

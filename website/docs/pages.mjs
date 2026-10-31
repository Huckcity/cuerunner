// Every page this script writes. The content lives beside this file, split by what the
// pages are for: a guide is read once, a reference page is looked things up in, the
// support page is the one read before writing to anyone, and the interop page is
// where the rest of the rig meets the cue list.
import { GUIDES } from './guides.mjs'
import { REFERENCE } from './reference.mjs'
import { SUPPORT } from './support.mjs'
import { INTEROP } from './interop.mjs'

export const PAGES = [...GUIDES, ...REFERENCE, ...SUPPORT, ...INTEROP]

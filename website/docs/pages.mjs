// Every page this script writes. The content lives beside this file, split by what the
// pages are for: a guide is read once, a reference page is looked things up in, the price
// page is the one commercial page — the free/Pro line, what Pro costs and the trial — the
// support page is the one a buyer reads before writing to anyone, and the interop page is
// where the rest of the rig meets the cue list.
import { GUIDES } from './guides.mjs'
import { REFERENCE } from './reference.mjs'
import { PRICING } from './pricing.mjs'
import { SUPPORT } from './support.mjs'
import { INTEROP } from './interop.mjs'

export const PAGES = [...GUIDES, ...REFERENCE, ...PRICING, ...SUPPORT, ...INTEROP]

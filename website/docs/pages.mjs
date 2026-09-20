// Every page this script writes. The content lives beside this file, split by what the
// pages are for: a guide is read once, a reference page is looked things up in, and the
// Free and Pro page is the one a buyer reads before either.
import { GUIDES } from './guides.mjs'
import { REFERENCE } from './reference.mjs'
import { PRO } from './pro.mjs'
import { PRICING } from './pricing.mjs'
import { INTEROP } from './interop.mjs'

export const PAGES = [...GUIDES, ...REFERENCE, ...PRO, ...PRICING, ...INTEROP]

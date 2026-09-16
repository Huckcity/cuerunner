// Every page this script writes. The content lives beside this file, split by what the
// pages are for: a guide is read once, a reference page is looked things up in.
import { GUIDES } from './guides.mjs'
import { REFERENCE } from './reference.mjs'

export const PAGES = [...GUIDES, ...REFERENCE]

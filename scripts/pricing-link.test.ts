// The app sends somebody who meets a Pro lock to the page that says what Pro costs. That
// page is the site's, so the address is held to the site: the origin the landing page
// declares, and a page the served tree actually has.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRICING_URL } from '../src/shared/support'

describe('the pricing page a Pro lock points at', () => {
  it('is on the site the landing page says it is', () => {
    const landing = readFileSync('website/index.html', 'utf8')
    const origin = /<meta property="og:url" content="([^"]+)"/.exec(landing)?.[1]
    expect(origin, 'the landing page declares no address').toBeDefined()
    expect(PRICING_URL.startsWith(origin as string)).toBe(true)
  })

  it('is a page the site serves', () => {
    const page = new URL(PRICING_URL).pathname.replace(/^\//, '')
    expect(existsSync(`website/${page}`), `website/${page} is not in the served tree`).toBe(true)
  })
})

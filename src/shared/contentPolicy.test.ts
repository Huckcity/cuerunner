import { describe, expect, it } from 'vitest'
import { RENDERER_CONTENT_POLICY, RENDERER_CONTENT_POLICY_DIRECTIVES as policy } from './contentPolicy'

describe('what the window may load and run', () => {
  it('runs no script that is not one of the app\'s own files', () => {
    // No inline script and no eval: the two ways markup that reached the page could run.
    expect(policy['script-src']).toBe("'self'")
    expect(policy['default-src']).toBe("'self'")
  })

  it('loads nothing from anywhere else', () => {
    for (const [directive, sources] of Object.entries(policy)) {
      expect(sources, `${directive} reaches off the machine`).not.toMatch(/https?:|\*|wss?:/)
    }
    expect(policy['connect-src']).toBe("'self'")
  })

  it('allows nothing of the kinds the app does not use', () => {
    for (const directive of ['object-src', 'base-uri', 'form-action']) {
      expect(policy[directive], directive).toBe("'none'")
    }
  })

  it('is one header\'s worth of text, every directive in it', () => {
    for (const [directive, sources] of Object.entries(policy)) {
      expect(RENDERER_CONTENT_POLICY).toContain(`${directive} ${sources}`)
    }
    expect(RENDERER_CONTENT_POLICY.split('; ')).toHaveLength(Object.keys(policy).length)
  })
})

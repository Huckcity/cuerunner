// Who may open a camera: an output window, for video, and nobody else — and the fake camera a
// development build can be told to use, which a packaged build never reads.
import { describe, expect, it, vi } from 'vitest'

const outputs = new Set<unknown>()
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (contents: { win: unknown }) => contents.win },
  systemPreferences: { askForMediaAccess: vi.fn(async () => true) }
}))
vi.mock('./OutputManager', () => ({ isOutputWindow: (win: unknown) => outputs.has(win) }))

const { allowsMedia, fakeCameraSwitches, installCameraPermissions } = await import('./cameraAccess')

describe('camera access', () => {
  it('grants video to an output window and nothing to anyone else', () => {
    expect(allowsMedia(true, ['video'])).toBe(true)
    expect(allowsMedia(true, [])).toBe(true)
    expect(allowsMedia(true, ['video', 'audio'])).toBe(false)
    expect(allowsMedia(true, ['audio'])).toBe(false)
    expect(allowsMedia(false, ['video'])).toBe(false)
  })

  it('answers the session\'s media requests by the window that asked, and leaves other permissions alone', () => {
    let request: ((contents: unknown, permission: string, callback: (granted: boolean) => void, details: object) => void) | null = null
    let check: ((contents: unknown, permission: string, origin: string, details: object) => boolean) | null = null
    installCameraPermissions({
      setPermissionRequestHandler: (handler: typeof request) => { request = handler },
      setPermissionCheckHandler: (handler: typeof check) => { check = handler }
    } as unknown as Electron.Session)
    const output = { win: 'output' }
    const control = { win: 'control' }
    outputs.add('output')
    const answers: boolean[] = []
    // macOS asks the person at the machine as well; the rule is the same everywhere else.
    if (process.platform !== 'darwin') {
      request!(output, 'media', granted => answers.push(granted), { mediaTypes: ['video'] })
    }
    request!(control, 'media', granted => answers.push(granted), { mediaTypes: ['video'] })
    request!(output, 'media', granted => answers.push(granted), { mediaTypes: ['audio'] })
    request!(control, 'fullscreen', granted => answers.push(granted), {})
    expect(answers).toEqual(process.platform !== 'darwin' ? [true, false, false, true] : [false, false, true])
    expect(check!(output, 'media', 'file://', { mediaType: 'video' })).toBe(true)
    expect(check!(control, 'media', 'file://', { mediaType: 'video' })).toBe(false)
    expect(check!(control, 'clipboard-sanitized-write', 'file://', {})).toBe(true)
  })

  it('adds Chromium\'s fake camera for a development build that asks, and never for a packaged one', () => {
    expect(fakeCameraSwitches(false, {})).toEqual([])
    expect(fakeCameraSwitches(false, { CUERUNNER_TEST_FAKE_CAMERA: '1' })).toEqual([
      ['use-fake-device-for-media-stream'], ['use-fake-ui-for-media-stream']
    ])
    expect(fakeCameraSwitches(false, { CUERUNNER_TEST_FAKE_CAMERA: '/tmp/red.y4m' })).toContainEqual(['use-file-for-fake-video-capture', '/tmp/red.y4m'])
    expect(fakeCameraSwitches(true, { CUERUNNER_TEST_FAKE_CAMERA: '1' })).toEqual([])
  })
})

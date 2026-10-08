import { describe, expect, it, vi } from 'vitest'
import { MAX_STREAM_ORIGINS, StreamAllowance, answerStreamRequest } from './streamProtocol'

describe('the stream scheme', () => {
  it('fetches only from an origin a camera cue named, with that cue\'s login', async () => {
    const allowance = new StreamAllowance()
    allowance.allow('http://admin:se%20cret@cam.local:8080/video.mjpg')
    const fetcher = vi.fn(async () => new Response('frames', {
      status: 200,
      headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'set-cookie': 'nope' }
    }))
    const answer = await answerStreamRequest('cuerunner-stream://http/cam.local:8080/video.mjpg', null, allowance, fetcher)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('multipart/x-mixed-replace; boundary=frame')
    // Shared with the page that draws it into WebGL; nothing else of the camera's is passed on.
    expect(answer.headers.get('access-control-allow-origin')).toBe('*')
    expect(answer.headers.get('set-cookie')).toBeNull()
    expect(await answer.text()).toBe('frames')
    expect(fetcher).toHaveBeenCalledWith('http://cam.local:8080/video.mjpg', {
      headers: { Authorization: `Basic ${Buffer.from('admin:se cret').toString('base64')}` }
    })
  })

  it('passes a range on and the camera\'s partial answer back, so progressive video seeks', async () => {
    const allowance = new StreamAllowance()
    allowance.allow('https://media.local/clip.mp4')
    const fetcher = vi.fn(async () => new Response('part', { status: 206, headers: { 'content-range': 'bytes 0-3/100' } }))
    const answer = await answerStreamRequest('cuerunner-stream://https/media.local/clip.mp4', 'bytes=0-3', allowance, fetcher)
    expect(answer.status).toBe(206)
    expect(answer.headers.get('content-range')).toBe('bytes 0-3/100')
    expect(fetcher).toHaveBeenCalledWith('https://media.local/clip.mp4', { headers: { Range: 'bytes=0-3' } })
  })

  it('refuses an origin no cue named, and says when the camera cannot be reached', async () => {
    const allowance = new StreamAllowance()
    allowance.allow('http://cam.local/video.mjpg')
    const fetcher = vi.fn(async (): Promise<Response> => { throw new Error('ECONNREFUSED') })
    expect((await answerStreamRequest('cuerunner-stream://http/router.local/admin', null, allowance, fetcher)).status).toBe(403)
    expect((await answerStreamRequest('cuerunner-stream://file/etc/passwd', null, allowance, fetcher)).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
    const unreachable = await answerStreamRequest('cuerunner-stream://http/cam.local/video.mjpg', null, allowance, fetcher)
    expect(unreachable.status).toBe(502)
    expect(await unreachable.text()).toContain('ECONNREFUSED')
  })

  it('remembers a bounded number of origins, forgetting the oldest', () => {
    const allowance = new StreamAllowance()
    for (let i = 0; i <= MAX_STREAM_ORIGINS; i++) allowance.allow(`http://cam${i}.local/v`)
    expect(allowance.target('cuerunner-stream://http/cam0.local/v')).toBeNull()
    expect(allowance.target(`cuerunner-stream://http/cam${MAX_STREAM_ORIGINS}.local/v`)).not.toBeNull()
  })
})

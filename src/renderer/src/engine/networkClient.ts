// Network cues used to run on the renderer's `fetch`, which a packaged window cannot do
// without loosening its content policy. Requests now go through the main process; this
// is the small typed face of that bridge, so a request that fails, times out or is
// cancelled is reported the same way wherever it came from.

import type { NetworkRequest, NetworkResult } from '../types/network'

export const network = {
  request: (options: NetworkRequest): Promise<NetworkResult> =>
    window.winslab.network.request(options),
  cancel: (requestId: string): void => {
    // Cancelling happens on stop paths, where the window is often already going away.
    void window.winslab.network.cancel(requestId).catch(() => {})
  }
}

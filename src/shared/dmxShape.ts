// The lighting section of the saved form, field by field: what the load funnel's shape check
// reads a file's `lighting` with. Declared the way the rest of the form's shapes are — the
// `satisfies` binds every field to `LightingSettings`, so a field added to the rig and not
// declared here fails to compile — and kept in a module of its own because the rig is.
//
// Bounds are the patch's own: an address is a slot of a universe, a value is a share of a
// parameter's travel. What the walk cannot say — how many fixtures, which words a protocol may
// be — is `lightingRefusal`'s (`./dmx`), which the funnel asks next.

import type { LightingSettings } from './dmx'
import type { ShapeFields } from './workspaceSections'

export const LIGHTING_SHAPE = {
  fixtures: {
    elements: {
      id: 'string',
      name: 'string',
      typeId: 'string',
      mode: 'string',
      universe: { bounded: [1, 63999] },
      address: { bounded: [1, 512] }
    }
  },
  groups: { elements: { id: 'string', name: 'string', fixtureIds: { items: 'string' } } },
  types: {
    elements: {
      id: 'string',
      name: 'string',
      manufacturer: 'string',
      source: 'string',
      modes: {
        elements: {
          name: 'string',
          channels: { bounded: [1, 512] },
          params: {
            elements: {
              key: 'string',
              label: 'string',
              kind: 'string',
              offset: { bounded: [0, 511] },
              fineOffset: { nothing: true, of: { bounded: [0, 511] } },
              home: { bounded: [0, 1] },
              functions: { absent: true, of: { elements: { name: 'string', from: { bounded: [0, 1] } } } }
            }
          }
        }
      }
    }
  },
  outputs: {
    elements: {
      id: 'string',
      universe: { bounded: [1, 63999] },
      protocol: 'string',
      transport: 'string',
      address: 'string',
      wireUniverse: { bounded: [0, 63999] },
      priority: { bounded: [0, 200] },
      enabled: 'boolean'
    }
  },
  inputs: {
    elements: {
      id: 'string',
      protocol: 'string',
      wireUniverse: { bounded: [0, 63999] },
      universe: { bounded: [1, 63999] },
      merge: 'boolean',
      enabled: 'boolean'
    }
  },
  sync: 'boolean',
  syncUniverse: { bounded: [1, 63999] },
  panic: 'string'
} as const satisfies ShapeFields<LightingSettings>

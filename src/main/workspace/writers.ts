// The writers of saved artifacts, enumerated with what each may do.
//
// Six flows write a saved artifact — save, Save As, merge, bundle export, bundle import
// and the recovery snapshot — and a seventh, the demo, reads one: it writes no showfile
// at all, only copies of the assets that ship with it. Their base, their history
// behaviour and whether they normalise used to live in scattered comments and in the
// spine's prose, where a new writer, or a change to one, could disagree with the others
// with nothing to fail. This is the one place the flows are named in code: the claims are
// data, and `writers.test.ts` drives each row's entry and holds it. The spine's
// "Saved-artifact writers" conventions row still restates these claims — a second copy
// owned by the architecture workflow — and reconciling the two is logged in the
// deferred-work ledger.
//
// The writes that go through `writeFileAtomically` — save, Save As, merge and the
// recovery snapshot — leave the version they replaced beside the file as `<name>.bak`
// (`writeFileAtomically` in `recovery.ts`), so a save that goes wrong still leaves the
// operator a file to open. The other two write differently: export lands its bundle
// through `writeZip`, which puts a temporary file in place with a rename and keeps no
// backup (`zip.ts`), and import writes the bundle's showfile with a plain `writeFile`
// over whatever the collision check and the operator's answer allowed.
//
// The guard in `writers.test.ts` scans this directory's non-test sources for
// content-writing calls and fails on any call site no row's `writes` claims (or the test
// exempts with a reason), so a new writer is a row before it is code.

/** The flows that write a saved artifact, under the enumeration's own identifiers. */
export type SavedArtifactWriterId =
  | 'save'
  | 'save-as'
  | 'merge'
  | 'bundle-export'
  | 'bundle-import'
  | 'recovery'
  | 'demo'

/** The symbol a flow is entered through, as a module in this directory exports it. */
export type SavedArtifactWriterEntry =
  | 'saveWorkspace'
  | 'saveWorkspaceAs'
  | 'mergeIntoNewFile'
  | 'exportBundle'
  | 'importBundle'
  | 'writeRecovery'
  | 'openDemoWorkspace'

/** One writer of a saved artifact, with the behaviour its code keeps today. */
export interface SavedArtifactWriter {
  id: SavedArtifactWriterId
  /** The enumeration's own short name for the flow, not a menu or dialog label. */
  title: string
  /** The symbol the flow is entered through, and the one its row's test drives. */
  entry: SavedArtifactWriterEntry
  /**
   * The module symbols that own this flow's content-write call sites — an artifact write
   * for the six writers, the shipped-asset copies for the demo. They live in any file of
   * this directory, and the guard credits a call site to the top-level declaration it
   * sits in.
   */
  writes: readonly string[]
  /**
   * What the flow's history is the continuation of or claims first (the record's sense),
   * then what the bytes are built from.
   */
  base: string
  /** What the flow does to the history the artifact carries. */
  history: string
  /** What the flow does — or deliberately does not do — to normalise the show on the way out. */
  normalisation: string
}

export const SAVED_ARTIFACT_WRITERS: readonly SavedArtifactWriter[] = [
  {
    id: 'save',
    title: 'Save',
    entry: 'saveWorkspace',
    writes: ['saveWorkspace'],
    base:
      'The file at the destination path, which is also where the bytes go: before anything '
      + 'is serialised, the changed-on-disk check compares it with the bytes main last read '
      + 'or wrote at that path (a path main holds no identity for is not checked — the save '
      + 'dialog named it), and `historyForSave` reads it through the load funnel, the way a '
      + 'load does, to diff the new bytes against. The bytes are built from the window’s document '
      + 'by `serialiseWorkspace`, which rewrites every audio cue’s route against the '
      + 'destination folder — relative when the file lives inside it, absolute when it does '
      + 'not. After the write the identity of the bytes just written is recorded '
      + '(`rememberFile`), which is the baseline the next save checks the disk against.',
    history:
      'The file’s own history is the base: one entry is appended when the diff against the '
      + 'file as the load funnel read it is non-empty, and the file’s history is otherwise carried unchanged. '
      + 'When the file cannot be read, or holds another show (`previous.id !== '
      + 'workspace.id`), the window’s history is carried verbatim — that file has no history '
      + 'of this show’s edits to continue. Capped at 200 entries.',
    normalisation:
      'None on the way out: a save writes what the window built. No grouping repair and no '
      + 'migration are applied to the bytes; the repairs a load makes live in the session '
      + 'until the window saves them.'
  },
  {
    id: 'save-as',
    title: 'Save As',
    entry: 'saveWorkspaceAs',
    writes: ['saveWorkspace'],
    base:
      'The window’s document, saved to the path the operator names in the dialog (no '
      + 'existing path is passed). Where the picked file holds this show it is the base '
      + 'exactly as for a save — read for history and diffed against; where it holds '
      + 'another show, or cannot be read, there is no base beyond the artifact itself and '
      + 'the window’s history is carried. The bytes are `serialiseWorkspace`’s output for '
      + 'the picked file’s folder, with the same audio-route rewrite as a save.',
    history:
      'The same rule as a save, against the picked file: one entry on a non-empty diff when '
      + 'the file holds this show; otherwise the window’s history carried verbatim and '
      + 'nothing appended.',
    normalisation:
      'None on the way out — the bytes a save of this document would write for the same '
      + 'folder.'
  },
  {
    id: 'merge',
    title: 'Merge into a new file',
    entry: 'mergeIntoNewFile',
    writes: ['mergeIntoNewFile'],
    base:
      'Ours’ history, carried verbatim: the merge continues the history of the file being '
      + 'merged into, and the other two files’ entries belong to them. The document itself '
      + 'is built from three files — the open show (ours), the other copy (theirs) and the '
      + 'version the two started from (ancestor), the latter two read through the funnel '
      + 'every load uses. The destination is whatever the save dialog returns, defaulted to '
      + '`<ours name> (merged).cuerunner` beside ours when ours has a path and to the same '
      + 'name in the dialog’s folder when it has none; nothing refuses a destination that is '
      + 'one of the inputs. The bytes are `serialiseWorkspace`’s output for the merged '
      + 'document and the destination folder, with every audio route rewritten against it.',
    history:
      'Ours’ history is carried verbatim and nothing is appended — the merge is not a save '
      + 'of this show. FR50/AD-13 record a different rule: the destination’s own history as '
      + 'the base when it holds this show, the merge recorded as one entry. The code does '
      + 'not keep it, and the divergence is logged in the deferred-work ledger.',
    normalisation:
      'The merge repairs parents as it blends — a merge creates a document rather than '
      + 'round-tripping one — and the grouping repairs either input read made are returned '
      + 'as notes naming their file. The destination is written as serialised; the three '
      + 'inputs are left byte-identical.'
  },
  {
    id: 'bundle-export',
    title: 'Bundle export',
    entry: 'exportBundle',
    writes: ['writeBundle'],
    base:
      'The window’s document, serialised for the bundle’s own folder: every audio cue’s '
      + 'route is the entry the bundle gives its file (`media/<name>`), with the absolute '
      + 'path the file had where it came from recorded beside it. The destination is the '
      + 'operator’s pick in the export dialog, defaulted to `<show name>.cuerunnerx`.',
    history:
      'The show’s history is written into the bundle’s showfile as it stands; nothing is '
      + 'appended — an export is not a save.',
    normalisation:
      'None: the exported document is the window’s document with its media references '
      + 're-pointed at the bundle’s entries. No grouping repair and no migration, and the '
      + 'same document with the same files produces the same bundle.'
  },
  {
    id: 'bundle-import',
    title: 'Bundle import',
    entry: 'importBundle',
    writes: ['unpackBundle', 'extractZipEntry'],
    base:
      'No base beyond the artifact itself: the showfile written out is the bundle’s '
      + '`show.cuerunner` entry, byte for byte, and the media entries are extracted under '
      + 'the folder the operator picks. The workspace handed to the window is that showfile '
      + 'read through the funnel and resolved like any other load.',
    history:
      'Nothing is appended and nothing is rewritten: the exporting machine’s history '
      + 'arrives verbatim with the bytes, and stays until the first ordinary save replaces '
      + 'them.',
    normalisation:
      'The write does not normalise — the bundle’s bytes are what land — while the returned '
      + 'session goes through the same funnel and grouping repair every load path does, '
      + 'its load notes returned with it. This is the one exception to “bytes are a function '
      + 'of (show, folder)”.'
  },
  {
    id: 'recovery',
    title: 'Recovery snapshot',
    entry: 'writeRecovery',
    writes: ['writeRecovery'],
    base:
      'No base beyond the artifact itself: the snapshot is built from the window’s '
      + 'workspace as it stands, plus when it was taken, the path it came from, the selected '
      + 'cue and, when main holds one, the identity of that source file. It is written to '
      + '`userData/recovery.cuerunner`, a machine file, through the same atomic write every '
      + 'save uses.',
    history:
      'The workspace’s own history travels inside the snapshot as it stands; nothing is '
      + 'appended.',
    normalisation:
      'None on the way out, and never through `serialiseWorkspace`: the bytes are '
      + '`JSON.stringify` of the snapshot object. The funnel and the grouping repair happen '
      + 'on the way back in, when the snapshot is read.'
  },
  {
    id: 'demo',
    title: 'Demo workspace',
    entry: 'openDemoWorkspace',
    writes: ['materialiseDemoAssets'],
    base:
      'The shipped file `resources/demo/Demo Show.cuerunner` (the packaged build’s `demo` '
      + 'extra-resource), read through the load funnel into a session with no path of its own — a '
      + 'read-only flow that writes no saved artifact. Its audio — and only its audio — is '
      + 'copied into `userData/demo` and the cues are re-pointed at the copies; the show '
      + 'itself is never written.',
    history:
      'None: the demo has no file of its own, and nothing is appended anywhere.',
    normalisation:
      '`migrateWorkspace` on the way in, like any load — the shape check every other file '
      + 'gets, with the refusal this build answers a file it does not know; the copies under '
      + '`userData/demo` are assets, not a saved artifact, and no showfile is written at all.'
  }
]

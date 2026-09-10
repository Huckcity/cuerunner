import { useStore } from '../../store'
import type { ScriptCue } from '../../types/cue'
import { LastRun } from './LastRun'

const LANGUAGES: ScriptCue['language'][] = ['javascript']

interface Props { cue: ScriptCue }

export function ScriptInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<ScriptCue>) => update(cue.id, patch)

  return (
    <div>
      <div className="field-row">
        <label>Language</label>
        <select value={cue.language} onChange={e => set({ language: e.target.value as ScriptCue['language'] })}>
          {LANGUAGES.map(l => <option key={l} value={l}>JavaScript</option>)}
        </select>
      </div>

      <div className="field-section-title">Script</div>
      <textarea
        className="inspector-code"
        value={cue.script}
        rows={12}
        spellCheck={false}
        placeholder={"await shell('echo hello')"}
        onChange={e => set({ script: e.target.value })}
      />

      <p className="inspector-hint">
        Runs when the cue fires. <code>await</code> works, and the cue holds the show
        until the script finishes. <code>console.log()</code> and{' '}
        <code>console.error()</code> from the script appear in the log panel.
      </p>
      <p className="inspector-hint">
        <code>shell(command, options?)</code> runs a system command and resolves{' '}
        <code>{'{ stdout, stderr, code, signal }'}</code>. Options:{' '}
        <code>timeout</code> (ms, default 10000), <code>cwd</code>, <code>env</code>.
        Commands start in the workspace folder.
      </p>
      <p className="inspector-hint">
        <code>include('path/to/file.js')</code> runs another JavaScript file, resolved
        relative to the workspace file, with the same <code>include</code> and{' '}
        <code>shell</code> available.
      </p>
      <p className="inspector-hint">
        An empty script does nothing and completes immediately.
      </p>

      <LastRun cueId={cue.id} />
    </div>
  )
}

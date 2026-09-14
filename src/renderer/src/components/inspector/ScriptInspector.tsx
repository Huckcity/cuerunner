import { useStore } from '../../store'
import type { ScriptCue } from '../../types/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { SCRIPT_DEFAULTS } from '../../utils/cueDefaults'

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

      <div className="field-row">
        <label>Timeout (ms)</label>
        <NumberField when="typed" min={0} value={cue.timeout}
          onValue={timeout => { if (timeout !== null) set({ timeout }) }} />
        <ResetButton label="Timeout" value={cue.timeout} defaultValue={SCRIPT_DEFAULTS.timeout}
          onReset={() => set({ timeout: SCRIPT_DEFAULTS.timeout })} />
      </div>

      <p className="inspector-hint">
        Runs when the cue fires, on its own worker thread. <code>await</code> works, and the
        cue holds the show until the script finishes. A script that runs longer than the
        timeout — or never finishes at all — is stopped and reported as a failure; 0 waits
        forever. STOP, PANIC, and a stop cue aimed at this one stop it too.
      </p>
      <p className="inspector-hint">
        The script has no access to the interface, only to the helpers below.{' '}
        <code>console.log()</code> and <code>console.error()</code> from the script appear
        in the log panel.
      </p>
      <p className="inspector-hint">
        <code>shell(command, options?)</code> runs a system command and resolves{' '}
        <code>{'{ stdout, stderr, code, signal }'}</code>. Options:{' '}
        <code>timeout</code> (ms, default 10000), <code>cwd</code>, <code>env</code>.
        Commands start in the workspace folder.
      </p>
      <p className="inspector-hint">
        <code>include('path/to/file.js')</code> runs another JavaScript file and resolves
        what that file returned, so a helper file can hand back values. Each file runs once
        per cue, however many times it is included, and an include inside a file resolves
        relative to that file.
      </p>
      <p className="inspector-hint">
        An empty script does nothing and completes immediately.
      </p>

      <LastRun cueId={cue.id} />
    </div>
  )
}

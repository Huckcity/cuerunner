// Winslab UI Kit — TransportBar component
// Exported to window.WinslabTransportBar

function TransportBar({ store }) {
  const { cues, selectedId, running, go, stop } = store;
  const selectedCue = cues.find(c => c.id === selectedId);
  const runningCount = Object.keys(running).length;

  return (
    <div style={transportStyles.bar}>
      <div style={{ flex: 1 }}>
        <span style={{
          fontSize: 11, padding: '3px 8px', borderRadius: 10,
          background: runningCount > 0 ? '#1d3a26' : '#272c33',
          color: runningCount > 0 ? '#4cc36a' : '#8e98a4',
        }}>
          {runningCount > 0 ? `${runningCount} running` : 'idle'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={{ ...transportStyles.btn, background: '#3b424c', color: '#cdd3da' }}
          onClick={stop}
          onMouseEnter={e => e.currentTarget.style.background = '#8e98a4'}
          onMouseLeave={e => e.currentTarget.style.background = '#3b424c'}>
          ■ STOP
        </button>
        <button style={{ ...transportStyles.btn, background: '#1c7a3c', color: '#fff', minWidth: 90 }}
          onClick={go}
          onMouseEnter={e => e.currentTarget.style.background = '#22924a'}
          onMouseLeave={e => e.currentTarget.style.background = '#1c7a3c'}>
          ▶ GO
        </button>
      </div>

      <div style={{ flex: 1, textAlign: 'right', fontSize: 12, color: '#a3adb8' }}>
        {selectedCue && (
          <span><strong style={{ color: '#cdd3da' }}>{selectedCue.number}</strong> {selectedCue.name}</span>
        )}
      </div>
    </div>
  );
}

const transportStyles = {
  bar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: 52, padding: '0 16px', background: '#171a1f', borderTop: '1px solid #2b3038', flexShrink: 0,
  },
  btn: {
    height: 36, padding: '0 20px', border: 'none', borderRadius: 4,
    fontSize: 14, fontWeight: 700, letterSpacing: '0.05em', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'background 0.1s',
  },
};

Object.assign(window, { WinslabTransportBar: TransportBar });

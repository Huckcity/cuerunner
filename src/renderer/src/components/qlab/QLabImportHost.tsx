// The QLab import's dialogs, mounted only while one is up: a modal that is always mounted
// stands the transport keys down whether or not anything is on screen.
import { QLabImportDialog } from './QLabImportDialog'
import { QLabReportDialog } from './QLabReportDialog'
import { useQLabImport } from './qlabImport'

export function QLabImportHost() {
  const stage = useQLabImport(s => s.stage)
  const report = useQLabImport(s => s.report)
  if (stage === 'choose') return <QLabImportDialog />
  if (stage === 'report' && report !== null) return <QLabReportDialog report={report} />
  return null
}

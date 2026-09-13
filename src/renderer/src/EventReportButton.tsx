import { eventReportMarkdown, type EventReportInput } from '../../core/event-report'
import { ReportCopyControl } from './ReportCopyControl'

export function EventReportButton({ input, disabled }: { input: EventReportInput; disabled: boolean }) {
  return <ReportCopyControl label="QAレポートをコピー" description="表示中の出来事・検索条件・参照位置をMarkdownでコピーします。" disabled={disabled}
    text={() => eventReportMarkdown(input, new Date().toISOString())} success={`表示中の${input.events.length}件と検索条件をコピーしました。`} />
}

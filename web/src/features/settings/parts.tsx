// Building blocks of the settings panel: groups (kit Panel look), rows, toggles, steppers, a closed fine-tuning block.
// Rows keep `div.flex-wrap` (e2e specs find a setting by that plus its label).
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { t } from '@/core/i18n'
import { Disclosure, Panel, ROWS, SUB, StepBox } from '@/components/kit'

const DIV = 'divide-y divide-border/50'

export function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Panel title={title}>
      <div className={cn(DIV, title && ROWS)}>{children}</div>
    </Panel>
  )
}

/** Appearance and fine-tuning rows of a long group: closed by default, remembered under `id`. */
export function Fine({ id, sub, children }: { id: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="pb-1.5">
      <Disclosure id={id} title={t('set.fine')} sub={sub}>
        <div className={cn(DIV, ROWS, 'mt-1.5 -mb-1.5')}>{children}</div>
      </Disclosure>
    </div>
  )
}

/** Label + muted sub text left, control right; wraps below on narrow widths (the control itself never wraps). */
export function Row({ label, sub, children, subClass }: { label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; subClass?: string }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
      <div className="min-w-0 flex-[1_1_10rem]">
        <div className="text-[13px] leading-snug">{label}</div>
        {sub && <div className={cn(SUB, 'mt-0.5 leading-snug', subClass)}>{sub}</div>}
      </div>
      {children != null && <div className="flex flex-none items-center gap-1.5">{children}</div>}
    </div>
  )
}

export function Toggle({ label, sub, on, onChange }: { label: React.ReactNode; sub?: React.ReactNode; on: boolean; onChange: () => void }) {
  return <Row label={label} sub={sub}><Switch checked={on} onCheckedChange={onChange} /></Row>
}

export function Stepper({ label, sub, value, onStep, minus, plus }: {
  label: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; onStep: (d: 1 | -1) => void; minus?: boolean; plus?: boolean
}) {
  return (
    <Row label={label} sub={sub}>
      <StepBox value={value} onStep={onStep} minus={minus !== false} plus={plus !== false} />
    </Row>
  )
}

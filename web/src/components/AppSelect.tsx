// Dropdown used everywhere: shadcn Select (Base UI) rendered in-page. Native <select> popups need an activated
// window, and the overlay never takes focus, so they would not open.
import type { LucideIcon } from 'lucide-react'
import { GameIcon } from '@/components/kit'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** `icon`: shown before the label in the list and in the trigger (14 px, muted); `game`: a game icon instead (`icon` = fallback). */
export type Option = { value: string; label: string; icon?: LucideIcon; game?: string }

const Label = ({ o }: { o: Option }) => o.icon || o.game
  ? <span className="flex min-w-0 items-center gap-1.5">
    {o.game ? <GameIcon name={o.game} fallback={o.icon} className="size-4 text-muted-foreground" /> : o.icon && <o.icon className="size-3.5 flex-none text-muted-foreground" />}
    <span className="truncate">{o.label}</span>
  </span>
  : <>{o.label}</>

export function AppSelect({ value, options, onChange, tip, className, size = 'sm' }: {
  value: string; options: Option[]; onChange: (v: string) => void; tip?: string; className?: string; size?: 'sm' | 'default'
}) {
  const icons = options.some(o => o.icon || o.game)
  return (
    <Select value={value} items={options.map(o => ({ value: o.value, label: o.label }))} onValueChange={v => v != null && onChange(String(v))}>
      <SelectTrigger size={size} data-tip={tip} className={cn('min-w-0', className)}>
        {icons ? <SelectValue>{(v: unknown) => { const o = options.find(x => x.value === v); return o ? <Label o={o} /> : null }}</SelectValue> : <SelectValue />}
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-80">
        {options.map(o => <SelectItem key={o.value} value={o.value}><Label o={o} /></SelectItem>)}
      </SelectContent>
    </Select>
  )
}

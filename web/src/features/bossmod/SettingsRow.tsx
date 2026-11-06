// Settings rows of the boss helper: the role, and the dungeon recordings (how many, export as ZIP for new timelines).
import { emit } from '@/core/bus'
import { host } from '@/core/host'
import { t } from '@/core/i18n'
import { U, V, bump, saveUi } from '@/core/state'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/AppSelect'
import { Row } from '@/features/settings/parts'

export function BossRoleRow() {
  return (
    <Row label={t('set.bossRole')} sub={t('set.bossRole.sub')}>
      <AppSelect value={U.bossRole ?? 'auto'} className="w-36" options={['auto', 'tank', 'heal', 'dps'].map(r => ({ value: r, label: t('bm.role.' + r) }))}
        onChange={v => { U.bossRole = v; saveUi(['bossRole']); emit('recompute'); bump() }} />
    </Row>
  )
}

export function BossRecRow() {
  const r = V.bossRecs as { n: number; mb: number } | undefined
  return (
    <Row label={t('set.bossExport')} sub={r ? t('set.bossExport.sub', { n: r.n, mb: r.mb }) : undefined}>
      <Button size="sm" variant="outline" data-boss-export disabled={!r?.n} onClick={() => host({ type: 'bossExport' })}>{t('set.bossExport.btn')}</Button>
    </Row>
  )
}

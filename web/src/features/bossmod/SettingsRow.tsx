// Settings row of the fight recorder: how many recordings there are, export as ZIP (for new timelines).
import { host } from '@/core/host'
import { t } from '@/core/i18n'
import { V } from '@/core/state'
import { Button } from '@/components/ui/button'
import { Row } from '@/features/settings/parts'

export function BossRecRow() {
  const r = V.bossRecs as { n: number; mb: number } | undefined
  return (
    <Row label={t('set.bossExport')} sub={r ? t('set.bossExport.sub', { n: r.n, mb: r.mb }) : undefined}>
      <Button size="sm" variant="outline" data-boss-export disabled={!r?.n} onClick={() => host({ type: 'bossExport' })}>{t('set.bossExport.btn')}</Button>
    </Row>
  )
}

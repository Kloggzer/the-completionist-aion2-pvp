# Design guideline

Design B, "sidebar and tiles". Every new or reworked view follows this file. The building blocks live in
`src/components/kit.tsx`, the tokens in `src/index.css`. Reference pages: `features/daevanion/DaevTab.tsx`,
`features/arcana/ArcanaTab.tsx`.

## Principles

- Answer first. A page opens with the number or the short list the player came for. Details wait in a disclosure.
- Real numbers. Damage, EHP, souls, minutes, Kinah. No scores without a unit, no filler text, no "great job".
- Calm and roomy, but dense enough for a 360 px overlay next to the game.
- One accent. `gold` marks the selection and the one action that matters. Everything else is neutral or a status colour.
- Controls never wrap to two lines. Long labels truncate, the full text goes into the tooltip.
- No capitals for emphasis. Sentence case everywhere, in both languages.
- Icons carry meaning, not decoration. Prefer an icon plus a short label to a long label.

## Page anatomy

```
<Page w="tiles|rows|form" bar={…}>     sticky bar: BarInfo left (drag space), BarRight with filters
  <Hint>                               only when something blocks the answer (login, missing data)
  <KpiRow> 2–4 × <Kpi>                 the answer: real numbers, one line of context each
  <Panel title sub right>              one topic per panel
    ListRow × TopN                     the top few, "n more" behind TopN
  </Panel>
  <Panel><Disclosure>…</Disclosure></Panel>   everything else, closed by default
  <HowTo>                              "how is this computed", always closed
  <Foot>                               data source and date
</Page>
```

- `Page w`: `tiles` (1680 px) for tile grids, `rows` (1400 px) for panels and lists, `form` (760 px) for settings-like forms.
- Two panels side by side from 900 px: `<Columns>` or `grid @min-[900px]:grid-cols-2`. Left column = answer, right = setup.
- KpiRow: 2 columns on the overlay, 4 from 640 px. Never more than 4 tiles. A tile with `onClick` jumps to its list.
- Every Kpi value is a real number with a unit (`12 %`, `4:32`, `3 / 7`). `–` when unknown. `tone` only for status.
- Panels hold short lists. If a list can be longer than 5, it goes through `TopN`.
- Disclosure and TopN remember their state in `U.open` under a stable id (`<page>.<part>`). Ids never change.
- Empty states: `<Empty>` for the whole page, `<Note>` inside a panel. Never an empty panel.

### Map pages (targets, spots, farm)

- Map on top (resizable), then `<ToolbarStrip>`, then the list. From 1100 px content width: map left, toolbar and list right (App.tsx).
- The toolbar holds the page's filters and the view switch. The list below follows the normal anatomy (KpiRow, panels).
- The selection bar (`SelBar`) is sticky at the top of the list and uses tokens like the page bar.
- The canvas draws game art; its colours may be fixed. HTML on top of the map (pills, HUD, tooltip) uses tokens.
  The map section has the `dark` class (App.tsx): the map is dark art in both themes, so its overlays use the dark set.

## Navigation

- Four areas: Today, Pets, Farming, Character (`components/Sidebar.tsx`, `AREAS`). A new page is one entry in `AREAS`.
- From 760 px: sidebar with every page. Below, or with the sidebar collapsed: area icons only, the pages of the
  current area as a `Seg` above the content (`SubNav`). Below 560 px the SubNav shows the icon only for unselected pages.
- An area remembers its last page (`U.lastPage`, written on every navigation). Badges count open items worth acting on
  now only (missing pets, spots, merchant offers to buy); no large standing counts.
- Jump to another page with `goTab(tab, selector)` so the target scrolls into view. No in-page tab bars for pages;
  `PanelTabs` is only for detail areas inside one panel.

## Scale

Root font size is 14 px (`html`), so 1 rem = 14 px. Use the kit constants, not new sizes.

| What | Value | Where |
|---|---|---|
| Outer padding | `px-2.5` | Page content, KpiRow, Panel margin (`mx-2.5`) |
| Text inset | `px-3` | Sect, ROW, Note, Disclosure head |
| Gap | `gap-1.5` | grids, KpiRow, bar items |
| Panel spacing | `mt-2.5` | between panels and hints |
| Row height | `min-h-9` (ROW), `min-h-8` (Disclosure head) | lists |
| Controls | `h-7` (Chip, Seg md, Button sm), `h-6` (Seg sm, AppSelect in bars) | bars, rows |
| Kpi value | 21 px bold, tabular | KpiRow |
| Title | 13 px semibold (`TITLE`) | tiles, row titles |
| Text | 13 px | rows |
| Section / sub | 12 px semibold / 12 px muted (`Sect`, `SUB`) | headers, sub lines |
| Meta | 11.5 px muted, tabular (`META`) | footers, small numbers |
| Badge | 11 px semibold (`BADGE`) | counts, tags. Nothing smaller than 11 px. |

Radius: `rounded-lg` for controls, tiles and Kpis, `rounded-xl` for panels, `rounded-md` inside segmented controls,
`rounded-sm` only for tiny inner marks (rank squares, checkboxes). Shadow: `shadow-(--shadow-card)` on raised blocks only.

## Colour

Tokens only. Views never use hex values, `white`, `black` or Tailwind palette colours (`text-amber-400`). Opacity
modifiers on tokens are fine (`bg-gold/10`, `border-foreground/10`).

| Token | Meaning | Light "Aion Ember" | Dark "Night Indigo" |
|---|---|---|---|
| `background` / `card` / `popover` | page / raised block / floating | parchment | indigo |
| `foreground` / `muted-foreground` / `dim` | text / secondary / off | warm brown | pale indigo |
| `border`, `accent` | hairlines / hover fill | sand | indigo |
| `gold` | **the accent**: selection, the key action, "best" | burnt amber | warm amber |
| `green` | ok, done, gain | olive | mint |
| `red` | bad, loss, overflow | brick | rose |
| `cyan` | info, unlocking, live position | petrol | sky |
| `purple` | a fourth category (soul stones, challenge) | violet | lavender |
| `warn` / `warn-bg` / `warn-line` | attention boxes (`Hint` gold) only | amber on cream | sand on brown |

- `gold` is not yellow and not a warning. In dark mode it is a lighter warm amber. Never use it to mean "medium" or "rare".
- Status colours (`TONE`): ok green, bad red, info cyan, off dim. `TONE.warn` is gold text for "close to a limit".
- Tinted boxes: `BOX.<tone>` (icon columns, badges). Tile borders by traffic light: `ACCENT`.
- Colour never carries meaning alone: pair it with a word, a sign (`+`/`−`) or an icon.
- Exceptions: map canvas and game art; data colours that come from the game data (pet category dots). Document them in a comment.

## Components

| Need | Use | Not |
|---|---|---|
| One of 2–4 short options, always visible | `Seg` (size `sm` in rows) | a row of `CHIP` buttons acting as radios |
| Independent on/off filter | `Chip` | raw `<button className={CHIP}>` |
| One of many, or a dynamic list (class, map, fight, sort) | `AppSelect` (never native `<select>`) | Seg with 6 options |
| A topic with a header | `Panel` | bare `Sect` + rows on the page ground |
| A ranked or scannable list | `ListRow` inside a Panel, `ROWS` hairline above | tiles |
| A collection of peer objects with portrait and progress (pets, achievements) | `TILE` grid via `grid(size)` | rows with portraits |
| More than 5 items | `TopN` (3 on overview pages, 4–5 in panels, 6 tiles; `moreClass="col-span-full"` in a tile grid) | `slice(0, n)` with no way to see the rest |
| Details, inputs, raw tables | `Disclosure` (closed) | always-open sections |
| Settings group | `Group` (Panel look, rows divided), appearance and fine-tuning of a long group in `Fine` (closed Disclosure) | groups of 10+ open rows |
| Explanation of a calculation | `HowTo` | a toggled Hint, a long Foot |
| Detail views inside one panel | `PanelTabs` | separate pages |
| Blocking or important message | `Hint` (gold = attention, cyan = info) | Hint for plain info |
| One muted line (empty, source) | `Note` | dashed boxes |
| Number with −/+ in a row | `Stepper` (`big` adds ±10 from 420 px) | custom buttons |
| −/+ for a formatted value with its own step rule (settings: `85 %`, `120 m`) | `StepBox` | custom −/+ buttons |
| Labelled −/+ in a popover | `MiniStepper` | |
| Frequent +1 on a tile | `StepCol` (tile needs `TILE_P pr-0`) | |
| Alarm toggle on a row or tile | `BellBtn` | |
| Text input | `TextEntry` (focuses itself), `Field` (stays in place; both set host `typing`) | inputs without `typing` |
| Number input in a row (stats, assumptions) | `NumField` (commits on Enter / blur, empty = `null`, placeholder = default) | page-local number inputs |
| Dropdown option with a kind (gathered / dropped, dummy / boss fight) | `AppSelect` option `icon` | text glyphs in labels |
| Rank in a ranked list (spots, routes) | `Rank` | hand-made rank squares |
| Icon-only switch (view, mode) | `Seg iconOnly` (tip = label = aria-label) | rows of icon buttons |
| Seg whose labels do not fit on the overlay | `Seg` with icons and `labelClass="@max-[520px]/main:hidden"` (in a page bar) | a second, shorter set of labels |
| Value read from the game | `AutoBadge` | |
| Section action / link | `SECT_BTN`, `More` | Chip |
| Real action button | shadcn `Button` size `xs`/`sm` | Chip styled as a button |

- Every input must send `host({ type: 'typing', on })` on focus and blur, or the overlay cannot take keys.
  Numeric fields: the shared `NumField` in kit (DaevTab, BuildTab).
- New primitives go into kit.tsx with a one-line doc comment. No page-local copies of kit styles.

## Icons

- lucide-react, plus real game icons where the game has a fitting one (checklist entries, charges, Kinah, classes,
  arcana cards): `GameIcon` / `TileIcon game` with `public/icons/<key>.webp` (`tools/fetch_icons.py`, © NCSOFT) and the
  lucide icon as fallback. Game icons keep their own colours (game art); the tile box keeps the tone. Same sizes as lucide.
  No emoji or text glyphs as icons (`⛏`, `☠`, `🎯`, `☑`, `●`). `✓` becomes `<Check />`.
- Sizes: 14 px (`size-3.5`) in rows, chips, bars and Kpi labels. 16 px (`size-4`) in the sidebar and `ROW_ICON`.
  18 px (`size-4.5`) in bell and step columns and page heads. 28 px stroke 1.5 in tile icon columns (`TileIcon`).
- Icons inherit the text colour. Tint only through a tone (`text-gold`, `BOX.cyan`).
- Icon-only buttons need `data-tip` and `aria-label`.

## Text

- No `uppercase`, no `tracking-wide`, no all-caps strings in i18n (`"Buy"`, not `"BUY"`). Game acronyms stay (PvE, PvP, EHP, DPS).
- Sentence case for titles, buttons and labels in English too ("Show all", not "Show All").
- Numbers: `tabular-nums`, formatted with `fmt(n, digits?)` (locale aware), percent values with `fmtPct()` (one decimal
  from 1 %, two below). No `toFixed` or `toLocaleString(undefined)` in views.
- Units with a space: `12 %`, `60 m`, `5 min`, `1,2 Mio.`. Deltas with a sign: `+3,4 %`, `−1,2 %` (U+2212). Missing value: `–`.
- Percent: one decimal from 1 %, two below. Times: `hm()` for clock time, `m:ss` for countdowns.
- Short. A sub line is one line. A Kpi sub is a few words. Bold parts via `rich()` (`**…**`), never split strings by hand.

## Responsive

- Container queries only (`@min-[…]`, `@max-[…]`), never viewport queries (`max-[420px]:`, `sm:`, `md:`).
  `<Page>` is the container; App has `@container/app` and `@container/main` for frame-level rules.
- Breakpoints (content width):

| px | What changes |
|---|---|
| 360 | the overlay: content ~310 px next to the 48 px icon sidebar. Everything must work here. |
| 420 | Stepper big steps appear |
| 520 | "overlay wide": labels next to icons, settings nav shows text |
| 640 | KpiRow 4 columns |
| 700 | tile portraits appear |
| 760 | full sidebar (`/app`) |
| 900 | 2 columns (Columns, panel pairs), bigger tiles |
| 1100 | map pages: map left, list right (`/main`) |
| 1300 | 3 columns, biggest tiles |

- No horizontal scroll at any width. Flex children get `min-w-0`, text gets `truncate` or `[overflow-wrap:anywhere]`.
- Fixed-width columns (`w-16`) only for numbers; the fixed widths of one row stay below ~200 px.
- Buttons, tabs and menu items are `white-space: nowrap` (index.css). If a label does not fit: hide the label below a
  breakpoint and keep icon plus `data-tip`. A row may wrap its control below the label (settings `Row`); the control itself never wraps.
- Bars wrap as a whole (`flex-wrap`), their items do not.

## Tooltips and accessibility

- `data-tip="…"` on any element; one global `HoverTip` shows it (300 ms, `\n` for lines). No `title` attributes.
- Every truncated text carries its full text in `data-tip`. Every number with a hidden meaning explains it there.
- Empty space in bars carries `data-drag` (window drag). Do not put click handlers on drag space.
- Hit targets at least 22 px. Contrast comes from the tokens; do not lower it with opacity below `/60` for text.
- Clickable rows and tiles show `ROW_CLICK` / `TILE_CLICK` hover and `data-sel="on"` when selected.

## i18n

- Every visible string goes through `t('area.key')`, defined in `de` and `en` in `src/i18n/<area>.ts`
  (or a feature `strings.ts` passed to `addStrings`). Same key set in both languages.
- Keys are prefixed by area (`merch.`, `farm.`, `dae.`). Tooltips end in `Tip`/`.tip`, sub lines in `Sub`/`.sub`.
- Placeholders `{n}`; slots for elements via `rich(t(…), { link: <… /> })`. German first, sentence case.
- No hard-coded words in views ("Kina", "Lv", "dummy"). Game terms in data (mob names) stay as they come.

## Testing hooks

- Tests run in Playwright against a mocked host (`e2e/host.ts`: `openApp`, `fakeState`, `settings`). No real clicks on the game.
- Open pages with `goPage(page, key)` (key or German label, works in narrow and wide windows). Add new pages to
  `PAGE_KEY` and `AREA_OF` there.
- Stable hooks: `data-nav`, `data-area`, `data-on`, `data-sel`, `data-kpis`, `data-disclosure` + `data-open`,
  `data-more`, `data-panels`/`data-panel`, `data-bar`, `data-drag`, and one `data-<thing>="<id>"` per list item
  (`data-pet`, `data-spot`, `data-offer`). Keep existing hooks when restyling; specs depend on them.
- Kit components pass `data-*` through (`Kpi`, `Panel`, `ListRow`, `Chip`, `Stepper`, `Seg item`).
- Screenshots: `page.screenshot({ path: 'e2e/.out/shots/<name>.png' })`, at 360 px and one wide size, light and dark
  (`responsive.spec.ts`, `theme.spec.ts`). Check: no overflow, no wrapped button, no all-caps.

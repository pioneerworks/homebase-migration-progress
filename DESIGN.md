# Design System

## Theme

Light, restrained operations dashboard. The interface inherits the current migration artifact’s Homebase-adjacent orange and purple accents while using the density and familiar interaction patterns of Linear and Vercel.

## Color

Use OKLCH tokens throughout:

- Background: `oklch(1 0 0)`
- Secondary surface: `oklch(0.975 0.006 65)`
- Strong surface: `oklch(0.945 0.012 65)`
- Primary ink: `oklch(0.205 0.035 305)`
- Muted ink: `oklch(0.44 0.028 305)`
- Divider: `oklch(0.89 0.012 305)`
- Progress orange: `oklch(0.72 0.17 65)`
- Link purple: `oklch(0.36 0.16 305)`
- Success green: `oklch(0.55 0.135 152)`
- Warning amber: `oklch(0.65 0.15 75)`
- Danger red: `oklch(0.55 0.16 25)`

Status must never rely on color alone.

## Typography

Use the native system sans stack for speed and familiarity:

`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`

Use tabular numerals for counts and percentages. Use the system monospace stack for URL paths and ticket identifiers. Keep the app scale fixed and compact: 12px metadata, 14px secondary UI, 16px body, 20–28px section headings, and one 40–48px progress statement.

## Layout

- Maximum content width: 1240px.
- Four-point spacing foundation using 4, 8, 12, 16, 24, 32, 48, and 64px.
- Sticky top navigation on desktop; horizontally scrollable section links on narrow screens.
- Progress summary first, active work second, completed URLs and decisions afterward.
- Prefer aligned rows and dividers over repeated floating cards.
- On mobile, collapse multi-column summaries into stacked rows and keep all primary actions at least 44px tall.

## Components

- Progress ring: actual migration percentage, animated only when the value changes.
- Status strip: aligned Done, Active/review, and Remaining counts.
- Pillar rows: progress bar, counts, and source-project link.
- Activity feed: recently changed issues with state, route, timestamp, and Linear link.
- URL inventory: searchable and filterable, with route and Linear ticket links.
- Decision rows: native disclosure controls for summaries.
- Refresh state: timestamp, cached/live indicator, loading skeleton, and recoverable error message.

## Motion

Motion communicates data changes:

- 180–240ms state transitions using ease-out-quart.
- Progress bars interpolate from the previous cached value.
- Newly changed activity rows receive one short highlight wash.
- Active items use a restrained status pulse, never continuous movement across the full row.
- No entrance choreography.
- Under `prefers-reduced-motion: reduce`, replace interpolation and pulses with immediate state changes.

## Accessibility

- WCAG 2.2 AA contrast.
- Visible focus rings and complete keyboard navigation.
- Semantic landmarks, headings, lists, progress labels, and live refresh announcements.
- Search and filters use explicit labels.
- Loading, error, empty, stale, and unauthorized states are understandable without animation or color.

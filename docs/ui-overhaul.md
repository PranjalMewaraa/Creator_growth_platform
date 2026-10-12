# UI overhaul: plan

Written 2026-10-12, for demo 2. The engine is good and the screens are honest; they do not yet
look like something you would pay for. This says what to change, in what order, and what not to
change.

---

## 1. Where we actually are

Worth being precise, because "looks like a school project" is a feeling and feelings are hard
to fix. What produces it here:

|                                                                                  |                                                                                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Seven primitives** — Button, Card, EmptyState, Field/Input/Select, Stat, icons | Every screen invents its own tabs, chips, dialogs, toggles and badges inline. Nine screens, nine dialects. This is the loudest tell      |
| **Loading is a word**                                                            | "Loading…", one `animate-pulse` rectangle, or nothing. The product has three operations measured in minutes and none of them is narrated |
| **No motion**                                                                    | A `transition` on hover and nothing else. Nothing enters, nothing settles, nothing acknowledges a click                                  |
| **Success is silent**                                                            | Errors appear as red text near the bottom. Nothing confirms a thing worked                                                               |
| **One type size doing four jobs**                                                | `text-sm text-muted` is a label, a hint, a body paragraph and a caption                                                                  |
| **Everything is a card in a column**                                             | Studio is a long scroll of controls; Calendar is a wall; Home is four boxes. No screen has a focal point                                 |

What is already good, and should survive: the token set (`canvas / surface / raised / line /
ink / muted / faint / accent / hot / good / bad / ai`), dark-only, the amber accent, the honesty
of the copy, and the fact that every empty state says something true.

---

## 2. Direction

**Keep the identity. Add the discipline.** Dark, amber, plain-spoken. The problem is not the
palette, it is that the palette is applied by nine different hands.

One deliberate rejection: the design-system generator proposed a creator-pink primary on a
paper background with a newsletter landing pattern. Wrong product — this is an authenticated
workspace, not a marketing page — and it would throw away an identity that already works. The
parts of its guidance that do apply are taken below: dark-mode OLED contrast, Plus Jakarta Sans
as a candidate pairing, and the accessibility and motion rules.

The reference style, in a sentence: **a quiet instrument panel that becomes expressive at the
moment work is happening.** Calm by default, alive while generating.

---

## 3. Foundations (WP42)

Before any screen is touched.

**Type scale.** Six steps, named, used everywhere: `display` 32/1.1, `title` 20/1.3,
`subtitle` 16/1.4, `body` 14/1.6, `label` 12/1.4 uppercase, `caption` 11/1.4. Body text at
1.5–1.75 line height; prose columns capped at 68ch.

**Spacing and radius.** A 4px base with a used set of 4/8/12/16/24/32/48. Radius: `sm` 8,
`md` 12, `lg` 16, `full`. No more one-off `rounded-[14px]`.

**Elevation.** Three levels only — flat, raised, floating — each with a defined border and
shadow. Today a dozen shadows exist by accident.

**Motion tokens.** `fast` 150ms, `base` 200ms, `slow` 320ms, all `cubic-bezier(0.2,0,0,1)`.
Transform and opacity only, never width or height. Everything wrapped in a
`prefers-reduced-motion` guard that reduces to opacity-only.

**Z-index scale.** 10 nav, 20 sticky, 30 dropdown, 40 dialog, 50 toast. Written down once.

**Focus.** A single visible focus ring token, used on every interactive element, tested with a
keyboard before merge.

---

## 4. The component library (WP43)

The missing primitives, built once in `@cgp/ui` and adopted screen by screen:

`Dialog` · `Sheet` (mobile dialog) · `Tabs` · `Toast` · `Tooltip` · `Badge` · `Chip` ·
`Skeleton` · `Progress` · `Dropdown` · `Toggle` · `SegmentedControl` · `Avatar` ·
`ScrollArea` · `Field` error/hint slots.

Rules carried into each: 44px minimum touch target, `cursor-pointer` on anything clickable,
hover feedback by colour and never by scale (scale shifts layout), 150–300ms transitions,
`aria-label` on every icon-only control, no emoji as an icon.

---

## 5. The waiting problem (WP44) — the centrepiece

This is the single biggest gap between how the product feels and how good it is, and it is not
decoration. Measured today:

| Operation                | Time     | What the screen says now      |
| ------------------------ | -------- | ----------------------------- |
| Caption or script        | 3–8s     | Streamed text, which is good  |
| One image                | 10–20s   | Nothing                       |
| Storyboard, three frames | **82s**  | Nothing, then frames appear   |
| Reel, three scenes       | **234s** | Nothing, then a video appears |

Four minutes of blank screen is where a product stops feeling like a product. The fix is not a
spinner — it is **narrating work that is genuinely happening**, which we uniquely can do
because the pipeline already reports each step.

**Design: a work ledger.** A panel that lists the real stages and advances through them, each
with its own small state: _Compiling the prompt → Planning three scenes → Drawing frame 1 of 3
→ Drawing frame 2 of 3 → … → Filming scene 1 of 3 → Speaking the voiceover → Cutting the
reel._ Each completed stage collapses to a line with a tick and the seconds it took. The
storyboard frames appear as they are drawn rather than all at the end.

Two honest touches that beat any animation: **the frame that is already drawn is shown while
the next one is drawing**, and when the pacer is waiting on quota the panel says _"waiting for
the picture model — it allows two a minute"_ rather than pretending to work. Telling someone
why they are waiting converts frustration into understanding.

Filler animation, used sparingly and only where work is real: a shimmer on the pending frame
slot, a progress arc on the active stage, a settle animation as each result lands. Infinite
animation only on loading indicators, per the UX rules — never decorative.

**Plumbing already exists:** the worker logs every one of these stages, and `job-stream.ts`
already pushes deltas over SSE for text. Extending that to stage events is a day's work and it
is what makes the rest possible.

---

## 6. Screen by screen

Each screen gets: one job, a focal point, and defined empty / loading / error / success states.

**Home (S-04).** Job: what needs attention. Keep the seven-day strip as the hero — it is the
best thing on the screen — but make it the full width of the page, make each day a real target,
and move balances to a quiet header row. Needs-attention items become the second block, with
the count in the page title. Empty: a single primary action, not four cards.

**Studio (S-10/11/12).** Job: say what you want, see what it will cost, get it. Today it is one
long column of controls. Restructure as a **three-pane workbench**: generator and intent on the
left, the compiled prompt disclosure in the middle (it is the product — give it room), output
on the right. The look controls (WP37) become a collapsed "Look" row that expands, not four
rows of chips. Cost sits next to the submit button, always.

**The compiled prompt disclosure** deserves its own treatment: it is step 2 of the demo and the
thing nobody else has. Syntax-highlight the requirement lines, show each setting's source on
hover (`template` / `profile` / `you`), and animate the diff when a control changes it. That is
the moment the engine becomes visible.

**Storyboard → reel.** The approval flow is the product's best idea and currently looks like a
grid of pictures. Make it a filmstrip: frames in a row, each with its scene text beneath,
each individually regenerable, with a persistent "Film these three · 24s · ₹63" bar.

**Composer (S-13).** Already the strongest screen. Needs: the platform preview tabs to look
like the platforms, the schedule control to use a proper date-time picker rather than a native
input, and a success state that is not just text changing.

**Calendar (S-07).** Job: maintain the schedule. Add a month view, drag to reschedule, and
make the empty-slot affordance visible rather than hover-only — it is invisible until you
happen to move the mouse over it.

**Sync centre (S-20)** and **Insights (S-21).** Both are honest and plain. They need the
component library and little else: real badges, a proper table, and sparklines in Insights.

**Accounts (S-03/19).** Fine. Capability limits as a definition list rather than bullet dots.

---

## 7. Flows worth designing properly

1. **First run.** Sign in → onboarding (eight questions) → brand kit → first generation. Today
   this is a wall of forms. One question per screen, each answer visibly configuring something
   on the right, a progress indicator, and a skip that is honest about what breaks.
2. **Make a reel.** Intent → look → storyboard → approve/regenerate → film → review. This is
   the demo. It should feel like one continuous flow, not six screens.
3. **Schedule and publish.** Output → composer → platforms → time → sync centre. The handoff
   from Studio to composer (WP33) exists; it should _feel_ like a handoff, with the picture
   visibly carrying across.
4. **Something failed.** Sync centre → read the platform's words → reconnect or retry. Already
   good; needs the component library.

---

## 8. What not to do

- Do not add a light mode. Dark-only is a decision in `plan.md`, and a half-done light mode is
  worse than none.
- Do not animate decoratively. Infinite motion is for loading indicators only.
- Do not replace the amber accent. It is the product's one memorable visual fact.
- Do not use scale transforms on hover — they shift layout and read as cheap.
- Do not let the overhaul touch the engine, the ledger or the adapters. This is a view-layer
  change and should stay one.

---

## 9. Sequence

| WP   | Scope                                                                                     | Size     |
| ---- | ----------------------------------------------------------------------------------------- | -------- |
| WP42 | Foundations: type scale, spacing, radius, elevation, motion tokens, z-index, focus ring   | 1 day    |
| WP43 | Component library: the fifteen missing primitives                                         | 2–3 days |
| WP44 | The work ledger: stage events over SSE, the waiting panel, progressive frames             | 2 days   |
| WP45 | Studio as a workbench, including the compiled prompt disclosure                           | 2 days   |
| WP46 | Storyboard filmstrip and the film bar                                                     | 1 day    |
| WP47 | Home, Calendar, Composer, Sync centre, Insights adopt the library                         | 2 days   |
| WP48 | First-run flow                                                                            | 1–2 days |
| WP49 | Accessibility and responsive pass at 375 / 768 / 1024 / 1440, keyboard walk of every flow | 1 day    |

Roughly **two weeks**. WP42 to WP44 are the ones that change how the product feels; if only
three get built, build those.

---

## 10. Definition of done

Per the skill's checklist, and non-negotiable before any screen ships:

- [ ] No emoji used as an icon; one icon set throughout
- [ ] `cursor-pointer` on everything clickable; hover feedback by colour, not scale
- [ ] Transitions 150–300ms; `prefers-reduced-motion` respected everywhere
- [ ] Visible focus ring on every interactive element; tab order matches visual order
- [ ] Text contrast ≥ 4.5:1 against its actual background, measured not guessed
- [ ] Every async operation has a skeleton or a narrated state; no frozen UI
- [ ] Every empty state says what to do next
- [ ] No horizontal scroll at 375px; no content behind fixed elements
- [ ] Icon-only buttons carry `aria-label`; inputs carry labels

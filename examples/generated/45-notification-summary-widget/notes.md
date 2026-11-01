# Notification summary widget: eval notes (prompt 45, run 2)

Final document: `notifications.json` (made by `gen.py`), converted to `notifications.rc` (15,434 bytes).
Saved tool outputs: `01-list.txt` … `18-convert-final.txt`. Renders are in `out/`.

## 1. Tool calls in order

0. `list`: lists the servers and tools. I took the workflow from it (build_kit, then check_component, convert, render, audit). Next I called build_kit.
1. `build_kit` with the goal verbatim: it returned Badge (count, max 99, "99+") and Icon, plus icon suggestions for mail and calendar. Its two examples, TIM-08 (countdown) and TIM-12 (sunrise), don't fit this goal. I kept Badge and Icon and ignored the examples.
2. `get Badge` (definition + demo_json): I wanted to see how `max` and the visibility switch work (`step(@count,@max)`) and the local/visibility pattern. I copied that pattern for my own zero/non-zero switch.
3. `reference query` (host action, semantics): from it I learned `hostNamedAction`, the semantics modifier with a textMerge contentDescription, and the advice to give each control its own action name (U58). I used openMail, openMessages and openCalendar.
4. `reference query` (host string, visibility): from it I learned the root-level `variable` command for host strings, and that visibility needs a declared 0/1 variable. I used both.
5. `check_component IconBadge` with a sweep 0/1/12/99/100/1000: every cell was right. 0 shows an outlined grey icon with no badge, 99 shows "99", and 100 or more shows "99+". The mono render was fine. I kept the component.
6. `convert check:true`: OK, 15.4 KB, 6 click targets, and it listed the host variables. I went on to render.
7. `render variants:true`: the 4x2, 4x1, dark, light and mono renders were good. At 2x2 the "Notifications" title collided with the summary, and the detail strings were clipped hard. I added `overflow: ellipsis` and hid the title below 200 dp wide.
8. `render samples` (5 sets including long strings, at the default 320x160): 0/0/0 shows "All caught up" and "No new" in every row, the caps work, and long strings get ellipses. All good.
9. `render samples + sizes + sheet` (320x80, 160x160): only 8 cells came back. Sample 5 was dropped silently, and the captions don't say which sample is which. The finding: at 4x1, "All caug…" was truncated. I let that text wrap to 2 lines.
10. `inspect accessibility` (150/0/12): the screen reader hears "Mail, 150 unread", "Messages, 0 unread" and "Calendar, 12 unread". I kept "0 unread" (see weak spots).
11. `inspect interact` with taps at 4x1: the host_actions were openMail and openCalendar, which is correct.
12. `audit`: it reported dead code. The NotifTile locals `has`/`none` were unused, so I removed them. It also flagged 40 dp touch targets at 4x2 (info), which I accepted.
13. `inspect runtime`: idle, nothing repaints.
14. `convert` (final check): OK.
15. `render variants` at 0/0/0: the "small 230x96" variant was broken. That size got the column layout, so the icons were squashed and "No new" overlapped the labels. I changed the layout switch so that height < 120 also uses the tile row, and the summary in the tile row is hidden below 260 dp wide.
16. `render variants` (3/0/150): every variant was OK, including 230x96 and 160x96.
17. `convert` (final): 15,434 bytes, ok.

That makes 17 remotecompose calls, plus the `list`.

## 2. Dead ends and wasted calls

- None were fully wasted. Call 14 duplicated call 17, so one convert would have been enough.
- About half the build_kit output went to the TIM-08 and TIM-12 examples, which are not relevant. The word "calendar" was resolved to `time.date`. A use-case match on "notification/unread/inbox" (the CMP-04 chips/badges gallery) would have helped more.
- My first layout switch only looked at the aspect ratio, which broke 230x96. I found that in call 15, not earlier, because at the first variants render (call 7) I only opened 5 of the 11 PNGs. One combined contact sheet for `variants` would have avoided that.

## 3. Wrong, misleading, noisy or missing in the tool output

- build_kit: `"calendar" → "capability:time.date"`. It then offers a countdown and a solar almanac with offsetToUtc pitfalls, which is noise for an "unread counts" widget. `unmatched_terms: ["mail","message"]`, but "messages" got no icon suggestion, even though "chat"/"sms" are obvious ones.
- build_kit `not_covered`: "calendar arithmetic". That is irrelevant here.
- render `samples` + `sizes`: 5 samples × 2 sizes gave "contact sheet: 8 renders" with no warning. Sample 5 (the long strings) was silently dropped. The sheet captions only say "size-320x80", not the sample, so you can't tell which cell is which state without the text log.
- render `variants:true` writes 11 separate PNGs and no sheet. That makes it easy to skip some, and I did.
- inspect interact: `"effect": "the input changed the document"`, while `changed_variables_total: 0` and `layout_changes.changed: 0`. The only effect was host actions. It also said `"repaint": "continuous at the last step"`, but inspect runtime says idle. Both are misleading.
- inspect accessibility: the hidden or visible "No new" text has `h: 0.39`, and the "12" badge text is `w: 6.89`. These look like TS-engine measurement artefacts (or mid-animation states), and nothing explains them.
- The audit touch-target finding (40 dp rows in a 160 dp tall widget) gives no hint about how to reach 48 dp in a 4x2 widget with a header. That is a real conflict between the size and the guideline.
- Badge `max` semantics: the doc says "the largest count shown". That matches the render (99 shows "99"), but the definition's `step(@count, @max)` reads as ≥ to anyone who learned `step` from the reference ("step(@days, 0.5)" = days ≥ 0.5). One of the two is misleading. I had to sweep to find out which.

## 4. What I would have liked

- A notification/unread-count example (icon + badge + label, tappable, labelled) in build_kit, instead of time examples.
- An IconBadge-style library component (icon with badge, zero state), since "icon with a count badge" is a very common need. The Badge pitfall describes how to build it but doesn't provide it.
- `variants` and `samples×sizes` contact sheets that caption every cell with both the size and the sample, and that never drop cells silently (or that say "capped at 8").
- A way to switch a contentDescription by state ("no unread" vs "3 unread") without duplicating the semantic node. A TextChoice-like recipe in the a11y paragraph would do.

## 5. Honest assessment

- **Correctness:** three items (Mail / Messages / Calendar), each with a Material icon. Above 0, the icon is filled in the primary colour with a red Badge showing the count, capped at "99+" (verified at 99, 100, 150, 1000). At 0, the icon is outlined and muted with no badge, and the row reads "No new", so zero differs by shape and text, not only by colour. The header total reads "N unread". When everything is 0, it shows a done_all icon and "All caught up". The total is not capped ("1150 unread"); I chose to keep it truthful.
- **Host variables:** `mail` 3, `messages` 27, `calendar` 2 (floats, exported), and host strings `mailFrom`, `messageFrom`, `nextEvent`, which appear as the second line of each row in the column layout. Those lines are ellipsized and verified with very long strings at 320x160. Long strings were not verified at 160x160, because the sample was dropped, but the same ellipsis applies.
- **Taps:** each item sends its own host action (openMail, openMessages, openCalendar). This was verified with inspect interact.
- **Sizes:** a stateLayout picks between two layouts. Wide (w ≥ 3h) or short (h < 120) gets the tile row: summary, then three icon+label tiles; the summary is hidden below 260 dp. Everything else gets the column layout: a header ("Notifications" plus the total; the title is hidden below 200 dp) and three rows. I checked 4x1 320x80, 2x2 160x160, 4x2 320x160, 230x160, 512x120, 320x96, 230x96 and 160x96. At 160x96 the tile labels ellipsize ("Mess…", "Calen…").
- **Themes and mono:** only theme colours are used. Light, dark, mono-dark and mono-light all render correctly. In mono, the badge is drawn as a white or black disc.
- **Accessibility:** each clickable item has the semantics label "Mail, 3 unread" with the real uncapped count. The weak spot is that zero is read as "Messages, 0 unread" rather than "no unread". The document has a contentDescription. Child texts ("Mail", "99+") are separate nodes, so a reader may announce them as well as the merged label. At 4x2 the rows are about 40 dp tall, under 48 dp (audit info).
- **Bytes:** 15.4 KB. Most of it is the 7 icon paths (3 icons × filled/outlined + done_all) and the two layouts × 3 component calls. There are no pattern templates, because "the body calls another component".
- **Weak spots:** the 4x1 summary is plain text with no visual. The zero state in the tile row (4x1) has no "No new" text, only the outlined icon and the missing badge. The badge overlaps the icon's corner slightly. Nothing was verified on a real device; this is renderer-only.

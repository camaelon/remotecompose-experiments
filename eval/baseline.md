# Baseline prompts

A fixed set, one or more per structure, each run twice by a fresh agent with no scripts, to judge a
change against run-to-run noise. Compare output tokens per run (eval/run-tokens.py), calls, faults
left in the result. They are from docs/structures/labels.json and fresh-labels.json.

1. data-rows: A notification summary widget: unread counts for mail, messages and calendar with icons.
2. hero-chart: A solar panel widget: power produced now, today's production curve, and money saved.
3. focal-actions: A music player screen: album art placeholder, title and artist, progress you can scrub, play/pause, previous/next, shuffle and repeat.
4. meter-breakdown: A calorie tracker: calories eaten vs target as a ring, and macros (protein, carbs, fat) as bars.
5. form-result: A tip calculator: bill amount, tip percentage chips (10/15/20%), split between N people, and the result.
6. panel-stack: A recipe card: title, cooking time, servings you can adjust (scaling ingredient amounts), and steps.
7. step-explainer: Explain how a binary search works on a sorted list of 15 numbers: pick the target, then step through each comparison.
8. glance-card: A watch tile showing the next calendar event, its time and location.

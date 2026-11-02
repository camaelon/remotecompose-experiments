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

The brief is part of the measurement: the same commit cost about 16K with the wording below and about 24K with a stricter one. Use it word for word:

    Usability evaluation of the RemoteCompose MCP tools. Carry out the request using only those tools, as any connected assistant would.

    Folder (create it, cd into it in every command, paths are relative to it): <folder>
    Calls: RC_HIDE_GENERATED=<prompt number> node <repo>/eval/mcp-cli.mjs list | describe remotecompose <tool> | call remotecompose <tool> '<json>' (or @file.json). Use the remotecompose server only. Images are saved under ./out/; open them with Read. Do not read the repository. Do not edit outside your folder. Do not call publish or pages. No scripts or generators; exactly one tool call per shell command.

    The request, as the user wrote it: <prompt>

    Leave a brief notes.md (calls, dead ends, what misled you, final files). Final message, briefly: absolute paths of the final JSON and contact sheet, calls, dead ends, .rc bytes, what is still wrong and unverified.

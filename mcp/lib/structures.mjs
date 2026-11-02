// Recurring screen structures, whatever their subject (docs/structures/): what a request is
// shaped like decides which example is a useful place to start. Words in a request are weak
// evidence, so the kit also lists every structure and lets the caller overrule the guess.

/** Most specific first: on a tie the earlier one wins. Examples: the best start first. */
export const STRUCTURES = [
    { id: "map-overlay", is: "a map filling the screen, with points, routes or coloured regions and a small panel over it",
      adapts: "the panel moves or drops when short", examples: ["MAP-05", "MAP-03", "MAP-04", "MAP-01", "MAP-02"],
      signals: [[/\b(maps?|world map|globe|on the map)\b/, 5], [/\b(countries|continent|map of)\b/, 3]] },
    { id: "step-explainer", is: "a title, a big visual that changes with the step, step dots, a caption and back/play/next",
      adapts: "the visual sits beside the caption when wide, the caption shortens when short", examples: ["CMP-16", "INT-06"],
      signals: [[/\b(explain|explains|explainer|walkthrough|tutorial|onboarding|visual guide|teach|lesson)\b/, 5], [/\bhow (a|an|the)\b.*\b(works?|pumps?|moves?|flows?)\b/, 4], [/\bsteps? (you can|through)|step through|through (the|each) steps?\b/, 4], [/\bstep[- ]by[- ]step\b/, 4]] },
    { id: "param-explorer", is: "a big preview or chart driven by a few sliders, with the result as a readout",
      adapts: "controls move beside the preview when wide", examples: ["CMP-03"],
      signals: [[/\bsliders?\b/, 4], [/\b(picker|playground|simulator|explorer|try different|what if|adjust the)\b/, 3], [/\bshow how\b/, 1]] },
    { id: "journey-card", is: "an ordered trip or process: stages or two endpoints with a progress line, the current one highlighted, and key facts",
      adapts: "secondary facts drop when short, the line stays", examples: [], components: ["Steps", "LabelValue"],
      signals: [[/\b(flight|boarding|itinerary|journey|trip|shipment)\b/, 3], [/\b(package|parcel|delivery|order) (delivery )?(tracker|status)\b/, 4], [/\bprogress line\b/, 3], [/\bthe steps\b.*\bcurrent\b/, 4]] },
    { id: "form-result", is: "labelled inputs, choices and a main action, with a result where there is one",
      adapts: "scrolls when short; the result stays visible", examples: ["CMP-12", "EXP-15"],
      signals: [[/\b(login|log in|sign[- ]?in|sign[- ]?up|register|form|fields?|checkout)\b/, 4], [/\b(calculator|converter|quiz)\b/, 4], [/\bbutton\b/, 1]] },
    { id: "control-rows", template: "RowList", is: "uniform rows, each with its own control: a checkbox, a switch or a slider",
      adapts: "rows drop their subtitles, a count stays", examples: ["CMP-18", "CMP-14", "CMP-05"],
      signals: [[/\b(to-?do|checklist|check off|shopping list|settings|preferences|toggles?|mixer|smart home|habit)\b/, 5], [/\bswitch(es)?\b/, 2], [/\b\w+, \w+,? (and|or) \w+ (sliders?|switch(es)?|toggles?)\b/, 5]] },
    { id: "focal-actions", is: "one big central element with a readout under it and a row of actions",
      adapts: "the element shrinks, then only the readout and the actions stay", examples: ["CMP-19", "TIM-14", "INT-08"], components: ["TransportControls", "SeekBar", "CoverArt"],
      signals: [[/\b(player|timer|stopwatch|pomodoro|metronome|counter)\b/, 4], [/\bplay\/pause|start\/pause|start and stop|you can (tap|add|scrub)\b/, 3], [/\b(tap to add|tracker with)\b/, 2]] },
    { id: "meter-breakdown", is: "a main ring, gauge or donut with its value, beside the parts that make it up",
      adapts: "parts move beside or under the meter, then drop", examples: ["CMP-23", "CMP-24", "CMP-08", "CMP-07"], components: ["MeterBreakdown"],
      signals: [[/\b(ring|donut|gauge|doughnut|pie|meter)\b/, 4], [/\b(macros|share of|breakdown|vs target)\b/, 2]] },
    { id: "hero-chart", is: "one big value with a caption, a chart filling the rest, then a few stats",
      adapts: "stacked when tall, value beside chart when wide, stats drop when short", examples: ["CMP-17", "CMP-21", "TIM-12"],
      signals: [[/\b(charts?|graph|curve|plot|histogram|bar chart|share price)\b/, 4], [/\bsparkline\b/, 2], [/\b(over the (day|week|year)|next \d+ hours|by hour|history|trend|position over)\b/, 3], [/\bbig number\b/, 2]] },
    { id: "data-rows", template: "RowList", is: "an optional summary, then uniform rows from data: a mark, a title, a value, perhaps a small bar",
      adapts: "rows while tall, subtitles and header drop when short, tiles when wide", examples: ["CMP-18", "CMP-15", "CMP-07", "CMP-05"],
      signals: [[/\b(list|rows?|table|leaderboard|schedule|timetable|agenda|departures?|arrivals|inbox|ticker|summary widget|status dashboard)\b/, 3], [/\b(each with|per (category|item|person|team|account|project|service)|for each)\b/, 5], [/\b(\d+|two|three|four|five|six|seven|eight|nine|ten) [a-z]+s\b.*:/, 5], [/\bfor (\d+|two|three|four|five|six|seven|eight|nine|ten) [a-z]+s\b/, 5], [/\b(unread counts?|progress bars|as bars)\b/, 3], [/\b(london|tokyo|sydney)\b.*\band\b/, 2]] },
    { id: "panel-stack", is: "a scrolling or stacked set of different sections, each its own small panel",
      adapts: "panels drop by priority when short, columns when wide", examples: ["CMP-14", "CMP-12"],
      signals: [[/\b(dashboard|overview|daily|recipe|profile|article|details? (screen|page)|home screen)\b/, 2], [/\b(sections?|panels?)\b/, 3]] },
    { id: "glance-card", is: "one main value or drawing and one to three supporting lines",
      adapts: "lines drop by priority, stacked when narrow or square", examples: ["TIM-08", "HST-07", "LAY-09"],
      signals: [[/\b(widget|tile|complication|glance|card|badge)\b/, 1], [/\bcountdown|days until|next (event|meeting|full moon)\b/, 2]] },
];

// For measuring what templates save: RC_HIDE_TEMPLATES=1 leaves them out of a kit.
export const HIDE_TEMPLATES = Boolean(process.env.RC_HIDE_TEMPLATES);

/** The structure a request looks like, or null. Scores are the weights of the signals found. */
export function classifyStructure(goal) {
    const g = String(goal).toLowerCase();
    let best = null;
    for (const s of STRUCTURES) {
        const score = s.signals.reduce((n, [re, w]) => n + (re.test(g) ? w : 0), 0);
        if (score > 0 && (!best || score > best.score)) best = { structure: s, score };
    }
    return best;
}

// For measuring what the menu saves: RC_NO_STRUCTURE_MENU=1 leaves it out of the description.
export const NO_MENU = Boolean(process.env.RC_NO_STRUCTURE_MENU);

/** The structures, one line each, for a tool's description: read before any call is made. */
export function structureLines() {
    return STRUCTURES.map((s) => `${s.id}: ${s.is}`).join("; ");
}

/** The structure menu a kit carries, so the caller can correct the guess. */
export function structureMenu(exists = () => true) {
    return STRUCTURES.map((s) => {
        const start = s.examples.filter((id) => !(HIDE_TEMPLATES && id === "CMP-18")).find(exists);
        return { id: s.id, is: s.is, adapts: s.adapts, ...(s.template && !HIDE_TEMPLATES ? { template: s.template } : {}), ...(start ? { start_from: start } : {}) };
    });
}

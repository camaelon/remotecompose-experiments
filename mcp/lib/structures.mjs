// Recurring screen structures, whatever their subject (docs/structures/): what a request is
// shaped like decides which example is a useful place to start. Words in a request are weak
// evidence, so the kit also lists every structure and lets the caller overrule the guess.

/** Most specific first: on a tie the earlier one wins. Examples: the best start first. */
// components: offered when the caller chooses the structure. core: also when it is only guessed from the words.
export const STRUCTURES = [
    { id: "map-list", template: "MapList", is: "places as numbered markers on a map plus a list of the same places (name, a detail, a distance or rating): tapping a row highlights its marker, tapping a marker selects its row",
      adapts: "map on top (about 42% of the height) and the list under it on a phone or portrait tablet; from 600 dp and landscape the list is a 280-360 dp side panel on the left and the map fills the rest", examples: ["CMP-47", "CMP-48"], core: ["MapList"], components: ["WorldMap", "Icon"],
      signals: [[/\b(store|shop|branch|dealer|office|location)s? (locator|finder)\b|\bfind (a|the nearest) (store|shop|branch)\b/, 7], [/\b(list of (places|locations|stores|offices|stops|venues)|locations? list|places list|map (and|with) (a )?list|list (and|with|beside|next to|under) (a |the )?map)\b/, 6], [/\b(nearby|near me|closest|stores|shops|branches|offices|venues|stops)\b.*\b(map|pins?|markers?)\b|\b(map|pins?|markers?)\b.*\b(nearby|stores|shops|branches|offices|venues|stops)\b/, 5], [/\b(numbered (pins|markers)|road trip|itinerary map|trip stops)\b/, 4]] },
    { id: "map-overlay", is: "a map filling the screen, with points, routes or coloured regions and a small panel over it",
      adapts: "the panel moves or drops when short", examples: ["MAP-05", "MAP-03", "MAP-04", "MAP-01", "MAP-02"],
      signals: [[/\b(maps?|world map|globe|on the map)\b/, 5], [/\b(countries|continent|map of)\b/, 3]] },
    { id: "step-explainer", is: "a title, a big visual that changes with the step, step dots, a caption and back/play/next",
      adapts: "the visual sits beside the caption when wide, the caption shortens when short", examples: ["CMP-27", "CMP-28", "CMP-29", "CMP-16", "INT-06"], core: ["StepExplainer"],
      signals: [[/\b(explain|explains|explainer|walkthrough|tutorial|onboarding|visual guide|teach|lesson)\b/, 5], [/\bhow (a|an|the)\b.*\b(works?|pumps?|moves?|flows?)\b/, 4], [/\bsteps? (you can|through)|step through|through (the|each) steps?\b/, 4], [/\bstep[- ]by[- ]step\b/, 4]] },
    { id: "param-explorer", is: "a big preview or chart driven by a few sliders, with the result as a readout",
      adapts: "controls move beside the preview when wide", examples: ["CMP-03"],
      signals: [[/\bsliders?\b/, 4], [/\b(picker|playground|simulator|explorer|try different|what if|adjust the)\b/, 3], [/\bshow how\b/, 1]] },
    { id: "journey-card", is: "an ordered trip or process: stages or two endpoints with a progress line, the current one highlighted, and key facts",
      adapts: "secondary facts drop when short, the line stays", examples: [], components: ["Steps", "LabelValue"],
      signals: [[/\b(flight|boarding|itinerary|journey|trip|shipment)\b/, 3], [/\b(package|parcel|delivery|order) (delivery )?(tracker|status)\b/, 4], [/\bprogress line\b/, 3], [/\bthe steps\b.*\bcurrent\b/, 4]] },
    { id: "comparison", template: "Comparison", is: "two to four options (plans, phones, laptops) compared on the same rows: each a card with name, price and a choose button, values or ticks and crosses aligned per row",
      adapts: "a table with the options as columns from about 552 dp (3 options) or 692 dp (4), the header kept while rows scroll, the featured column tinted; narrower, two options side by side on the same rows, each with a picker; notes drop when short",
      examples: ["CMP-51", "CMP-52"], core: ["Comparison"], components: ["Badge", "Button", "Icon"],
      signals: [[/\b(compar(e|ison|ing)|side[- ]by[- ]side|versus|vs\.?|head[- ]to[- ]head)\b/, 3], [/\b(pricing (table|page|plans?)|plan picker|choose (a|your) plan|subscription (plans|tiers)|most popular)\b/, 6], [/\b(spec(s|ification)? (sheet|table|comparison)|feature (matrix|table|comparison)|comparison table|ticks? and crosses|checks? and crosses)\b/, 5], [/\b(free|basic|standard|plus|pro|premium|family)\b.*\b(plans?|tiers?)\b/, 3], [/\bcompare\b.*\b(phones|laptops|cars|plans|products|options|models)\b/, 3]] },
    { id: "form-result", is: "labelled inputs, choices and a main action, with a result where there is one",
      adapts: "scrolls when short; the result stays visible", examples: ["CMP-25", "CMP-12", "EXP-15"], core: ["InputsResult", "ChoiceChips", "Stepper"],
      signals: [[/\b(login|log in|sign[- ]?in|sign[- ]?up|register|form|fields?|checkout)\b/, 4], [/\b(calculator|converter|quiz)\b/, 4], [/\bbutton\b/, 1]] },
    { id: "chat", template: "ChatThread", is: "one conversation: message bubbles (yours on the end side in the primary colour, theirs on the start side with names and avatars), day separators, times, read status, and a composer row with a send button",
      adapts: "anchored to the latest message and scrolls back with a drag; bubbles wrap at ~78% (520 dp max); the thread centres at 920 dp; from 720 dp an optional chat list shows at the start", examples: ["CMP-53", "CMP-54"], core: ["ChatThread"], components: ["Avatar", "IconButton", "Icon"],
      signals: [[/\b(chat|chats|chatting|group chat|messenger|whatsapp|imessage|telegram|sms thread|text messages?|conversation (screen|view|thread)|message thread|chat bubbles?|speech bubbles)\b/, 6], [/\b(chat ?bot|support chat|live chat|help chat|assistant chat|virtual agent)\b/, 6], [/\b(quick replies|suggested replies|typing indicator|is typing|read receipts?|seen by|message (field|box|composer))\b/, 4], [/\b(bubbles?)\b.*\b(right|left|mine|theirs)\b/, 4]] },
    { id: "board-columns", template: "Board", is: "a kanban board: columns (stages) with a title and a count, holding cards with a tag, a title, an assignee and a date or value",
      adapts: "one column under tabs with counts on a phone; from 600 dp all columns side by side (240 to 340 dp), centred, scrolling sideways when they do not fit", examples: ["CMP-49", "CMP-50"], core: ["Board"], components: ["Avatar", "IconButton"],
      signals: [[/\b(kanban|trello|scrum board|sprint board|task board|swim ?lanes?)\b/, 6], [/\b(pipeline|funnel) (board|view|stages)|\b(sales|hiring|recruiting|deal) pipeline\b/, 5], [/\bto ?do,? (\/ )?in progress,? (and |\/ )?done\b/, 6], [/\b(columns? of cards|cards? in columns|move[sd]? (it|the card|a card) to the next (column|stage))\b/, 5], [/\b(stages?|columns?)\b.*\bcards?\b/, 2]] },
    { id: "list-detail", template: "ListDetail", is: "a master list and the selected item's detail: one pane with a back arrow on a phone, list and detail side by side when wide",
      adapts: "one pane under 600 dp (tap opens, back returns), two panes from 600 dp with the selected row highlighted and the detail changing in place", examples: ["CMP-39", "CMP-40"], core: ["ListDetail"], components: ["Avatar", "KeyValueRow", "Button"],
      signals: [[/\b(list[- ]detail|master[- ]detail|two[- ]pane|split view|reading pane)\b/, 6], [/\b(inbox|e-?mail client|mail app|contacts app|contact list|address book|product catalog(ue)?|notes app|settings categories)\b/, 4], [/\b(tap(ping)? (one|a row|an item|it) (opens|shows)|opens? (the|its) (message|details?|page))\b/, 4], [/\b(on a tablet|tablet layout|wide screen|large screen)\b/, 1]] },
    { id: "nav-shell", template: "NavShell", is: "an app with 3 to 5 top-level destinations: a bar, rail or drawer of icons and labels, and the selected destination's page",
      adapts: "bottom bar on a phone, a navigation rail from 600 dp wide, a drawer with full rows and the app title from 840 dp", examples: ["CMP-41", "CMP-42"], core: ["NavShell"], components: ["ListItem", "Icon"],
      signals: [[/\b(bottom nav(igation)?|nav(igation)? (bar|rail|drawer)|side ?bar|side menu|hamburger( menu)?|app shell)\b/, 5], [/\b(destinations|top-level (sections|screens|pages)|sections? (of|in) the app)\b/, 4], [/\b(\w+, \w+(, \w+)*,? and \w+) (sections|screens|pages)\b/, 4], [/\b(\w+, \w+(, \w+)*,? and \w+) tabs\b.*\bapp\b|\bapp\b.*\b(\w+, \w+(, \w+)*,? and \w+) tabs\b/, 4], [/\b(fitness|banking|music|shopping|social) app\b/, 2]] },
    { id: "dashboard-grid", template: "DashboardGrid", is: "a header, then cards of different kinds (KPI numbers with a trend, a chart, a ring or gauge, a short list) in a grid; some cards span two columns and cards in a row share a height",
      adapts: "one scrolling column on a phone, 2 columns on a landscape phone or small tablet, 3-4 when wide; short rows widen so there are no holes, low-priority cards show only from 2 columns",
      examples: ["CMP-44", "CMP-43"], components: ["BigNumber", "Sparkline", "TrendSparkline", "LineChart", "BarChart", "Gauge", "ProgressRing", "DonutChart", "RankedList", "RowList"],
      signals: [[/\b(dashboards?|status board|control panel|admin panel|analytics|kpis?|monitoring)\b/, 3], [/\b(grid of (cards|tiles|widgets)|card grid|bento|tiles? grid|responsive grid)\b/, 6], [/\b(smart home|home overview|server status|cluster|sales dashboard)\b/, 3], [/\b(tablet|desktop|wide screen|wall (screen|panel)|large screen)\b/, 1]] },
    { id: "gallery-grid", template: "GalleryGrid", is: "a scrolling grid of pictures, each with a title, a short caption and a price or count, perhaps in sections; a tap opens or selects one",
      adapts: "2 columns on a phone, 3 on a landscape phone, 4 on a portrait tablet, up to 6 wide (more when short so a whole tile fits); every picture keeps its aspect ratio",
      examples: ["CMP-45", "CMP-46"], core: ["GalleryGrid"], components: ["CoverArt", "Badge", "IconButton"],
      signals: [[/\b(gallery|photo (album|grid|library)|photos app|camera roll|image grid|thumbnails?|cover (grid|art grid))\b/, 6], [/\b(game library|app library|app grid|product grid|recipe (gallery|grid)|grid of (photos|pictures|products|recipes|games|albums))\b/, 5], [/\b(photos|albums|recipes|products|games|artworks|posters)\b.*\b(grid|columns|tiles)\b/, 4]] },
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
    { id: "calendar-grid", template: "CalendarMonth", is: "a month grid (weekday header, 4 to 6 weeks, today marked, days with events marked) and the selected day's events",
      adapts: "month on top with event dots and the agenda under it on a phone or portrait tablet; from 600 dp landscape, big cells with event titles as chips and the agenda as a side panel", examples: ["CMP-55", "CMP-56"], core: ["CalendarMonth"], components: ["IconButton", "Button"],
      signals: [[/^(?!.*\b(widget|tile|complication|watch)\b).*\b(calendar|month view|monthly view|month grid|calendar app)\b/, 6], [/\b(this|current|the) month\b.*\b(events?|classes|bookings?|appointments?)\b/, 4], [/\b(availability|booking) calendar\b/, 6], [/\b(tap|tapping|select(ing)?) a day\b/, 4], [/\b(appointments|planner|class timetable)\b/, 2]] },
    { id: "data-rows", template: "RowList", is: "an optional summary, then uniform rows from data: a mark, a title, a value, perhaps a small bar",
      adapts: "rows while tall, subtitles and header drop when short, tiles when wide", examples: ["CMP-18", "CMP-15", "CMP-07", "CMP-05"],
      signals: [[/\b(list|rows?|table|leaderboard|schedule|timetable|agenda|departures?|arrivals|inbox|ticker|summary widget|status dashboard)\b/, 3], [/\b(each with|per (category|item|person|team|account|project|service)|for each)\b/, 5], [/\b(\d+|two|three|four|five|six|seven|eight|nine|ten) [a-z]+s\b.*:/, 5], [/\bfor (\d+|two|three|four|five|six|seven|eight|nine|ten) [a-z]+s\b/, 5], [/\b(unread counts?|progress bars|as bars)\b/, 3], [/\b(london|tokyo|sydney)\b.*\band\b/, 2]] },
    { id: "panel-stack", is: "a scrolling or stacked set of different sections, each its own small panel",
      adapts: "panels drop by priority when short, columns when wide", examples: ["CMP-26", "CMP-14", "CMP-12"], components: ["NumberedList"],
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

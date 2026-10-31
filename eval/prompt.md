# Evaluation prompts

Fifty requests a user could plausibly make of an assistant connected to the RemoteCompose MCP
server. They cover widgets, phone screens, watch tiles and dashboards; data computed from the
clock or public facts, data a host app would supply, and plain controls. Each is run blind
(an assistant that only sees the `remotecompose` tools) and judged on: layout that adapts
(including smaller), the right library components and icons, values computed rather than
typed in, theme colours, correctness, and the tool calls it took to get there.

## Time and the sky (computable from the clock and public facts)
1. Make a widget showing the current moon phase, tonight's moonrise-style label ("waxing gibbous, 82% lit"), and how many days until the next full moon.
2. A world clock widget for London, New York, Tokyo and Sydney: local time, day or night, and the difference from my time.
3. Show how the length of the day changes over the year in Oslo, with a curve for all twelve months and a marker for today.
4. A countdown widget to New Year's Day with days, hours, minutes and seconds.
5. A sunrise and sunset widget for Lisbon with the sun's position over the day.
6. A Pomodoro timer screen: 25 minutes of work, 5 minutes of break, a ring that empties, start/pause and reset.
7. An analog clock watch face with a date window and a second hand.
8. A "week at a glance" widget: the seven days of this week with today highlighted and the week number.
9. A widget showing how far through the day, the week, the month and the year we are, as progress bars.
10. A seasons widget: the current season, the date of the next solstice or equinox and days until it.

## Host data (the app supplies the numbers)
11. A weather widget: current temperature, condition icon, high and low, and the next 6 hours as a small chart.
12. A step counter watch tile: today's steps against a 10,000 goal as a ring, and the last 7 days as bars.
13. A battery widget for my phone, watch and earbuds, each with its level and charging state.
14. A stock ticker widget for 3 stocks: price, change in percent coloured up or down, and a sparkline.
15. A music player screen: album art placeholder, title and artist, progress you can scrub, play/pause, previous/next, shuffle and repeat.
16. A smart home screen: 4 rooms with light switches, the thermostat temperature and a door lock status.
17. A package delivery tracker: the steps (ordered, shipped, out for delivery, delivered) with the current one highlighted and the ETA.
18. A sleep summary: hours slept, a hypnogram-like chart of sleep stages, and a quality score.
19. A flight status card: flight number, departure and arrival airports and times, gate, status and a progress line.
20. A habit tracker for 5 habits with this week's checkmarks and a streak count.
21. A crypto portfolio widget: total value, 24 h change, and the share of each coin as a donut chart.
22. An air quality widget: AQI value with a coloured scale, the main pollutant, and a recommendation.
23. A calorie tracker: calories eaten vs target as a ring, and macros (protein, carbs, fat) as bars.
24. A transit departures board: the next 5 buses with line number, destination and minutes until departure.
25. A server status dashboard: 6 services with up/down status, latency and an uptime percentage.

## Controls and forms
26. A settings screen with sections: notifications (toggles), display (brightness slider, theme choice), and account.
27. A login screen with email and password fields, a "remember me" checkbox and a sign-in button.
28. A volume mixer: master, music, voice and effects sliders with mute buttons.
29. A tip calculator: bill amount, tip percentage chips (10/15/20%), split between N people, and the result.
30. A unit converter for temperature: Celsius and Fahrenheit, adjust one and see the other.
31. A to-do list with 8 items you can check off, and a count of what's left.
32. A rating card: 5 stars you can tap, with a text that changes ("poor" ... "excellent").
33. A segmented control to switch between day, week and month views, with content that changes.
34. A stopwatch with lap times.
35. A colour picker with hue, saturation and lightness sliders and a preview swatch.

## Dashboards and data viz
36. A fitness dashboard: heart rate now with a chart over the last hour, active minutes, and calories.
37. A sales dashboard: today's revenue as a big number, a bar chart by hour, and the top 3 products.
38. A budget overview: spending per category as horizontal bars against their limits.
39. A plant care widget: soil moisture gauge, light level, and days since last watered.
40. A car dashboard for an EV: speed, battery range as an arc, and the next navigation turn.
41. A solar panel widget: power produced now, today's production curve, and money saved.
42. A water intake tracker: glasses drunk today out of 8, as a filling bottle drawing.

## Wear, small and ambient
43. A watch tile showing the next calendar event, its time and location.
44. An always-on watch face (monochrome) with the time, date and battery.
45. A notification summary widget: unread counts for mail, messages and calendar with icons.
46. A compact 2x2 home screen widget showing the time, date, weather icon and temperature.
47. An e-ink style daily dashboard: date, weather, three agenda items and a quote, in black and white.

## Showcases
48. A boarding pass with gate, seat, boarding time, a countdown and a QR-code placeholder.
49. A recipe card: title, cooking time, servings you can adjust (scaling ingredient amounts), and steps.
50. An onboarding screen with 3 pages, page dots, and next/skip buttons.

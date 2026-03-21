## Recent Edits — 2026-03-21

### What changed
- Simplified the weekend flow around `Brain Dump` and `Today I Get To Do...`
- Weekend `Start the Day` now builds directly from the user's own bullet list instead of depending on the parser
- Added `Helpful texts` for weekend to-dos with copy-ready drafts for names like Elliot, Ridwan, Leti, Jeff, and Lisa
- Added per-task weekend helpers like project links and prompt generation
- Added per-task `Expand` behavior for weekends with `Break it down`, `Later`, and `Tomorrow`
- Added a `Later today` bucket for weekend tasks
- Updated right-rail progress to reflect actual weekend task completion
- Made the streak update live when today's brain dump becomes meaningful
- Hardened `/api/parse` so malformed `texts`, `emails`, and `schedule` values are normalized safely
- Reworked end-of-day celebration into a cream-background summary with friendlier, more celebratory language

### Current product direction
- Weekend mode should feel radically lighter than weekday mode
- The app should trust the user's own list first, then offer optional expansion only where helpful
- Copy-paste support is especially important for text-related tasks
- Dynamic context should support the work, not add overhead

### Still to tighten tomorrow
- Strip instructional tail text out of all weekend to-do items everywhere it appears
- Refine the end-of-day summary language for `Moved Forward` and `How It Felt`
- Continue reducing visual clutter in expanded task actions
- Sanity-check weekend flow from fresh brain dump to end-of-day reflection in one clean pass

### Guiding principle
- Zero Friction: if the system gets in the way of doing the work, it is not working

# PitchEdge Hub

One site for every PitchEdge model. Each sport keeps its own repo, data and schedule;
this page only **reads** their data files and shows each dashboard in a tab, so a
problem in one sport never touches another.

Live at: https://jaredpatchett.github.io/pitchedge-hub/

## Editing sports
Everything is in the `SPORTS` list near the top of the `<script>` in `index.html`:

- `mode: 'auto'` — status (LIVE / STALE) comes from how fresh the data file is
- `mode: 'offseason'` — shows OFF SEASON. Flip golf back to `'auto'` in January.
- `mode: 'onhold'` / `'coming'` — on hold / not built yet
- `staleHours` — how old data can get before the dot turns amber
- `url` — the dashboard shown in the tab; `data` — the small file the overview card reads

## Data each card reads
| Sport | File | Shows |
|---|---|---|
| CFB | CFB-Model `docs/data/card_log.json` | Current Bet Card spreads |
| CBB | CBB-Model `docs/data/latest.json` | Official + A plays, record |
| NFL | NFL-Model `data/nfl_lines.json` | Week, games, live-odds coverage |
| Golf | rods-golf-model `rods_data.json` | Last event |

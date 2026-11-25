# PitchEdge

Research site for every PitchEdge model: one board, one design, every sport.
Live at https://jaredpatchett.github.io/pitchedge-hub/ (not indexed by search engines yet).

## How it works
- Each model keeps its own repo, schedule and keys. This site never writes to them.
- `scripts/build_data.py` reads each model's published data files and writes one common
  format into `data/` (`today.json` + one file per sport).
- `.github/workflows/refresh-data.yml` runs that script every hour and commits `data/`.
  Run it by hand from the Actions tab ("Refresh site data" → Run workflow).
- `index.html` + `assets/` is the site. It only reads `data/`.

## Sports
| Sport | Status | Source |
|---|---|---|
| CFB | Live | CFB-Model (latest.json, card_log, bet_card_confidence, props_clv) |
| CBB | Live | CBB-Model (latest.json) |
| NFL | Live | NFL-Model (nfl_lines, player_td, backtest_results) |
| Golf | Off season (last event) | rods-golf-model (rods_data.json) |
| NBA | **Sample data** | generated in build_data.py |
| Soccer | **Sample data** | generated in build_data.py |

Sample sports are labeled SAMPLE everywhere and never count toward a record.
When a real NBA or soccer model exists, replace `build_sample(...)` for it with a real builder.

## Before opening the site to the public
- Set `HIDE_PFF = true` at the top of `assets/app.js` (hides CFB plays/records built on PFF data).
- Check each data provider's display terms (DataGolf, The Odds API, OddsPapi).
- Remove the `noindex` tag in `index.html` when you want search engines to find it.

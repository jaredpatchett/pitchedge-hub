"""Build the site's data files from each sport's own repo.

Reads each model's published data (read-only, nothing is written back to those
repos) and writes one common format into data/:

  data/today.json      every sport's status + every current play, one shape
  data/<sport>.json    that sport's games, props, record and extras

Run locally against cloned repos:   SRC_DIR=/path/to/repos python scripts/build_data.py
In GitHub Actions it downloads the files from raw.githubusercontent.com.

Sports without a model yet (NBA, soccer) get SAMPLE data: invented numbers,
flagged sample=True everywhere, so the site can label them and never mix them
into a real record.
"""
import json, os, random, urllib.request, hashlib
from datetime import datetime, timezone, timedelta

OWNER = "jaredpatchett"
SRC_DIR = os.environ.get("SRC_DIR")
OUT = os.path.join(os.path.dirname(__file__), "..", "data")
NOW = datetime.now(timezone.utc)

SOURCES = {
    "cfb_latest": ("CFB-Model", "docs/data/latest.json"),
    "cfb_card": ("CFB-Model", "docs/data/card_log.json"),
    "cfb_conf": ("CFB-Model", "docs/data/bet_card_confidence.json"),
    "cfb_clv": ("CFB-Model", "docs/data/props_clv.json"),
    "cbb_latest": ("CBB-Model", "docs/data/latest.json"),
    "nfl_lines": ("NFL-Model", "data/nfl_lines.json"),
    "nfl_td": ("NFL-Model", "data/player_td.json"),
    "nfl_bt": ("NFL-Model", "data/backtest_results.json"),
    "golf": ("rods-golf-model", "rods_data.json"),
}


def load(key):
    repo, path = SOURCES[key]
    if SRC_DIR:
        with open(os.path.join(SRC_DIR, repo, path)) as f:
            return json.load(f)
    url = f"https://raw.githubusercontent.com/{OWNER}/{repo}/main/{path}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read())


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(ts):
    if not ts:
        return None
    ts = str(ts).replace(" ", "T")
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    d = datetime.fromisoformat(ts)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def upcoming(ts):
    d = parse(ts)
    return d is not None and d > NOW


def sgn(x):
    x = float(x)
    s = f"{x:g}"
    return ("+" + s) if x > 0 else s


def pid(*parts):
    return hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()[:10]


def rec(w=0, l=0, p=0, units=None, roi=None, **_):
    return {"w": w, "l": l, "p": p, "units": units, "roi": roi}


def play(**k):
    base = {"sport": None, "market": None, "start": None, "event": "", "pick": "", "line": None,
            "price": None, "book": None, "model": None, "edge": None, "edge_unit": None,
            "grade": None, "confidence": None, "official": False, "tags": [], "flags": [], "sample": False, "why": None}
    base.update(k)
    base["id"] = pid(base["sport"], base["market"], base["event"], base["pick"], base["start"])
    return base


def short_book(b):
    return {"draftkings": "DraftKings", "fanduel": "FanDuel", "betmgm": "BetMGM", "williamhill_us": "Caesars",
            "espnbet": "ESPN BET", "betonlineag": "BetOnline", "fanatics": "Fanatics", "hardrockbet": "Hard Rock",
            "betrivers": "BetRivers", "bovada": "Bovada", "pinnacle": "Pinnacle"}.get(str(b or "").lower(), b)


# ------------------------------------------------------------------ CFB
def build_cfb():
    d = load("cfb_latest")
    card = load("cfb_card")
    conf = load("cfb_conf")
    clv = load("cfb_clv")
    abbr = {t["name"]: t["abbr"] for t in d.get("teams", [])}
    plays = []

    # Bet Card spreads = the last saved run of the card (official).
    runs = card.get("runs") or []
    last = runs[-1] if runs else {}
    cut = conf.get("cutoffs", {}).get("Spread", {"High": 0.77, "Mid": 0.71})
    for p in last.get("plays", []):
        if not upcoming(p.get("kickoff")):
            continue
        prob = p.get("prob") or 0
        tier = "High" if prob >= cut["High"] else "Mid" if prob >= cut["Mid"] else "Low"
        edge = abs((p.get("modelSpread") or 0) - (p.get("marketSpread") or 0))
        plays.append(play(sport="cfb", market="spread", start=p["kickoff"], event=f'{p["away"]} @ {p["home"]}',
                          pick=p["label"], model=f"{round(prob * 100)}% cover", edge=round(edge, 1), edge_unit="pts",
                          grade=None, confidence=tier, official=True, tags=["Bet Card", f"{tier} confidence"]))

    # Totals: every listed total is graded; A/B are the official ones.
    for t in d.get("totals", []):
        if not upcoming(t.get("kickoff")):
            continue
        h, a = abbr.get(t["home"], t["home"]), abbr.get(t["away"], t["away"])
        tags = []
        if t.get("move", 0) > 0:
            tags.append("line moved our way")
        elif t.get("move", 0) < 0:
            tags.append("bet small: line moved against")
        plays.append(play(sport="cfb", market="total", start=t["kickoff"], event=f"{a} @ {h}",
                          pick=f'{t["side"].title()} {t["line"]:g}', line=t["line"], book=short_book(t.get("book")),
                          model=f'{t["pred"]:g} pts', edge=t["edge"], edge_unit="pts", grade=t.get("grade"),
                          official=t.get("grade") in ("A", "B"), tags=tags))

    # Official props, graded the same way the CFB dashboard does:
    # matchup grade points (A2 B1 C0 D/F-1) + line move since first flag (+1/-1).
    first = {}
    for c in clv.get("plays", []):
        first.setdefault((c.get("player"), c.get("market"), c.get("start_time")), c.get("line"))
    mu_pts = {"A": 2, "B": 1, "C": 0, "D": -1, "F": -1}
    props_out = []
    for p in d.get("props", []):
        if not (p.get("is_official_play") or p.get("is_watch_play")):
            continue
        if not upcoming(p.get("start_time")):
            continue
        lean = p.get("model_lean")
        price = p.get("under_price") if lean == "under" else p.get("over_price")
        grade = None
        if p.get("is_official_play"):
            mu = mu_pts.get(str(p.get("mu_grade") or "")[:1])
            ff = first.get((p["player_name"], p["market_name"], p["start_time"]))
            mv = 0
            if ff is not None and p.get("line") is not None and float(p["line"]) != float(ff):
                diff = float(p["line"]) - float(ff)
                mv = 1 if ((lean == "under" and diff < 0) or (lean == "over" and diff > 0)) else -1
            score = (mu or 0) + mv
            grade = "A" if score >= 2 else "B" if score >= 0 else "C"
        flags = []
        # PFF-derived: receiving models use PFF routes/targets; matchup grades use PFF defense grades.
        if p["market_name"] in ("Receptions", "Reception Yards") or p.get("mu_grade"):
            flags.append("pff")
        row = play(sport="cfb", market="prop", start=p["start_time"],
                   event=f'{p.get("team", "")} vs {p.get("opponent", "")}',
                   pick=f'{p["player_name"]} {"U" if lean == "under" else "O"} {p["line"]:g} {p["market_name"]}',
                   line=p["line"], price=price, book=short_book(p.get("book_used")),
                   model=f'{p["model_predicted_value"]:g}', edge=round(p.get("model_ev") or 0, 1), edge_unit="% EV",
                   grade=grade, official=bool(p.get("is_official_play")),
                   tags=(["watch"] if p.get("is_watch_play") and not p.get("is_official_play") else [])
                   + ([f'{p["mu_def"]} D'] if p.get("mu_def") else []), flags=flags)
        props_out.append(row)
        if row["official"]:
            plays.append(row)

    games = []
    for g in d.get("games", []):
        if not upcoming(g.get("commence_time")):
            continue
        games.append({
            "start": g["commence_time"], "home": g.get("home_school"), "away": g.get("away_school"),
            "home_color": g.get("home_color"), "away_color": g.get("away_color"),
            "market_spread": g.get("spread_home"), "market_total": g.get("total_over"),
            "ml_home": g.get("moneyline_home"), "ml_away": g.get("moneyline_away"),
            "model_spread": None if g.get("model_predicted_margin") is None else round(-g["model_predicted_margin"], 1),
            "model_total": g.get("model_total"), "home_win_prob": g.get("model_home_win_prob"),
            "book": short_book(g.get("book_used")), "bowl": g.get("bowl"),
        })

    # Records
    rows = conf.get("rows", [])
    def agg(market):
        r = [x for x in rows if x["market"] == market]
        w, l, pu, u = (sum(x[k] for x in r) for k in ("w", "l", "p", "units"))
        n = w + l
        return rec(w, l, pu, round(u, 2), round(100 * u / n, 1) if n else None)
    prop_tags = {"under_play", "rec_yds_play", "rush_under_play"}
    pw = pl = 0; pu = 0.0
    for c in clv.get("plays", []):
        if c.get("tag") in prop_tags and c.get("result") in ("W", "L"):
            pw += c["result"] == "W"; pl += c["result"] == "L"; pu += c.get("units") or 0
    records = [
        {"market": "Spreads (Bet Card)", "record": agg("Spread"), "note": f'Rebuilt Bet Card, weeks {conf.get("weeks", "")}, through {conf.get("through", "")}'},
        {"market": "Totals", "record": d.get("totals_record", {}).get("all"), "note": f'Live since {str(d.get("totals_record", {}).get("since", ""))[:10]}'},
        {"market": "Props (official groups)", "record": rec(pw, pl, 0, round(pu, 2), round(100 * pu / (pw + pl), 1) if pw + pl else None),
         "note": "Rush yds unders, receptions unders, rec yds plays; graded at the flagged price", "flags": ["pff"]},
        {"market": "Moneylines", "record": agg("Moneyline"), "note": "Tracked, never official"},
    ]
    updated = parse(last.get("at")) or parse(d.get("generated_at"))
    return {
        "sport": {"id": "cfb", "name": "CFB", "full": "College Football", "status": "live", "updated": iso(updated) if updated else None,
                  "markets": ["Spreads", "Totals", "Props"]},
        "plays": plays, "games": games, "props": props_out, "records": records,
    }


# ------------------------------------------------------------------ CBB
def build_cbb():
    d = load("cbb_latest")
    plays = []
    props_out = []
    for p in d.get("spreads", []) + d.get("totals", []) + d.get("props", []):
        if not p.get("official") or not upcoming(p.get("kickoff")):
            continue
        h, a = p.get("home_cbbd") or p["home"], p.get("away_cbbd") or p["away"]
        m = p["market"]
        if m == "spread":
            team = h if p["side"] == "home" else a
            pick, model, unit = f'{team} {sgn(p["line"])}', f'{sgn(p["model"])}', "pts"
        elif m == "total":
            pick, model, unit = f'{p["side"].title()} {p["line"]:g}', f'{p["model"]:g} pts', "pts"
        else:
            pick = f'{p["player"]} {"U" if p["side"] == "under" else "O"} {p["line"]:g} {p["prop_market"]}'
            model, unit = f'{p["model"]:g}', "%"
        tags = []
        if p.get("new"):
            tags.append("new")
        if p.get("matchup"):
            tags.append(p["matchup"])
        if p.get("move", 0) < 0:
            tags.append("line moved against")
        row = play(sport="cbb", market=m, start=p["kickoff"], event=f"{a} @ {h}", pick=pick, line=p.get("line"),
                   price=p.get("price"), book=short_book(p.get("book")), model=model, edge=p.get("edge"),
                   edge_unit=unit, grade=p.get("grade"), official=True, tags=tags)
        plays.append(row)
        if m == "prop":
            props_out.append(row)
    games = []
    for g in d.get("games", []):
        if not upcoming(g.get("kickoff")):
            continue
        games.append({"start": g["kickoff"], "home": g.get("home_school"), "away": g.get("away_school"),
                      "market_spread": g.get("market_spread"), "market_total": g.get("market_total"),
                      "ml_home": g.get("ml_home"), "ml_away": g.get("ml_away"), "model_spread": g.get("model_spread"),
                      "model_total": g.get("model_total"), "home_win_prob": g.get("home_win_prob"),
                      "book": short_book(g.get("book")), "neutral": g.get("neutral")})
    r = d.get("record", {})
    since = str(r.get("since", ""))[:10]
    records = [{"market": "All official plays", "record": r.get("all"), "note": f"Live since {since}"}]
    for k, label in (("spread", "Spreads"), ("total", "Totals"), ("prop", "Props")):
        mk = (r.get("markets") or {}).get(k)
        if mk:
            records.append({"market": label, "record": mk.get("all"), "grades": mk.get("grades"), "note": f"Live since {since}"})
    return {
        "sport": {"id": "cbb", "name": "CBB", "full": "College Basketball", "status": "live",
                  "updated": iso(parse(d["meta"]["generated_at"])), "markets": ["Spreads", "Totals", "Props"]},
        "plays": plays, "games": games, "props": props_out, "records": records,
    }


# ------------------------------------------------------------------ NFL
def build_nfl():
    d = load("nfl_lines")
    td = load("nfl_td")
    bt = load("nfl_bt")
    plays, games = [], []
    for g in d.get("games", []):
        mk, md, ed = g.get("market") or {}, g.get("model") or {}, g.get("edges") or {}
        home, away = g["home_team"], g["away_team"]
        # nflverse convention: spread_line > 0 means the home team is favored by that many.
        sl = mk.get("spread_line")
        games.append({"start": None, "week": g.get("week"), "home": home, "away": away,
                      "market_spread": None if sl is None else -sl, "market_total": mk.get("total_line"),
                      "ml_home": mk.get("home_moneyline"), "ml_away": mk.get("away_moneyline"),
                      "model_spread": None if md.get("pred_home_margin") is None else round(-md["pred_home_margin"], 1),
                      "model_total": md.get("pred_total"), "home_win_prob": md.get("home_win_prob"),
                      "live_odds": g.get("market_source") != "schedule_fallback"})
        se = ed.get("spread_edge")
        if sl is not None and se is not None and abs(se) >= 3:
            pick = f"{home} {sgn(-sl)}" if se > 0 else f"{away} {sgn(sl)}"
            plays.append(play(sport="nfl", market="spread", start=None, event=f"{away} @ {home}", pick=pick,
                              line=sl, model=f'{sgn(round(-md["pred_home_margin"], 1))} {home}', edge=round(abs(se), 1),
                              edge_unit="pts", grade=None, official=False, tags=["model lean", f'Week {g.get("week")}']))
    for p in td.get("players", []):
        q, m, mk = p.get("qualification") or {}, p.get("model") or {}, p.get("market") or {}
        if not q.get("qualifies") or not mk.get("implied_prob"):
            continue
        plays.append(play(sport="nfl", market="prop", start=None, event=p.get("matchup", ""),
                          pick=f'{p["player_name"]} anytime TD', price=mk.get("anytime_td_price"),
                          model=f'{round(m["anytime_td_prob"] * 100)}%', edge=round(mk["edge"] * 100, 1), edge_unit="pts of prob",
                          grade=q.get("tier"), official=True, tags=[p.get("position", ""), f'Week {td.get("week")}']))
    tb, ta = bt.get("track_b", {}), bt.get("track_a", {})
    def r_from(x):
        if not x:
            return None
        return rec(x.get("wins", 0), x.get("losses", 0), x.get("pushes", 0), None, x.get("roi_pct"))
    records = [
        {"market": "Spreads (all logged)", "record": r_from(tb.get("ats_all")), "note": "Every logged pre-game prediction vs result"},
        {"market": "Totals (all logged)", "record": r_from(tb.get("totals_all")), "note": "Every logged pre-game prediction vs result"},
        {"market": "Anytime TD (positive edge)", "record": {"w": None, "l": None, "p": None, "units": None, "roi": ta.get("roi_positive_edge_pct"),
         "n": ta.get("n_positive_edge_bets")}, "note": f'{ta.get("n_positive_edge_bets", 0)} priced bets; model AUC {ta.get("auc", 0):.2f}'},
    ]
    return {
        "sport": {"id": "nfl", "name": "NFL", "full": "NFL", "status": "live", "updated": iso(parse(d["generated_at"])),
                  "week": d.get("week"), "markets": ["Spreads", "Totals", "Anytime TD"]},
        "plays": plays, "games": games, "props": [p for p in plays if p["market"] == "prop"], "records": records,
    }


# ------------------------------------------------------------------ Golf (off season: last event only)
def build_golf():
    d = load("golf")
    m = d.get("meta", {})
    markets = {}
    for key, label in (("W", "Win"), ("W5", "Top 5"), ("W10", "Top 10"), ("W20", "Top 20")):
        rows = []
        for r in d.get(key, []):
            name, mp, kp, price = (r + [None] * 4)[:4]
            if mp is None or not kp:
                continue
            rows.append({"player": name, "model": round(mp * 100, 1), "market": round(kp * 100, 1),
                         "edge": round((mp - kp) * 100, 1), "price": price})
        rows.sort(key=lambda x: -x["model"])
        markets[label] = rows[:25]
    return {
        "sport": {"id": "golf", "name": "Golf", "full": "PGA Golf", "status": "offseason",
                  "updated": iso(parse(m.get("generated"))), "note": "Season over after the RSM Classic. Back in January.",
                  "event": m.get("event"), "course": m.get("course"), "markets": ["Outrights", "Matchups", "Round scores"]},
        "plays": [], "games": [], "props": [], "records": [], "last_event": {"event": m.get("event"), "course": m.get("course"),
                                                                              "field": m.get("players"), "markets": markets},
    }


# ------------------------------------------------------------------ SAMPLE sports
NBA = ["Celtics", "Knicks", "76ers", "Bucks", "Cavaliers", "Pacers", "Heat", "Magic", "Hawks", "Nets", "Raptors",
       "Bulls", "Pistons", "Hornets", "Wizards", "Nuggets", "Thunder", "Timberwolves", "Mavericks", "Suns", "Lakers",
       "Clippers", "Warriors", "Kings", "Rockets", "Grizzlies", "Pelicans", "Spurs", "Jazz", "Trail Blazers"]
EPL = ["Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Burnley", "Chelsea", "Crystal Palace",
       "Everton", "Fulham", "Leeds", "Liverpool", "Man City", "Man United", "Newcastle", "Nottm Forest",
       "Sunderland", "Tottenham", "West Ham", "Wolves"]


def build_sample(sport):
    rng = random.Random(f"{sport}-{NOW:%Y-%m-%d}")
    teams = list(NBA if sport == "nba" else EPL)
    rng.shuffle(teams)
    plays, games = [], []
    base = NOW.replace(minute=0, second=0, microsecond=0)
    for i in range(0, min(len(teams), 16), 2):
        home, away = teams[i], teams[i + 1]
        start = base + timedelta(hours=rng.choice([3, 4, 5, 6, 26, 27, 28]))
        if sport == "nba":
            ms = round(rng.uniform(-12, 12) * 2) / 2
            mt = round(rng.uniform(212, 238) * 2) / 2
            mod_s = round(ms + rng.gauss(0, 2.6), 1)
            mod_t = round(mt + rng.gauss(0, 5), 1)
            games.append({"start": iso(start), "home": home, "away": away, "market_spread": ms, "market_total": mt,
                          "model_spread": mod_s, "model_total": mod_t, "home_win_prob": round(min(.95, max(.05, .5 - mod_s / 28)), 3), "sample": True})
            e = round(abs(mod_s - ms), 1)
            if e >= 3:
                pick = f"{home} {sgn(ms)}" if mod_s < ms else f"{away} {sgn(-ms)}"
                plays.append(play(sport=sport, market="spread", start=iso(start), event=f"{away} @ {home}", pick=pick, line=ms,
                                  price=-110, model=sgn(mod_s), edge=e, edge_unit="pts", grade="A" if e >= 5 else "B",
                                  official=True, sample=True))
            e = round(abs(mod_t - mt), 1)
            if e >= 6:
                side = "Under" if mod_t < mt else "Over"
                plays.append(play(sport=sport, market="total", start=iso(start), event=f"{away} @ {home}", pick=f"{side} {mt:g}",
                                  line=mt, price=-110, model=f"{mod_t:g} pts", edge=e, edge_unit="pts",
                                  grade="A" if e >= 9 else "B", official=True, sample=True))
        else:
            ph = rng.uniform(.25, .6); pd = rng.uniform(.22, .3); pa = 1 - ph - pd
            mh = min(.9, max(.05, ph + rng.gauss(0, .05)))
            games.append({"start": iso(start), "home": home, "away": away, "model_home": round(mh, 3),
                          "model_draw": round(pd, 3), "model_away": round(1 - mh - pd, 3),
                          "market_home": round(ph, 3), "market_draw": round(pd, 3), "market_away": round(pa, 3),
                          "xg_home": round(rng.uniform(.8, 2.2), 2), "xg_away": round(rng.uniform(.6, 1.9), 2), "sample": True})
            e = round((mh - ph) * 100, 1)
            if abs(e) >= 5:
                team = home if e > 0 else away
                plays.append(play(sport=sport, market="moneyline", start=iso(start), event=f"{home} vs {away}",
                                  pick=f"{team} to win", model=f"{round((mh if e > 0 else 1 - mh - pd) * 100)}%",
                                  edge=abs(e), edge_unit="pts of prob", grade="A" if abs(e) >= 8 else "B",
                                  official=True, sample=True))
    games.sort(key=lambda g: g["start"])
    full = {"nba": "NBA", "soccer": "Soccer (EPL)"}[sport]
    return {
        "sport": {"id": sport, "name": "NBA" if sport == "nba" else "Soccer", "full": full, "status": "sample",
                  "updated": iso(NOW), "note": "Sample data. No live model yet; numbers are invented to preview the layout.",
                  "markets": ["Spreads", "Totals"] if sport == "nba" else ["1X2", "Totals"]},
        "plays": plays, "games": games, "props": [], "records": [],
    }


# ------------------------------------------------------------------ main
def main():
    os.makedirs(OUT, exist_ok=True)
    order = [("cfb", build_cfb), ("cbb", build_cbb), ("nfl", build_nfl), ("nba", lambda: build_sample("nba")),
             ("soccer", lambda: build_sample("soccer")), ("golf", build_golf)]
    sports, plays = [], []
    for sid, fn in order:
        try:
            out = fn()
        except Exception as e:  # one broken source never takes down the others
            print(f"[{sid}] FAILED: {e!r}")
            prev = os.path.join(OUT, f"{sid}.json")
            if os.path.exists(prev):
                with open(prev) as f:
                    out = json.load(f)
                out["sport"]["error"] = f"Couldn't refresh: {e}"
            else:
                continue
        out["generated_at"] = iso(NOW)
        with open(os.path.join(OUT, f"{sid}.json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        s = dict(out["sport"])
        s["counts"] = {"plays": sum(1 for p in out["plays"] if p["official"]),
                       "a": sum(1 for p in out["plays"] if p["official"] and p["grade"] == "A"),
                       "games": len(out["games"])}
        sports.append(s)
        plays += out["plays"]
        print(f"[{sid}] {s['status']}: {len(out['plays'])} plays, {len(out['games'])} games, updated {s.get('updated')}")
    plays.sort(key=lambda p: (p["start"] or "9999", p["sport"]))
    with open(os.path.join(OUT, "today.json"), "w") as f:
        json.dump({"generated_at": iso(NOW), "sports": sports, "plays": plays}, f, separators=(",", ":"))


if __name__ == "__main__":
    main()

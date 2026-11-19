import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = ROOT / "template.html"
OUT_HTML = ROOT / "index.html"
DATA_PATH = ROOT / "data" / "cafc_h2h_data.json"
PLACEHOLDER = "__CAFC_COMPACT_JSON__"


def build_compact_json(d):
    seasons = d["seasons"]
    sid_idx = {s["id"]: i for i, s in enumerate(seasons)}
    divs = sorted(
        {m["div"] for m in d["matches"]}
        | {h["div"] for p in d["players"] for h in p["history"]}
    )
    div_idx = {dv: i for i, dv in enumerate(divs)}
    rounds = sorted({m["rd"] for m in d["matches"]})
    rd_idx = {r: i for i, r in enumerate(rounds)}

    c_players = []
    for p in d["players"]:
        st = p["stats"]
        st_arr = [
            st["m"], st["w"], st["l"],
            st["sw"], st["sl"],
            st["gw"], st["gl"],
            st["stb_w"], st["stb_l"],
            st["tb_w"], st["tb_l"],
            st["s3_w"], st["s3_l"],
            st["bagels_w"], st["bagels_l"],
            st["tournoi_m"], st["tournoi_w"],
        ]
        h_arr = [
            [sid_idx[h["sid"]], div_idx[h["div"]], h["dr"], h["rk"], h["j"], h["ds"], h["dg"], h["pts"]]
            for h in p["history"]
            if h["sid"] in sid_idx
        ]
        c_players.append([
            p["id"],
            p["name"],
            p["phone"],
            1 if p["homonym"] else 0,
            div_idx.get(p["best_div"], -1),
            p["best_div_rank"],
            div_idx.get(p["last_div"], -1),
            p["aliases"],
            p["alt_phones"],
            p["family_phone"],
            st_arr,
            h_arr,
        ])

    c_matches = []
    for m in d["matches"]:
        fm = (
            (1 if "stb" in m["f"] else 0)
            | (2 if "wo" in m["f"] else 0)
            | (4 if "ret" in m["f"] else 0)
        )
        c_matches.append([
            sid_idx[m["sid"]],
            div_idx[m["div"]],
            rd_idx[m["rd"]],
            m["p1"],
            m["p2"],
            m["w"],
            m["s"],
            m["sw"],
            fm,
        ])

    compact = {
        "meta": d["meta"],
        "seasons": [
            [s["id"], s["order"], s["label"], 0 if s["type"] == "ligue" else 1, s["matches"]]
            for s in seasons
        ],
        "divs": divs,
        "rounds": rounds,
        "players": c_players,
        "matches": c_matches,
        "top": [[r["p1"], r["p2"], r["n"], r["w1"], r["w2"]] for r in d["top_rivalries"]],
    }
    raw = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
    return raw.replace("</", "<\\/")


def main():
    parser = argparse.ArgumentParser(description="Build self-contained CAFC Tennis Head 2 Head HTML app")
    parser.add_argument("--extra-out", type=Path, default=None, help="Optional extra output path for built HTML")
    args = parser.parse_args()

    template_html = TEMPLATE_PATH.read_text(encoding="utf-8")
    if PLACEHOLDER not in template_html:
        raise RuntimeError(f"Placeholder {PLACEHOLDER} not found in {TEMPLATE_PATH}")

    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    compact_str = build_compact_json(data)
    built_html = template_html.replace(PLACEHOLDER, compact_str, 1)

    OUT_HTML.write_text(built_html, encoding="utf-8")
    if args.extra_out:
        args.extra_out.write_text(built_html, encoding="utf-8")

    print(f"Built {OUT_HTML} ({len(built_html.encode('utf-8')) / 1024:.1f} KB)")


if __name__ == "__main__":
    main()

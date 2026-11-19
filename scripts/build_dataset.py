import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = str(ROOT / "data")

# 1. Confirmed spelling/nickname variants with the EXACT SAME phone hash
NAME_ALIASES_HASHED = {
    ("Mohamed Ouazzani", "55bdc49d1d5f63c6"): "Simo Ouazzani",
    ("Ali Jawhar", "603d9da2c7f57928"): "Ali Jaouher",
    ("Omar Belcadi", "3a57fb62211c9c17"): "Omar Belqadi",
    ("Youssef Essaban", "d6603daae4041f4d"): "Youssef Essabban",
    ("Ali Khelil", "9776cef3d3faab22"): "Mohamed-Ali Khelil",
    ("Hassan Ibenmanssour", "aecc367e89d784ae"): "Hassan Ibenmansour",
}

# 2. Confirmed single-member phone changes/fixes (hashed; verified via CAFC Adhérents + consecutive divisions)
PHONE_MIGRATIONS_HASHED = {
    ("Youssef Tazi", "8ff06edfe5cc06e4"): "b432bad5c1717ea5",
    ("Amine Sebti", "42566593d76b93ee"): "4e7e1e92203fbfc9",
    ("Youssef Lakhiry", "e406b2e65aebf862"): "ca14cc2fc09537ba",
    ("Soufiane Benabderrazik", "7c81a4a4e41224b1"): "dcab61b1d4fd2bcc",
    ("Ali Squalli", "edc2dd18866d28c0"): "e74b893fd1f500fc",
    ("Kamil Choukri", "143aeff973dc30ee"): "c8fdcba42ace2ca7",
    ("Ghita El Gueddari", "9b8d5bddf05b5cef"): "eb8825aeb0bb2e27",
    ("Othmane Laraqui", "515eba2918e87b46"): "e698286f68952233",
}


def phone_hash(phone):
    return hashlib.sha256(phone.encode("utf-8")).hexdigest()[:16]


def mask_phone(phone):
    """Partially mask phone number for privacy while keeping homonyms uniquely distinguishable.
    Examples:
      +212600000000 -> +212 6 •• •• 46 47
      +33600000000  -> +33 6 •• •• 15 56
      +44 70 0000 0000 -> +44 75 •••• 8481
      +1 555 000 0000  -> +1 ••• ••• 6450
    """
    if not phone:
        return ""
    d = phone.lstrip("+")
    if d.startswith("212") and len(d) == 12:
        return f"+212 {d[3]} •• •• {d[8:10]} {d[10:12]}"
    if d.startswith("33") and len(d) == 11:
        return f"+33 {d[2]} •• •• {d[7:9]} {d[9:11]}"
    if d.startswith("44") and len(d) == 12:
        return f"+44 {d[2:4]} •••• {d[8:12]}"
    if d.startswith("1") and len(d) == 11:
        return f"+1 ••• ••• {d[7:11]}"
    if len(d) >= 6:
        return f"+{d[:2]} •••• {d[-4:-2]} {d[-2:]}"
    return "••••"


def resolve_identity(raw_name, raw_phone):
    if not raw_phone:
        return None, None, None, None, None
    ph_h = phone_hash(raw_phone)
    masked = mask_phone(raw_phone)
    name = NAME_ALIASES_HASHED.get((raw_name, ph_h), raw_name)
    canon_h = PHONE_MIGRATIONS_HASHED.get((name, ph_h), ph_h)
    name = NAME_ALIASES_HASHED.get((name, canon_h), name)
    alias = raw_name if raw_name != name else None
    is_migrated = canon_h != ph_h
    return name, canon_h, masked, alias, is_migrated


def main():
    with open(os.path.join(OUT_DIR, "raw_matches.json")) as f:
        raw_matches = json.load(f)
    with open(os.path.join(OUT_DIR, "raw_classifs.json")) as f:
        raw_classifs = json.load(f)

    # Track masked phone per hash so canonical masked display uses the current phone
    hash_to_masked = {}
    for m in raw_matches:
        for side in ("p1", "p2"):
            if m[f"{side}_phone"]:
                hash_to_masked[phone_hash(m[f"{side}_phone"])] = mask_phone(m[f"{side}_phone"])
    for c in raw_classifs:
        if c["phone"]:
            hash_to_masked[phone_hash(c["phone"])] = mask_phone(c["phone"])

    players_map = {}  # (name, canon_hash) -> dict
    merged_phone_log = {}  # (name, old_masked) -> new_masked
    merged_name_log = {}   # (old_name, canon_name) -> masked

    def ensure_player(raw_name, raw_phone):
        name, canon_h, raw_masked, alias, is_migrated = resolve_identity(raw_name, raw_phone)
        if name is None:
            return None
        canon_masked = hash_to_masked.get(canon_h, raw_masked)
        key = (name, canon_h)
        if key not in players_map:
            players_map[key] = {
                "name": name,
                "phone_hash": canon_h,
                "phone_fmt": canon_masked,
                "aliases": set(),
                "alt_phones": set(),
                "seasons_map": {},
                "stats": {
                    "m": 0, "w": 0, "l": 0,
                    "sw": 0, "sl": 0,
                    "gw": 0, "gl": 0,
                    "stb_w": 0, "stb_l": 0,
                    "tb_w": 0, "tb_l": 0,
                    "s3_w": 0, "s3_l": 0,
                    "bagels_w": 0, "bagels_l": 0,
                    "tournoi_m": 0, "tournoi_w": 0,
                },
            }
        if alias:
            players_map[key]["aliases"].add(alias)
            merged_name_log[(alias, name)] = canon_masked
        if is_migrated:
            players_map[key]["alt_phones"].add(raw_masked)
            merged_phone_log[(name, raw_masked)] = canon_masked
        return key

    resolved_classifs = []
    for c in raw_classifs:
        key = ensure_player(c["name"], c["phone"])
        if key is None:
            continue
        p = players_map[key]
        p["seasons_map"][c["season_id"]] = {
            "sid": c["season_id"],
            "ord": c["season_order"],
            "lbl": c["season_label"],
            "div": c["division"],
            "dr": c["division_rank"],
            "rk": c["rank"],
            "j": c["j"],
            "ds": c["dsets"],
            "dg": c["dgames"],
            "pts": c["pts"],
        }
        resolved_classifs.append((key, c))

    resolved_matches = []
    for m in raw_matches:
        k1 = ensure_player(m["p1_name"], m["p1_phone"])
        k2 = ensure_player(m["p2_name"], m["p2_phone"])
        if k1 is None or k2 is None:
            raise ValueError(f"Match missing phone: {m}")
        if k1 == k2:
            raise ValueError(f"Self-match detected! {k1} in {m}")
        resolved_matches.append((k1, k2, m))

    # AUDIT: Verify 100% match against Classification PDFs
    calc = defaultdict(lambda: defaultdict(lambda: {"j": 0, "ds": 0, "dg": 0}))
    for k1, k2, m in resolved_matches:
        if m["season_type"] != "ligue":
            continue
        dk = (m["season_id"], m["division"])
        calc[dk][k1]["j"] += 1
        calc[dk][k2]["j"] += 1
        calc[dk][k1]["ds"] += m["p1_sets_won"] - m["p2_sets_won"]
        calc[dk][k2]["ds"] += m["p2_sets_won"] - m["p1_sets_won"]
        g1 = sum(a for a, b in m["sets"])
        g2 = sum(b for a, b in m["sets"])
        calc[dk][k1]["dg"] += g1 - g2
        calc[dk][k2]["dg"] += g2 - g1

    mismatches = 0
    for key, c in resolved_classifs:
        dk = (c["season_id"], c["division"])
        st = calc[dk][key]
        if st["j"] != c["j"] or st["ds"] != c["dsets"] or st["dg"] != c["dgames"]:
            mismatches += 1
            print(f"MISMATCH: {key} {dk}: calc={st} vs classif=({c['j']}, {c['dsets']}, {c['dgames']})")

    print(f"AUDIT RESULT: {len(resolved_classifs)} player-seasons checked -> {mismatches} mismatches!")
    assert mismatches == 0, f"Expected 0 mismatches, got {mismatches}"

    sorted_keys = sorted(players_map.keys(), key=lambda k: (k[0].lower(), players_map[k]["phone_fmt"], k[1]))

    for k1, k2, m in resolved_matches:
        p1 = players_map[k1]["stats"]
        p2 = players_map[k2]["stats"]
        p1["m"] += 1
        p2["m"] += 1
        if m["season_type"] == "tournoi":
            p1["tournoi_m"] += 1
            p2["tournoi_m"] += 1
        if m["winner"] == 1:
            p1["w"] += 1
            p2["l"] += 1
            if m["season_type"] == "tournoi":
                p1["tournoi_w"] += 1
        else:
            p2["w"] += 1
            p1["l"] += 1
            if m["season_type"] == "tournoi":
                p2["tournoi_w"] += 1

        p1["sw"] += m["p1_sets_won"]
        p1["sl"] += m["p2_sets_won"]
        p2["sw"] += m["p2_sets_won"]
        p2["sl"] += m["p1_sets_won"]

        g1 = sum(a for a, b in m["sets"])
        g2 = sum(b for a, b in m["sets"])
        p1["gw"] += g1
        p1["gl"] += g2
        p2["gw"] += g2
        p2["gl"] += g1

        if m["is_stb"]:
            if m["winner"] == 1:
                p1["stb_w"] += 1
                p2["stb_l"] += 1
            else:
                p2["stb_w"] += 1
                p1["stb_l"] += 1

        if len(m["sets"]) == 3:
            if m["winner"] == 1:
                p1["s3_w"] += 1
                p2["s3_l"] += 1
            else:
                p2["s3_w"] += 1
                p1["s3_l"] += 1

        for a, b in m["sets"]:
            if a == 7 and b == 6:
                p1["tb_w"] += 1
                p2["tb_l"] += 1
            elif b == 7 and a == 6:
                p2["tb_w"] += 1
                p1["tb_l"] += 1
            if a == 6 and b == 0:
                p1["bagels_w"] += 1
                p2["bagels_l"] += 1
            elif b == 6 and a == 0:
                p2["bagels_w"] += 1
                p1["bagels_l"] += 1

    active_keys = [k for k in sorted_keys if players_map[k]["stats"]["m"] > 0]
    active_name_counts = defaultdict(list)
    for k in active_keys:
        active_name_counts[k[0].lower()].append(k)
    active_homonyms = {nm: ks for nm, ks in active_name_counts.items() if len(ks) > 1}

    # Verify masked phones uniquely distinguish every homonym!
    for nm, ks in active_homonyms.items():
        masked_set = {players_map[k]["phone_fmt"] for k in ks}
        assert len(masked_set) == len(ks), f"Masked phone collision for homonym {nm}: {masked_set}"

    id_map = {k: idx for idx, k in enumerate(active_keys)}

    seasons_seen = {}
    for _, _, m in resolved_matches:
        sid = m["season_id"]
        if sid not in seasons_seen:
            seasons_seen[sid] = {
                "id": sid,
                "order": m["season_order"],
                "label": m["season_label"],
                "type": m["season_type"],
                "matches": 0,
            }
        seasons_seen[sid]["matches"] += 1
    seasons_list = sorted(seasons_seen.values(), key=lambda x: x["order"])

    players_out = []
    for k in active_keys:
        p = players_map[k]
        pid = id_map[k]
        seasons_hist = sorted(p["seasons_map"].values(), key=lambda x: x["ord"])
        best_div = min(seasons_hist, key=lambda x: (x["dr"], x["rk"]))["div"] if seasons_hist else "Tournoi"
        best_div_rank = min(x["dr"] for x in seasons_hist) if seasons_hist else 99
        last_season = seasons_hist[-1] if seasons_hist else None
        first_season = seasons_hist[0] if seasons_hist else None
        is_hom = len(active_name_counts[k[0].lower()]) > 1
        shared_family = [
            other[0] for other in active_keys if other[1] == k[1] and other[0] != k[0]
        ]

        players_out.append({
            "id": pid,
            "name": p["name"],
            "phone": p["phone_fmt"],
            "homonym": is_hom,
            "aliases": sorted(p["aliases"]),
            "alt_phones": sorted(p["alt_phones"]),
            "family_phone": shared_family,
            "best_div": best_div,
            "best_div_rank": best_div_rank,
            "last_div": last_season["div"] if last_season else "Tournoi",
            "last_season": last_season["lbl"] if last_season else "Tournoi 02.2024",
            "first_season": first_season["lbl"] if first_season else "Tournoi 02.2024",
            "seasons_count": len(seasons_hist),
            "stats": p["stats"],
            "history": seasons_hist,
        })

    def round_sort_key(r):
        m_j = re.search(r"Journée\s+(\d+)", r)
        if m_j:
            return (0, int(m_j.group(1)))
        order_map = {"huitièmes": 1, "quarts": 2, "demi": 3, "3ème": 4, "finale": 5}
        rl = r.lower()
        for kw, val in order_map.items():
            if kw in rl:
                return (1, val)
        return (2, 0)

    matches_out = []
    for idx, (k1, k2, m) in enumerate(
        sorted(resolved_matches, key=lambda x: (x[2]["season_order"], x[2]["division_rank"], round_sort_key(x[2]["round"])))
    ):
        flags = []
        if m["is_stb"]:
            flags.append("stb")
        if m["is_wo"]:
            flags.append("wo")
        elif m["is_ret"]:
            flags.append("ret")
        matches_out.append({
            "id": idx,
            "sid": m["season_id"],
            "ord": m["season_order"],
            "sl": m["season_label"],
            "st": m["season_type"],
            "div": m["division"],
            "dr": m["division_rank"],
            "rd": m["round"],
            "p1": id_map[k1],
            "p2": id_map[k2],
            "w": id_map[k1] if m["winner"] == 1 else id_map[k2],
            "s": m["sets"],
            "sw": [m["p1_sets_won"], m["p2_sets_won"]],
            "f": flags,
        })

    pair_counts = defaultdict(lambda: {"n": 0, "w1": 0, "w2": 0, "last_ord": 0})
    for m in matches_out:
        a, b = (m["p1"], m["p2"]) if m["p1"] < m["p2"] else (m["p2"], m["p1"])
        pc = pair_counts[(a, b)]
        pc["n"] += 1
        if m["w"] == a:
            pc["w1"] += 1
        else:
            pc["w2"] += 1
        if m["ord"] > pc["last_ord"]:
            pc["last_ord"] = m["ord"]

    top_rivalries = sorted(pair_counts.items(), key=lambda x: (-x[1]["n"], -x[1]["last_ord"]))[:25]

    dataset = {
        "meta": {
            "total_players": len(players_out),
            "total_matches": len(matches_out),
            "ligue_matches": sum(1 for m in matches_out if m["st"] == "ligue"),
            "tournoi_matches": sum(1 for m in matches_out if m["st"] == "tournoi"),
            "total_pairs": len(pair_counts),
            "seasons_count": sum(1 for s in seasons_list if s["type"] == "ligue"),
            "phones_masked": True,
            "homonym_groups": [
                {
                    "name": players_out[id_map[ks[0]]]["name"],
                    "players": [
                        {
                            "id": id_map[k],
                            "phone": players_out[id_map[k]]["phone"],
                            "best_div": players_out[id_map[k]]["best_div"],
                            "matches": players_out[id_map[k]]["stats"]["m"],
                            "period": f"{players_out[id_map[k]]['first_season']} – {players_out[id_map[k]]['last_season']}",
                        }
                        for k in ks
                    ],
                }
                for _, ks in sorted(active_homonyms.items())
            ],
            "merged_phone_updates": [
                {"name": name, "old_phone": old_m, "new_phone": new_m}
                for (name, old_m), new_m in sorted(merged_phone_log.items())
            ],
            "merged_name_variants": [
                {"old_name": old_nm, "canonical_name": new_nm, "phone": masked_ph}
                for (old_nm, new_nm), masked_ph in sorted(merged_name_log.items())
            ],
        },
        "seasons": seasons_list,
        "players": players_out,
        "matches": matches_out,
        "top_rivalries": [
            {"p1": a, "p2": b, "n": info["n"], "w1": info["w1"], "w2": info["w2"]}
            for (a, b), info in top_rivalries[:16]
        ],
    }

    out_path = os.path.join(OUT_DIR, "cafc_h2h_data.json")
    with open(out_path, "w") as f:
        json.dump(dataset, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(out_path) / 1024
    print(f"Saved privacy-masked {out_path} ({size_kb:.1f} KB)")
    print("Masked homonyms:")
    for g in dataset["meta"]["homonym_groups"]:
        print(" ", g["name"], "->", [p["phone"] for p in g["players"]])


if __name__ == "__main__":
    main()

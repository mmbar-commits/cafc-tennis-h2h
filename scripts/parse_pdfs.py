import glob
import json
import os
import re
import subprocess
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BASE_DIR = str(ROOT / "pdfs")
OUT_DIR = str(ROOT / "data")


def pdftotext_layout(pdf_path):
    res = subprocess.run(
        ["pdftotext", "-layout", pdf_path, "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout


def normalize_phone(raw_phone):
    """Normalize phone number to canonical digits with leading + (e.g. +212600000000)."""
    if not raw_phone:
        return None
    s = raw_phone.strip()
    # Keep digits and leading +
    digits = re.sub(r"\D", "", s)
    if not digits:
        return None
    # Handle Moroccan local numbers like 06... or 07... -> +2126...
    if s.startswith("00"):
        digits = digits[2:]
        return "+" + digits
    if s.startswith("+"):
        # Sometimes people write +212 06... -> +2126...
        if digits.startswith("2120") and len(digits) == 13:
            digits = "212" + digits[4:]
        return "+" + digits
    if len(digits) == 10 and digits.startswith(("06", "07", "05")):
        return "+212" + digits[1:]
    if len(digits) == 9 and digits.startswith(("6", "7")):
        return "+212" + digits
    return "+" + digits


def clean_name(raw_name):
    """Strip emojis, replacement boxes, extra whitespace, punctuation artifacts."""
    if not raw_name:
        return ""
    # Remove Private Use Area, Box Drawing, replacement chars, variation selectors, symbols/emojis
    cleaned_chars = []
    for ch in raw_name:
        cat = unicodedata.category(ch)
        cp = ord(ch)
        # Keep letters, marks, spaces, hyphens, apostrophes, dots, parentheses (for rare notes), digits only if part of name?
        if ch in ("-", "'", "’", ".", " ", "/"):
            cleaned_chars.append(ch)
        elif cat.startswith(("L", "M")):
            cleaned_chars.append(ch)
        elif ch in ("(", ")"):
            cleaned_chars.append(ch)
        else:
            # Replace symbols/emojis/boxes with space
            cleaned_chars.append(" ")
    s = "".join(cleaned_chars)
    s = re.sub(r"\s+", " ", s).strip()
    # Strip leading/trailing dashes or dots
    s = s.strip(" -–—•·")
    return s


# Phone regex at end of player string (or inside it)
# Matches: +212 6 00 00 00 00, +1 555 000 0000, +33 6 00 00 00 00, +44 70 0000 0000, 06 61 ..., 00212 ...
PHONE_RE = re.compile(
    r"(?P<phone>(?:\+|00)\s*\d[\d\s.\-()]{6,20}\d|\b0[567][\d\s.\-]{7,15}\d)\s*$"
)


def split_player_and_phone(raw_player_str):
    s = raw_player_str.strip()
    # Also check if there's trailing parentheses or notes after phone? Usually phone is at end.
    m = PHONE_RE.search(s)
    if m:
        phone_raw = m.group("phone").strip()
        name_raw = s[: m.start()].strip()
        return clean_name(name_raw), normalize_phone(phone_raw), phone_raw
    # Check if phone appears in middle (e.g. "+212 6... (Note)")
    m2 = re.search(r"(?P<phone>(?:\+|00)\s*\d[\d\s.\-()]{6,20}\d|\b0[567][\d\s.\-]{7,15}\d)", s)
    if m2:
        phone_raw = m2.group("phone").strip()
        name_raw = (s[: m2.start()] + " " + s[m2.end() :]).strip()
        return clean_name(name_raw), normalize_phone(phone_raw), phone_raw
    return clean_name(s), None, None


def parse_division_from_filename(fname):
    """Extract clean division label and sort rank from filename."""
    # Remove prefix and suffix
    base = fname.replace(" - Matchs.pdf", "").replace(" - Classification.pdf", "")
    # Remove leading "00 - " prefix if present
    base = re.sub(r"^\d+\s*-\s*", "", base)
    # Match patterns
    if "Tableau 125" in base:
        return "Tableau 125", 125, "Tournoi"
    if "Tableau 250" in base:
        return "Tableau 250", 250, "Tournoi"

    # Extract after last " - " or "Division ..."
    m = re.search(r"(Division\s+.*|\d+(?:ère|ème)\s+Div|Accès\s*\d*)$", base)
    div_raw = m.group(1).strip() if m else base

    # Check emojis
    if "🌟" in div_raw:
        return "Division Étoile", 0, "A"
    if "⭐" in div_raw:
        return "Division Étoile B", 0.5, "A"
    if "🐣" in div_raw:
        return "Division Poussin", 0.5, "A"

    # Normalize keycap digits: 1️⃣ or 1⃣ -> 1, 🔟 -> 10
    d = div_raw.replace("🔟", "10")
    d = re.sub(r"[\ufe0f\u20e3]", "", d)
    is_acces = "Accès" in d or "Acce" in d

    m_num = re.search(r"(\d+)", d)
    if m_num:
        num = int(m_num.group(1))
        if "Accès" in d and "Division" not in d:
            return f"Accès {num}", 90 + num, "C"
        label = f"Division {num}" + (" (Accès)" if is_acces else "")
        tier = "A" if num <= 5 else ("B" if num <= 11 else "C")
        return label, num, tier

    return div_raw, 99, "Other"


def parse_season_meta(season_folder):
    if season_folder == "Tournoi_02.2024":
        return {
            "id": "tournoi_2024_02",
            "order": 5.5,
            "label": "Tournoi 02.2024",
            "full_name": "Tournoi CAFC Tennis (02.2024)",
            "period": "02.2024",
            "type": "tournoi",
        }
    m = re.match(r"^(\d+)\s*-\s*Saison\s+(.+?)\s*\(([^)]+)\)$", season_folder)
    if m:
        order = int(m.group(1))
        label = m.group(2).strip().replace("Éte", "Été").replace("-", "/")
        period = m.group(3).strip()
        return {
            "id": f"s{order:02d}",
            "order": order,
            "label": label,
            "full_name": f"Saison {label} ({period})",
            "period": period,
            "type": "ligue",
        }
    return {
        "id": season_folder,
        "order": 999,
        "label": season_folder,
        "full_name": season_folder,
        "period": "",
        "type": "ligue",
    }


def parse_matchs_pdf(pdf_path, season_meta, div_label, div_rank):
    text = pdftotext_layout(pdf_path)
    pages = text.split("\x0c")
    matches = []
    unplayed = 0
    warnings = []
    current_round = ""

    # Skip page 0 (cover page)
    for page_idx, page in enumerate(pages[1:], start=2):
        lines = page.splitlines()
        # Filter out footer and empty lines while keeping structure
        clean_lines = []
        for raw_line in lines:
            s = raw_line.strip()
            if not s:
                continue
            if "TALENT APPS" in s.upper() or "WINNER" in s.upper() and "©" in s:
                continue
            if s in ("Ligue", "Élimination"):
                continue
            clean_lines.append(raw_line)

        i = 0
        while i < len(clean_lines):
            line = clean_lines[i]
            s = line.strip()

            # Check round header (e.g. "Journée 1", "Huitièmes de finale", "Quarts de finale 1", "Demi-finales", "Finale", "3ème place")
            if re.match(
                r"^(Journée\s+\d+|Huitièmes de finale.*|Quarts de finale.*|Demi-finales.*|Finale.*|3ème place.*|Tour\s+\d+.*)$",
                s,
                re.IGNORECASE,
            ):
                current_round = s
                i += 1
                continue

            # Now expect a match block (2 player lines, possibly with "Aucun résultat" between them or on one of them)
            # Case 1: Next line is "Aucun résultat"
            if i + 2 < len(clean_lines) and clean_lines[i + 1].strip() == "Aucun résultat":
                unplayed += 1
                i += 3
                continue

            # Case 2: "Aucun résultat" on the same line as player 1 or player 2
            if "Aucun résultat" in line:
                # Could be player1 + Aucun résultat, followed by player2
                unplayed += 1
                # Advance past player2 if next line isn't a round header
                if i + 1 < len(clean_lines) and not re.match(
                    r"^(Journée\s+\d+|Huitièmes|Quarts|Demi-finales|Finale|3ème)",
                    clean_lines[i + 1].strip(),
                    re.I,
                ):
                    i += 2
                else:
                    i += 1
                continue

            if i + 1 < len(clean_lines) and "Aucun résultat" in clean_lines[i + 1]:
                unplayed += 1
                i += 2
                continue

            # Check if Exemption (bye in tournament)
            if s == "Exemption" or (i + 1 < len(clean_lines) and clean_lines[i + 1].strip() == "Exemption"):
                unplayed += 1
                i += 2
                continue

            # Otherwise, expect TWO played lines: line1 (player 1 + scores) and line2 (player 2 + scores)
            if i + 1 >= len(clean_lines):
                warnings.append(f"Dangling line in {os.path.basename(pdf_path)} p.{page_idx}: {s}")
                i += 1
                continue

            l1 = clean_lines[i]
            l2 = clean_lines[i + 1]

            # Split each line into left (player+phone) and right (scores)
            # Scores are at the right end, separated by >= 2 spaces from left part, consisting only of digits and spaces
            score_re = re.compile(r"^(?P<left>.+?)\s{2,}(?P<scores>\d+(?:\s+\d+)*)\s*$")
            m1 = score_re.match(l1)
            m2 = score_re.match(l2)

            if not m1 or not m2:
                # Could there be a match without score or weird formatting?
                warnings.append(
                    f"Unparsed pair in {os.path.basename(pdf_path)} p.{page_idx}:\n  L1: {l1!r}\n  L2: {l2!r}"
                )
                i += 1
                continue

            p1_raw = m1.group("left").strip()
            p2_raw = m2.group("left").strip()
            s1_nums = [int(x) for x in m1.group("scores").split()]
            s2_nums = [int(x) for x in m2.group("scores").split()]

            if len(s1_nums) != len(s2_nums) or len(s1_nums) < 2:
                warnings.append(
                    f"Score length mismatch in {os.path.basename(pdf_path)} p.{page_idx}: {p1_raw} {s1_nums} vs {p2_raw} {s2_nums}"
                )
                i += 2
                continue

            p1_sets_games = s1_nums[:-1]
            p2_sets_games = s2_nums[:-1]
            p1_sets_won = s1_nums[-1]
            p2_sets_won = s2_nums[-1]

            p1_name, p1_phone, p1_phone_raw = split_player_and_phone(p1_raw)
            p2_name, p2_phone, p2_phone_raw = split_player_and_phone(p2_raw)

            # Determine winner
            if p1_sets_won > p2_sets_won:
                winner = 1
            elif p2_sets_won > p1_sets_won:
                winner = 2
            else:
                winner = 0  # draw / anomalous
                warnings.append(
                    f"Tie sets in {os.path.basename(pdf_path)} p.{page_idx}: {p1_name} {s1_nums} vs {p2_name} {s2_nums}"
                )

            # Detect special match flags:
            # Super tiebreak: 3rd set is 1-0 or 0-1
            is_stb = (
                len(p1_sets_games) == 3
                and ((p1_sets_games[2] == 1 and p2_sets_games[2] == 0) or (p1_sets_games[2] == 0 and p2_sets_games[2] == 1))
            )
            # Possible WO / forfeit (1-0 1-0 or 0-1 0-1)
            is_wo = (
                len(p1_sets_games) == 2
                and ((p1_sets_games == [1, 1] and p2_sets_games == [0, 0]) or (p1_sets_games == [0, 0] and p2_sets_games == [1, 1]))
            )
            # Possible retirement / incomplete set (e.g. winner has < 6 games in last set and not STB and not WO)
            last_max = max(p1_sets_games[-1], p2_sets_games[-1])
            is_ret = (not is_stb) and (not is_wo) and (last_max < 6)

            matches.append(
                {
                    "season_id": season_meta["id"],
                    "season_order": season_meta["order"],
                    "season_label": season_meta["label"],
                    "season_type": season_meta["type"],
                    "division": div_label,
                    "division_rank": div_rank,
                    "round": current_round,
                    "p1_raw": p1_raw,
                    "p1_name": p1_name,
                    "p1_phone": p1_phone,
                    "p2_raw": p2_raw,
                    "p2_name": p2_name,
                    "p2_phone": p2_phone,
                    "sets": list(zip(p1_sets_games, p2_sets_games)),
                    "p1_sets_won": p1_sets_won,
                    "p2_sets_won": p2_sets_won,
                    "winner": winner,
                    "is_stb": is_stb,
                    "is_wo": is_wo,
                    "is_ret": is_ret,
                    "source_file": os.path.basename(pdf_path),
                }
            )
            i += 2

    return matches, unplayed, warnings


def parse_classif_pdf(pdf_path, season_meta, div_label, div_rank):
    text = pdftotext_layout(pdf_path)
    pages = text.split("\x0c")
    rows = []
    warnings = []

    row_re = re.compile(
        r"^\s*(?P<rank>\d+)\s+(?P<player>.+?)\s{2,}(?P<j>\d+)\s+(?P<dsets>[+\-]?\d+)\s+(?P<dgames>[+\-]?\d+)\s+(?P<pts>\d+)\s*$"
    )
    for page in pages[1:]:
        for line in page.splitlines():
            m = row_re.match(line)
            if m:
                raw_p = m.group("player").strip()
                name, phone, _ = split_player_and_phone(raw_p)
                rows.append(
                    {
                        "season_id": season_meta["id"],
                        "season_order": season_meta["order"],
                        "season_label": season_meta["label"],
                        "division": div_label,
                        "division_rank": div_rank,
                        "rank": int(m.group("rank")),
                        "raw": raw_p,
                        "name": name,
                        "phone": phone,
                        "j": int(m.group("j")),
                        "dsets": int(m.group("dsets")),
                        "dgames": int(m.group("dgames")),
                        "pts": int(m.group("pts")),
                        "source_file": os.path.basename(pdf_path),
                    }
                )
    return rows, warnings


def main():
    all_matches = []
    all_classifs = []
    all_warnings = []
    total_unplayed = 0

    season_dirs = sorted(os.listdir(BASE_DIR))
    for s_dir in season_dirs:
        s_path = os.path.join(BASE_DIR, s_dir)
        if not os.path.isdir(s_path):
            continue
        s_meta = parse_season_meta(s_dir)

        for kind in ("matchs", "tournoi"):
            k_dir = os.path.join(s_path, kind)
            if not os.path.isdir(k_dir):
                continue
            for fname in sorted(os.listdir(k_dir)):
                if not fname.endswith(".pdf"):
                    continue
                div_label, div_rank, _ = parse_division_from_filename(fname)
                ms, unp, warns = parse_matchs_pdf(os.path.join(k_dir, fname), s_meta, div_label, div_rank)
                all_matches.extend(ms)
                total_unplayed += unp
                all_warnings.extend(warns)

        c_dir = os.path.join(s_path, "classif")
        if os.path.isdir(c_dir):
            for fname in sorted(os.listdir(c_dir)):
                if not fname.endswith(".pdf"):
                    continue
                div_label, div_rank, _ = parse_division_from_filename(fname)
                cs, warns = parse_classif_pdf(os.path.join(c_dir, fname), s_meta, div_label, div_rank)
                all_classifs.extend(cs)
                all_warnings.extend(warns)

    print(f"Parsed {len(all_matches)} played matches ({total_unplayed} unplayed/byes)")
    print(f"Parsed {len(all_classifs)} classification entries")
    print(f"Parser warnings: {len(all_warnings)}")
    for w in all_warnings[:30]:
        print("  WARN:", w)

    # Save raw parsed outputs
    with open(os.path.join(OUT_DIR, "raw_matches.json"), "w") as f:
        json.dump(all_matches, f, indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "raw_classifs.json"), "w") as f:
        json.dump(all_classifs, f, indent=2, ensure_ascii=False)

    # AUDIT 1: Cross-verify matches vs classifications per (season_id, division)
    # Use raw player string (or phone) to match within same division
    calc = defaultdict(lambda: defaultdict(lambda: {"j": 0, "dsets": 0, "dgames": 0}))
    for m in all_matches:
        if m["season_type"] != "ligue":
            continue
        key = (m["season_id"], m["division"])
        k1 = m["p1_phone"] or m["p1_name"]
        k2 = m["p2_phone"] or m["p2_name"]
        calc[key][k1]["j"] += 1
        calc[key][k2]["j"] += 1
        calc[key][k1]["dsets"] += m["p1_sets_won"] - m["p2_sets_won"]
        calc[key][k2]["dsets"] += m["p2_sets_won"] - m["p1_sets_won"]
        g1 = sum(a for a, b in m["sets"])
        g2 = sum(b for a, b in m["sets"])
        calc[key][k1]["dgames"] += g1 - g2
        calc[key][k2]["dgames"] += g2 - g1

    mismatches = 0
    checked = 0
    for c in all_classifs:
        key = (c["season_id"], c["division"])
        k = c["phone"] or c["name"]
        st = calc[key][k]
        checked += 1
        if st["j"] != c["j"] or st["dsets"] != c["dsets"] or st["dgames"] != c["dgames"]:
            mismatches += 1
            if mismatches <= 30:
                print(
                    f"  MISMATCH {c['season_id']} {c['division']} {c['name']} ({c['phone']}): "
                    f"calc=(J={st['j']}, dS={st['dsets']}, dG={st['dgames']}) vs "
                    f"classif=(J={c['j']}, dS={c['dsets']}, dG={c['dgames']})"
                )
    print(f"Cross-verification against Classification PDFs: {checked} player-seasons checked, {mismatches} mismatches")

    # AUDIT 2: Missing phones, homonyms (same name -> multiple phones), shared phones (same phone -> multiple names)
    no_phone = set()
    name_to_phones = defaultdict(set)
    phone_to_names = defaultdict(set)
    for m in all_matches:
        for side in ("p1", "p2"):
            nm = m[f"{side}_name"]
            ph = m[f"{side}_phone"]
            if not ph:
                no_phone.add((nm, m["season_id"], m["division"], m[f"{side}_raw"]))
            else:
                name_to_phones[nm.lower()].add((nm, ph))
                phone_to_names[ph].add(nm)
    for c in all_classifs:
        nm, ph = c["name"], c["phone"]
        if not ph:
            no_phone.add((nm, c["season_id"], c["division"], c["raw"]))
        else:
            name_to_phones[nm.lower()].add((nm, ph))
            phone_to_names[ph].add(nm)

    print(f"\nEntries WITHOUT phone number: {len(no_phone)}")
    for x in sorted(no_phone)[:30]:
        print("  NO_PHONE:", x)

    homonyms = {k: sorted({ph for _, ph in v}) for k, v in name_to_phones.items() if len({ph for _, ph in v}) > 1}
    print(f"\nNames with MULTIPLE phone numbers (homonyms or phone changes): {len(homonyms)}")
    for k, phones in sorted(homonyms.items()):
        print(f"  NAME '{k}': {phones}")

    multi_names = {ph: sorted(nms) for ph, nms in phone_to_names.items() if len(nms) > 1}
    print(f"\nPhone numbers with MULTIPLE name spellings (typos/variants or shared family phone): {len(multi_names)}")
    for ph, nms in sorted(multi_names.items()):
        print(f"  PHONE {ph}: {nms}")


if __name__ == "__main__":
    main()

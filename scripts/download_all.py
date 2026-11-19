import json, os, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
from concurrent.futures import ThreadPoolExecutor, as_completed

with open(ROOT / "data" / "seasons_manifest.json") as f:
    seasons = json.load(f)

base_dir = str(ROOT / "pdfs")
os.makedirs(base_dir, exist_ok=True)

tasks = []

def collect_matchs(node, season_key):
    for c in node.get("children", []):
        if c["mimeType"] == "application/pdf" and "Matchs.pdf" in c["name"]:
            tasks.append(("matchs", season_key, c["id"], c["name"]))
        elif c["mimeType"] == "application/vnd.google-apps.folder":
            collect_matchs(c, season_key)

def collect_final_classifs(season_node, season_key):
    # Find Tableaux folder
    for c in season_node.get("children", []):
        if c["mimeType"] == "application/vnd.google-apps.folder" and "Tableaux" in c["name"]:
            subfolders = [x for x in c.get("children", []) if x["mimeType"] == "application/vnd.google-apps.folder"]
            pdfs = [x for x in c.get("children", []) if x["mimeType"] == "application/pdf" and "Classification.pdf" in x["name"]]
            if subfolders:
                # Take the last sorted subfolder (final snapshot)
                final_sub = sorted(subfolders, key=lambda x: x["name"])[-1]
                for x in final_sub.get("children", []):
                    if x["mimeType"] == "application/pdf" and "Classification.pdf" in x["name"]:
                        tasks.append(("classif", season_key, x["id"], x["name"]))
            for x in pdfs:
                tasks.append(("classif", season_key, x["id"], x["name"]))

for s in seasons:
    s_key = s["name"].replace("/", "-")
    collect_matchs(s, s_key)
    collect_final_classifs(s, s_key)

# Also add Tournoi 02.2024
tasks.append(("tournoi", "Tournoi_02.2024", "1P3Vx99UC9DOuN8QlLuP3QuCOE3vESXBT", "CAFC Tennis (02.2024) - Tableau 125 - Matchs.pdf"))
tasks.append(("tournoi", "Tournoi_02.2024", "1P3uRc_i2Sm5mj6NNJIeD8EIf4MoZkDow", "CAFC Tennis (02.2024) - Tableau 250 - Matchs.pdf"))

print(f"Total files to download: {len(tasks)}")
from collections import Counter
print("By kind:", Counter(t[0] for t in tasks))

def download_one(item):
    kind, s_key, fid, fname = item
    out_dir = os.path.join(base_dir, s_key, kind)
    os.makedirs(out_dir, exist_ok=True)
    safe_name = fname.replace("/", "-")
    out_path = os.path.join(out_dir, safe_name)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        return (True, out_path, "cached")
    for attempt in range(3):
        res = subprocess.run(["gdrive", "readonly", "download", fid, "--out", out_path], capture_output=True, text=True)
        if res.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return (True, out_path, "ok")
    return (False, out_path, res.stderr.strip())

ok = 0
fail = 0
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = [ex.submit(download_one, t) for t in tasks]
    for i, f in enumerate(as_completed(futs), 1):
        success, path, msg = f.result()
        if success:
            ok += 1
        else:
            fail += 1
            print(f"FAIL: {path} -> {msg}")
        if i % 50 == 0 or i == len(tasks):
            print(f"Progress: {i}/{len(tasks)} (ok={ok}, fail={fail})")

print(f"DONE: ok={ok}, fail={fail}")

import subprocess, json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent

def ls_folder(fid):
    out = subprocess.check_output(["gdrive", "readonly", "ls", fid, "--json"]).decode()
    return json.loads(out)

def walk(fid, depth=0):
    items = sorted(ls_folder(fid), key=lambda x: x["name"])
    for item in items:
        mtype = item["mimeType"].split(".")[-1]
        indent = "  " * depth
        print(f"{indent}[{mtype}] {item['name']} ({item['id']})")
        if item["mimeType"] == "application/vnd.google-apps.folder":
            item["children"] = walk(item["id"], depth + 1)
    return items

root = "1aOnE_YANGFflKt36KOk1naXklwJZcLpY"
tree = walk(root)
with open(ROOT / "data" / "seasons_manifest.json", "w") as f:
    json.dump(tree, f, indent=2, ensure_ascii=False)

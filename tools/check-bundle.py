"""Check a module bundle the way Companion's "Import offline module bundle" reads it
(companion/lib/Instance/InstalledModulesManager.ts, listModuleDirsInTar):
the first entry is the root directory; every <root>/<module>/companion/manifest.json
(exactly one folder deep) is one module."""
import json, sys, tarfile

with tarfile.open(sys.argv[1], "r:gz") as t:
    members = t.getmembers()
    first = members[0]
    if not first.isdir():
        sys.exit(f"First entry {first.name!r} is not the root directory")
    root = first.name.rstrip("/") + "/"
    found = []
    for m in members:
        rel = m.name[len(root):] if m.name.startswith(root) else m.name
        if rel.endswith("/companion/manifest.json"):
            folder = rel[: -len("/companion/manifest.json")]
            if "/" not in folder:
                manifest = json.load(t.extractfile(m))
                found.append(f"{manifest['id']} {manifest['version']} ({manifest.get('type', 'connection')}) in {folder}/")
    if not found:
        sys.exit("No modules found in bundle")
    print("\n".join(found))

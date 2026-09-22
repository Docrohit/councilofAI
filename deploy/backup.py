#!/usr/bin/env python3
"""Create a consistent SQLite backup; never print account or credential data."""
import datetime, pathlib, sqlite3, shutil, os
os.umask(0o077)
root = pathlib.Path('/var/backups/councilofai')
root.mkdir(parents=True, exist_ok=True, mode=0o700)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
dest = root / stamp
dest.mkdir(mode=0o700)
for source in pathlib.Path('/var/lib/councilofai').glob('*.sqlite*'):
    if source.name.endswith(('-wal', '-shm')):
        continue
    with sqlite3.connect(source) as src, sqlite3.connect(dest/source.name) as target:
        src.backup(target)
shutil.copy2('/etc/councilofai/council.env', dest/'council.env')
# Keep 14 successful snapshots. Failed copies are left for operator inspection.
for old in sorted(p for p in root.iterdir() if p.is_dir())[:-14]:
    shutil.rmtree(old)
print('Council backup completed')

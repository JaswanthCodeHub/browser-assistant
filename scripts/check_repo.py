"""Offline publication checks; run from any directory with Node available."""
import ast
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'extension/manifest.json').read_text(encoding='utf-8'))
refs = [manifest['background']['service_worker'], manifest['action']['default_popup'], 'editor-bridge.js']
for group in manifest['content_scripts']:
    refs.extend(group.get('js', []) + group.get('css', []))
for ref in refs:
    assert (ROOT / 'extension' / ref).is_file(), f'Missing extension file: {ref}'
for path in (ROOT / 'extension').glob('*.js'):
    subprocess.run(['node', '--check', str(path)], check=True)
for folder in ('server', 'scripts'):
    for path in (ROOT / folder).glob('*.py'):
        ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
assert f'version="{manifest["version"]}"' in (ROOT / 'server/main.py').read_text(encoding='utf-8')
paths = list(ROOT.glob('*.md')) + list((ROOT / 'docs').glob('*.md'))
for path in paths:
    if path.name == 'QA_REPORT.md':
        continue
    source = path.read_text(encoding='utf-8')
    assert not re.search(r'YOUR_USERNAME|your-username|INSERT EMAIL', source), path
    for link in re.findall(r'\]\(([^)]+)\)', source):
        if '://' in link or link.startswith(('#', 'mailto:')):
            continue
        target = link.split('#')[0]
        assert (path.parent / target).exists(), f'Broken link: {path.name}: {target}'
print('Manifest references, versions, JS/Python syntax, and local documentation file links passed.')

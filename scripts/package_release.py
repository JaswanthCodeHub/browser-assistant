"""Allowlisted archives only; no recursive source-folder packaging."""
import argparse
import json
import hashlib
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ('manifest.json', 'background.js', 'editor-bridge.js', 'automation-policy.js',
             'question-visuals.js', 'answer-requests.js', 'coding-automation.js', 'coding-batch.js', 'content.js', 'journal-automation.js', 'popup.html', 'popup.js', 'styles.css')
BACKEND = ('server/main.py', 'server/code_contract.py', 'server/local_security.py', 'server/vision_images.py', 'server/journal.py', 'server/journal_prompt.md', 'server/journal_syllabus.json', 'server/practice_quiz.html', 'server/requirements.txt', 'server/requirements.lock.txt',
           'server/.env.example', 'server/Dockerfile', 'server/.dockerignore',
           'docker-compose.yml', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CHANGELOG.md',
           'docs/SETUP.md', 'docs/API.md', 'docs/JOURNALS.md', 'docs/ARCHITECTURE.md', 'docs/AUDIT.md', 'docs/LAUNCH.md',
           'docs/ROADMAP.md', 'docs/RELEASE_NOTES.md', 'docs/FEATURE_PRESERVATION.md', 'docs/REPAIR_REPORT.md')


def release_files():
    extension = tuple('extension/' + path for path in EXTENSION) + ('LICENSE',)
    typescript = ('extension/src/assistant.d.ts', *(
        'extension/src/' + Path(name).with_suffix('.ts').name
        for name in EXTENSION if name.endswith('.js')
    ))
    extension_assets = tuple(name for name in extension if not name.endswith('.js'))
    tests = tuple(path.relative_to(ROOT).as_posix() for path in sorted((ROOT/'extension').glob('*.test.cts')))
    tests += tuple(path.relative_to(ROOT).as_posix() for path in sorted((ROOT/'server').glob('test_*.py')))
    source = tuple(dict.fromkeys((*extension_assets, *typescript, *BACKEND, *tests, 'extension/fixtures/ccbp-ordering.html',
        'package.json','package-lock.json','tsconfig.json','.gitignore','.editorconfig','AGENTS.md','scripts/check_repo.py',
        'scripts/package_release.py','scripts/start_journal_assistant.ps1','scripts/smoke_backend.py',
        'integrations/n8n/journal-whatsapp-reminder.json','integrations/n8n/README.md',
        '.github/workflows/ci.yml','.github/workflows/release.yml')))
    return [('extension',extension),('backend',BACKEND),('source',source)]


def validate_inputs(groups):
    manifest = json.loads((ROOT/'extension/manifest.json').read_text(encoding='utf-8'))
    npm_package = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
    npm_lock = json.loads((ROOT/'package-lock.json').read_text(encoding='utf-8'))
    assert npm_package['version'] == manifest['version'], 'npm version must match the extension manifest'
    assert npm_lock['version'] == npm_package['version'], 'npm lockfile version must match package.json'

    license_bytes = (ROOT/'LICENSE').read_bytes()
    license_text = license_bytes.decode('utf-8')
    assert 'MIT License' in license_text, 'Root LICENSE must retain the MIT license'
    assert 'Copyright (c) 2024-present Browser Assistant Contributors' in license_text, 'Original copyright notice is missing'
    assert 'The above copyright notice and this permission notice shall be included' in license_text, 'MIT notice-preservation condition is missing'
    assert npm_package.get('license') == 'MIT', 'package.json license metadata must remain MIT'

    npm_runtime = {'extension/' + path for path in EXTENSION}
    npm_runtime.update(path for path in BACKEND if path.startswith('server/')
                       and Path(path).name not in {'Dockerfile', '.dockerignore'})
    expected_npm_files = npm_runtime | {'LICENSE'}
    assert set(npm_package['files']) == expected_npm_files, 'npm files must include LICENSE and match the extension/backend runtime'

    assert manifest['manifest_version'] == 3
    for _kind,files in groups:
        assert len(files) == len(set(files)), 'Duplicate release member'
        for name in files:
            path = ROOT/name
            assert path.is_file() and path.resolve().is_relative_to(ROOT.resolve()), f'Invalid release source: {name}'
            assert path.name != '.env' and path.suffix not in {'.db','.log','.zip','.pyc'}, name
            assert not any(part in {'node_modules','__pycache__','.git','.venv','tmp','.cache'} for part in path.parts), name
            text = path.read_text(encoding='utf-8-sig')
            assert not re.search(r'gsk_[a-zA-Z0-9]{24,}|\bsk-[a-zA-Z0-9]{24,}',text), f'Credential-like value in release input: {name}'
    for line in (ROOT/'server/.env.example').read_text().splitlines():
        if re.match(r'GROQ_API_KEY(?:_[23])?=',line):
            assert not line.split('=',1)[1].strip(), 'Example keys must be empty'
    assert f'version="{manifest["version"]}"' in (ROOT/'server/main.py').read_text(encoding='utf-8')
    runtime = {manifest['background']['service_worker'],manifest['action']['default_popup']}
    for group in manifest['content_scripts']:
        runtime.update(group.get('js',[])+group.get('css',[]))
    assert runtime.issubset(EXTENSION), 'Manifest runtime file is absent from the archive'
    docker_allowed = set(re.findall(r'^!(.+)$',(ROOT/'server/.dockerignore').read_text(),re.M))
    for line in (ROOT/'server/Dockerfile').read_text().splitlines():
        if line.startswith('COPY '):
            for source in line.split()[1:-1]:
                assert source in docker_allowed, f'Docker excludes required file: {source}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', help='Release tag, required to match the manifest if supplied')
    parser.add_argument('--validate-only',action='store_true',help='Validate every input without creating archives')
    args = parser.parse_args()
    version = json.loads((ROOT / 'extension/manifest.json').read_text())['version']
    if args.tag and args.tag != f'v{version}':
        parser.error('Tag must match extension manifest version')
    groups = release_files()
    validate_inputs(groups)
    if args.validate_only:
        print('All release inputs validated; no ZIP created.')
        return
    out = ROOT / 'dist' / f'v{version}'
    out.mkdir(parents=True, exist_ok=True)
    artifacts = []
    expected_license = (ROOT/'LICENSE').read_bytes()
    for kind, files in groups:
        path = out / f'browser-assistant-{kind}-v{version}.zip'
        with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
            for name in files:
                arcname = name.removeprefix('extension/') if kind == 'extension' else name
                archive.write(ROOT / name, arcname)
        with ZipFile(path) as archive:
            assert archive.testzip() is None
            assert 'LICENSE' in archive.namelist(), f'{kind} archive is missing LICENSE'
            assert archive.read('LICENSE') == expected_license, f'{kind} archive changed the original LICENSE notice'
            if kind == 'extension':
                manifest = json.loads(archive.read('manifest.json'))
                for group in manifest['content_scripts']:
                    for ref in group.get('js', []) + group.get('css', []):
                        assert ref in archive.namelist(), f'Missing packaged runtime file: {ref}'
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        path.with_suffix('.zip.sha256').write_text(digest+'  '+path.name+'\n')
        artifacts.append({'file': path.name, 'bytes': path.stat().st_size,
                          'sha256': digest, 'members': len(files)})
        print(f'Created {path.name} ({len(files)} allowlisted files, {path.stat().st_size} bytes)')
    (out/'release-manifest.json').write_text(json.dumps(
        {'version': version, 'artifacts': artifacts}, indent=2)+'\n', encoding='utf-8')

if __name__ == '__main__':
    main()

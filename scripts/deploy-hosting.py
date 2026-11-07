"""Publish the built frontend using the current gcloud login, without CLI tokens.

Run `npm run build` first, then `python scripts/deploy-hosting.py`.
Only the site explicitly named in firebase.json is updated.
"""
import concurrent.futures
import gzip
import hashlib
import json
import pathlib
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = 'dallasurbanists-idea-map-dev'
CONFIG = json.loads((ROOT / 'firebase.json').read_text(encoding='utf-8'))['hosting']
SITE = CONFIG['site']
if SITE != 'dallasurbanists-walk-audit':
    raise SystemExit('Refusing to publish to an unexpected hosting site.')
directory = ROOT / CONFIG['public']
runtime = json.loads((directory / 'runtime-config.json').read_text(encoding='utf-8'))
if runtime.get('backend') != 'shared':
    raise SystemExit('Build the shared frontend before publishing.')
gcloud = shutil.which('gcloud.cmd') or shutil.which('gcloud')
if not gcloud:
    raise SystemExit('Install Google Cloud CLI and run gcloud auth login.')
token = subprocess.check_output([gcloud, 'auth', 'print-access-token'], text=True).strip()


def call(method, url, body=None, binary=False):
    data = body if binary else None if body is None else json.dumps(body).encode()
    headers = {'Authorization': 'Bearer ' + token, 'X-Goog-User-Project': PROJECT,
               'Content-Type': 'application/octet-stream' if binary else 'application/json'}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=headers), timeout=120) as response:
            content = response.read()
            return json.loads(content) if content else {}
    except urllib.error.HTTPError as error:
        message = json.loads(error.read()).get('error', {}).get('message', 'Upload failed')
        raise RuntimeError(f'Hosting {method} failed ({error.code}): {message}') from None


hosting = {'rewrites': [{'glob': rule['source'], 'path': rule['destination']} for rule in CONFIG['rewrites']],
           'headers': [{'glob': rule['source'], 'headers': {item['key']: item['value'] for item in rule['headers']}}
                       for rule in CONFIG['headers']]}
version = call('POST', f'https://firebasehosting.googleapis.com/v1beta1/sites/{SITE}/versions', {'config': hosting})
name = version['name']
files, payloads = {}, {}
for file in sorted(directory.rglob('*')):
    if not file.is_file() or any(part.startswith('.') for part in file.relative_to(directory).parts):
        continue
    payload = gzip.compress(file.read_bytes(), mtime=0)
    digest = hashlib.sha256(payload).hexdigest()
    files['/' + file.relative_to(directory).as_posix()] = digest
    payloads[digest] = payload
population = call('POST', f'https://firebasehosting.googleapis.com/v1beta1/{name}:populateFiles', {'files': files})
upload_url = population.get('uploadUrl', '')
required = population.get('uploadRequiredHashes', [])
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    results = [executor.submit(call, 'POST', upload_url + '/' + digest, payloads[digest], True) for digest in required]
    for result in results:
        result.result()
call('PATCH', f'https://firebasehosting.googleapis.com/v1beta1/{name}?updateMask=status', {'status': 'FINALIZED'})
release = call('POST', f'https://firebasehosting.googleapis.com/v1beta1/sites/{SITE}/releases?' + urllib.parse.urlencode({'versionName': name}), {'message': 'Shared API frontend release'})
print(f'Published {len(files)} files: https://{SITE}.web.app')
print('Hosting release:', release.get('name', name))

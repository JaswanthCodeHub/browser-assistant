"""Loopback API pairing, request limits and secret-safe error text."""
import hmac
import os
import re
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from starlette.responses import JSONResponse

PROTECTED_ROUTES = {
    '/solve': 512_000, '/solve-vision': 29_000_000, '/journal': 96_000,
    '/history': 512_000, '/provider-status': 8_000,
    '/jobs': 29_000_000,
}


def pairing_token(path: Path) -> str:
    configured = os.getenv('ASSISTANT_LOCAL_TOKEN', '').strip()
    if configured:
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', configured):
            raise RuntimeError('ASSISTANT_LOCAL_TOKEN must have 32–128 URL-safe characters.')
        return configured
    try:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='ascii') as handle:
            handle.write(secrets.token_urlsafe(32))
    except FileExistsError:
        pass
    value = path.read_text(encoding='ascii').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', value):
        raise RuntimeError('Invalid local pairing token file. Check the pairing setup.')
    return value


class LocalBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        limit = PROTECTED_ROUTES.get(scope.get('path', '').rstrip('/'))
        if scope['type'] != 'http' or scope['method'] != 'POST' or limit is None:
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            size += len(chunk)
            if size > limit:
                return await JSONResponse({'detail':'Request exceeds the endpoint size limit.'}, status_code=413)(scope, receive, send)
            if chunk:
                chunks.append(chunk)
            if not message.get('more_body'):
                break

        async def replay():
            nonlocal chunks
            if chunks is None:
                return await receive()
            body = b''.join(chunks)
            chunks = None
            return {'type':'http.request','body':body,'more_body':False}

        return await self.app(scope, replay, send)


def redact(value, secrets=()):
    text = str(value)
    for secret in secrets:
        if secret:
            text = text.replace(secret, '[redacted]')
    return re.sub(r'gsk_[\w-]+|\bsk-[\w-]+|Bearer\s+[^\s,;\"\'}]+', '[redacted]', text, flags=re.I)


def sanitize_data(value, secrets=()):
    if isinstance(value, dict):
        return {key:sanitize_data(item, secrets) for key,item in value.items()}
    if isinstance(value, list):
        return [sanitize_data(item, secrets) for item in value]
    return redact(value, secrets) if isinstance(value, str) else value


def install_local_guards(app):
    allowed_hosts = {'localhost', '127.0.0.1', '::1', 'testserver'}
    allowed_hosts.update(name.strip().lower() for name in os.getenv('SERVER_ALLOWED_HOSTS', '').split(',') if name.strip())

    app.add_middleware(LocalBodyLimit)

    @app.middleware('http')
    async def local_browser_guard(request, call_next):
        try:
            host = urlsplit('http://' + request.headers.get('host', '')).hostname
        except ValueError:
            return JSONResponse({'detail':'Invalid Host header.'}, status_code=400)
        if not host or host.lower() not in allowed_hosts:
            return JSONResponse({'detail':'Host is not allowed for this local API.'}, status_code=400)
        origin = request.headers.get('origin')
        if origin:
            try:
                parsed = urlsplit(origin)
            except ValueError:
                return JSONResponse({'detail':'Invalid Origin header.'}, status_code=403)
            extension_origin = bool(re.fullmatch(r'chrome-extension://[a-p]{32}', origin))
            local_origin = parsed.scheme in {'http', 'https'} and parsed.hostname in {'localhost','127.0.0.1','::1'}
            if not extension_origin and not local_origin:
                return JSONResponse({'detail':'Cross-site access to the local API is not allowed.'}, status_code=403)
        path = request.url.path.rstrip('/')
        if path in PROTECTED_ROUTES or path.startswith('/jobs/'):
            expected = getattr(app.state, 'local_token', '')
            supplied = request.headers.get('x-assistant-token', '')
            if not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
                return JSONResponse({'detail':'Pair the extension with the local server using the toolbar popup.'}, status_code=401)
            length = request.headers.get('content-length')
            if length is not None:
                if not re.fullmatch(r'\d{1,10}', length):
                    return JSONResponse({'detail':'Invalid Content-Length.'}, status_code=400)
                if int(length) > PROTECTED_ROUTES.get(path, 8_000):
                    return JSONResponse({'detail':'Request exceeds the endpoint size limit.'}, status_code=413)
        return await call_next(request)

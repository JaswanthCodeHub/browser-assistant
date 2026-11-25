"""Local browser-request guards and secret-safe error text; no user credentials stored."""
import os
import re
import hmac
from urllib.parse import urlsplit

from starlette.responses import JSONResponse


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
    api_token = os.getenv('SERVER_API_TOKEN', '').strip()

    def public_render_host(host):
        # A Render service is deliberately public, but every API request is
        # protected by SERVER_API_TOKEN. Accepting the assigned onrender.com
        # hostname removes the chicken-and-egg step of knowing it before the
        # first deployment.
        return bool(api_token and host.endswith('.onrender.com'))

    @app.middleware('http')
    async def local_browser_guard(request, call_next):
        try:
            host = urlsplit('http://' + request.headers.get('host', '')).hostname
        except ValueError:
            return JSONResponse({'detail':'Invalid Host header.'}, status_code=400)
        if not host or (host.lower() not in allowed_hosts and not public_render_host(host.lower())):
            return JSONResponse({'detail':'Host is not allowed for this API.'}, status_code=400)
        origin = request.headers.get('origin')
        if origin:
            try:
                parsed = urlsplit(origin)
            except ValueError:
                return JSONResponse({'detail':'Invalid Origin header.'}, status_code=403)
            extension_origin = bool(re.fullmatch(r'chrome-extension://[a-p]{32}', origin))
            local_origin = parsed.scheme in {'http', 'https'} and parsed.hostname in {'localhost','127.0.0.1','::1'}
            if not extension_origin and not local_origin:
                return JSONResponse({'detail':'Cross-site access to this API is not allowed.'}, status_code=403)
        if api_token:
            authorization = request.headers.get('authorization', '')
            scheme, _, supplied = authorization.partition(' ')
            if scheme.lower() != 'bearer' or not supplied or not hmac.compare_digest(supplied, api_token):
                return JSONResponse({'detail':'API authorization is required.'}, status_code=401)
        return await call_next(request)

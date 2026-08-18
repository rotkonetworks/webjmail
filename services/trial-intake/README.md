# trial-intake

Tiny first-party service behind the landing page's **Enterprise trial** form.
It accepts `POST /api/trial` (JSON) and delivers the request to `hq@rotko.net`
by sending through the Rotko **Stalwart** server over **JMAP**
(`Email/set` + `EmailSubmission/set`) — no SMTP, no third party. Python stdlib
only (`http.server`, `urllib`).

## Why a service and not "just proxy the lander to JMAP"

The lander is static HTML — it can't hold a credential. If nginx proxied
`/jmap` straight to Stalwart with hq@'s login injected, **every visitor would be
authenticated as hq@** (full mailbox read + send). This service is the
guardrail: the public can only submit the trial form → one email to hq@.

## Deploy (on web.rotko.net, podman)

Secret lives in `/opt/webjmail-trial/trial.env` (chmod 600):

```
MAIL_USER=hq@rotko.net
MAIL_PASS=<scoped app-password>   # created via Stalwart admin; revocable
MAIL_HOST=mail.rotko.net
MAIL_TO=hq@rotko.net
MAIL_FROM=hq@rotko.net
PORT=8080
```

Both containers share the `webjmail-net` podman network so the lander nginx can
reach `webjmail-trial:8080`:

```sh
podman run -d --name webjmail-trial --restart always --network webjmail-net \
  --env-file /opt/webjmail-trial/trial.env \
  -v /opt/webjmail-trial/server.py:/app/server.py:ro \
  python:3.12-alpine python /app/server.py

podman run -d --name webjmail-lander --restart always --network webjmail-net \
  -p 127.0.0.1:8110:80 \
  -v /srv/webjmail/lander:/usr/share/nginx/html:ro \
  -v /srv/webjmail/lander.nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

**Caveat:** the lander nginx uses a *static* upstream (podman's DNS isn't at
Docker's 127.0.0.11, so a request-time `resolver` doesn't apply). If you
recreate `webjmail-trial` (new container IP), **recreate `webjmail-lander` too**
so nginx re-resolves — otherwise `/api/*` 502s on a stale IP.

## Revoking the credential

Remove the scoped app-password from hq@ via the Stalwart admin API
(`PATCH /api/principal/hq@rotko.net` → `removeItem` on `secrets`). The main
password is untouched.

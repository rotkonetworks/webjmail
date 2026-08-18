#!/usr/bin/env python3
"""webjmail Enterprise trial intake.

A tiny, zero-dependency HTTP service. It accepts the landing page's trial form
(POST /api/trial, JSON) and delivers the request to hq@rotko.net by sending it
through the Rotko Stalwart server over **JMAP** (Email/set + EmailSubmission/set)
— the same protocol the app uses everywhere, over HTTPS/443. No SMTP ports, no
third party. Credentials come from the environment (MAIL_USER / MAIL_PASS, a
scoped app-password), never hard-coded.
"""
import os
import re
import json
import base64
import urllib.request
import urllib.error
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# MAIL_USER/MAIL_PASS are the send identity; fall back to the older SMTP_* names.
USER = os.environ.get("MAIL_USER") or os.environ["SMTP_USER"]
PASS = os.environ.get("MAIL_PASS") or os.environ["SMTP_PASS"]
HOST = os.environ.get("MAIL_HOST") or os.environ.get("SMTP_HOST", "mail.rotko.net")
JMAP_BASE = os.environ.get("JMAP_BASE", "https://" + HOST).rstrip("/")
MAIL_TO = os.environ.get("MAIL_TO", "hq@rotko.net")
MAIL_FROM = os.environ.get("MAIL_FROM", USER)
LISTEN_PORT = int(os.environ.get("PORT", "8080"))

AUTH = "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()
MAIL_URN = "urn:ietf:params:jmap:mail"
CORE_URN = "urn:ietf:params:jmap:core"
SUB_URN = "urn:ietf:params:jmap:submission"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean(v, limit=200):
    """Strip CR/LF and cap length."""
    return re.sub(r"[\r\n]+", " ", str(v or "")).strip()[:limit]


def _get(url):
    req = urllib.request.Request(url, headers={"Authorization": AUTH, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def _post(url, body):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": AUTH, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def send_via_jmap(subject, text, reply_to):
    session = _get(JMAP_BASE + "/jmap/session")
    # Stalwart advertises an INTERNAL apiUrl (e.g. http://mail.rotko.net:18080/jmap/)
    # that sits behind the public reverse proxy. Keep only the path and hit the
    # public HTTPS base (JMAP_BASE) instead — dropping the internal host:port.
    api = JMAP_BASE + urlparse(session["apiUrl"]).path
    account = session["primaryAccounts"][MAIL_URN]

    # Find the Drafts mailbox (submission needs the email to live somewhere) and
    # the sending identity (Stalwart requires identityId on EmailSubmission).
    pre = _post(api, {
        "using": [CORE_URN, MAIL_URN, SUB_URN],
        "methodCalls": [
            ["Mailbox/get", {"accountId": account, "properties": ["id", "role"]}, "0"],
            ["Identity/get", {"accountId": account}, "1"],
        ],
    })["methodResponses"]
    mbs = pre[0][1]["list"]
    drafts = next((m["id"] for m in mbs if m.get("role") == "drafts"), mbs[0]["id"])
    idents = pre[1][1]["list"]
    identity = next((i["id"] for i in idents if i.get("email") == MAIL_FROM), idents[0]["id"])

    resp = _post(api, {
        "using": [CORE_URN, MAIL_URN, SUB_URN],
        "methodCalls": [
            ["Email/set", {
                "accountId": account,
                "create": {"m": {
                    "mailboxIds": {drafts: True},
                    "keywords": {"$draft": True},
                    "from": [{"email": MAIL_FROM}],
                    "to": [{"email": MAIL_TO}],
                    "replyTo": [{"email": reply_to}],
                    "subject": subject,
                    "bodyStructure": {"type": "text/plain", "partId": "b"},
                    "bodyValues": {"b": {"value": text}},
                }},
            }, "0"],
            ["EmailSubmission/set", {
                "accountId": account,
                "onSuccessDestroyEmail": ["#m"],  # remove the draft once sent
                "create": {"s": {
                    "emailId": "#m",
                    "identityId": identity,
                    "envelope": {"mailFrom": {"email": MAIL_FROM}, "rcptTo": [{"email": MAIL_TO}]},
                }},
            }, "1"],
        ],
    })
    for name, args, _cid in resp["methodResponses"]:
        if name == "error":
            raise RuntimeError("jmap error: " + json.dumps(args)[:200])
        if args.get("notCreated"):
            raise RuntimeError("jmap notCreated: " + json.dumps(args["notCreated"])[:200])


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/api/health":
            return self._json(200, {"ok": True})
        return self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/api/trial":
            return self._json(404, {"ok": False, "error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 10_000:
                return self._json(413, {"ok": False, "error": "too large"})
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "bad request"})

        domain = clean(data.get("domain"))
        mailboxes = clean(data.get("mailboxes"), 20)
        email = clean(data.get("email"))
        name = clean(data.get("name"))
        if not (domain and mailboxes and email and name) or not EMAIL_RE.match(email):
            return self._json(400, {"ok": False, "error": "missing or invalid fields"})

        text = "\n".join([
            "webjmail Enterprise trial request", "",
            f"Domain:    {domain}",
            f"Mailboxes: {mailboxes}",
            f"Email:     {email}",
            f"Name:      {name}",
            f"Company:   {clean(data.get('company')) or '-'}",
            f"Phone:     {clean(data.get('phone')) or '-'}",
            f"Address:   {clean(data.get('address')) or '-'}",
            f"City:      {clean(data.get('city')) or '-'}",
            f"Postal:    {clean(data.get('postal')) or '-'}",
            f"Country:   {clean(data.get('country')) or '-'}",
        ])
        try:
            send_via_jmap(f"webjmail Enterprise trial — {domain}", text, email)
        except urllib.error.HTTPError as e:
            print(f"[trial] HTTP {e.code} sending", flush=True)
            return self._json(502, {"ok": False, "error": "could not send"})
        except Exception as e:
            print(f"[trial] send failed: {type(e).__name__}: {str(e)[:160]}", flush=True)
            return self._json(502, {"ok": False, "error": "could not send"})

        print(f"[trial] request from {email} ({domain})", flush=True)
        return self._json(200, {"ok": True})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler).serve_forever()

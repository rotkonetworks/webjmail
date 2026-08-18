# DNS — how we manage it (Porkbun)

`webjmail.com` (and our other domains) live on **Porkbun**, managed over their JSON API.
No dashboard clicking required — everything is scriptable.

## Credentials

Two keys: an **API key** (`pk1_…`) and a **secret key** (`sk1_…`). They're in our secret store
(`~/tommidata/secrets/secret_vault.yaml`, keys `porkbun_api_key` / `porkbun_secret_key`; also in
`porkbun.age`). **Never commit the values.** Load them into the shell first:

```sh
export PORKBUN_API_KEY=$(grep '^porkbun_api_key:'    ~/tommidata/secrets/secret_vault.yaml | awk '{print $2}')
export PORKBUN_SECRET_KEY=$(grep '^porkbun_secret_key:' ~/tommidata/secrets/secret_vault.yaml | awk '{print $2}')
```

> Porkbun requires **API access to be enabled per-domain** (Porkbun dashboard → domain → Details →
> "API Access" toggle). If calls return `NOT_AUTHORIZED`, that's why.

## The CLI: `scripts/porkbun.sh`

`name` is the **subdomain only** — `app`, `www`, `*.dev`, or `""` for the apex.

```sh
./scripts/porkbun.sh list webjmail.com                          # dump all records (+ ids)
./scripts/porkbun.sh set  webjmail.com app  A 157.180.90.37     # create-or-replace app.webjmail.com
./scripts/porkbun.sh set  webjmail.com ""   A 157.180.90.37     # apex
./scripts/porkbun.sh add  webjmail.com _dmarc TXT "v=DMARC1;p=none"
./scripts/porkbun.sh del  webjmail.com 557358471               # delete by record id (from `list`)
```

- **`set`** = idempotent (`editByNameType`, replaces every record of that name+type). Use this for
  A/AAAA/CNAME you want to point somewhere.
- **`add`** = always creates a new record (use for multiple TXT/MX).
- **`del`** = remove one record by the id shown in `list`.

Raw API (if you need something the CLI doesn't wrap): `https://api.porkbun.com/api/json/v3/dns/…`,
every request is a POST with `{"apikey":…,"secretapikey":…, …}` — see
[Porkbun API docs](https://porkbun.com/api/json/v3/documentation).

## Current webjmail.com layout

All A records point at the rotko web box `web.rotko.net` (**157.180.90.37**), which fronts
everything with HAProxy (see [`../DEPLOY.md`](../DEPLOY.md)).

| Name                    | Type | Content          | Serves                          |
| ----------------------- | ---- | ---------------- | ------------------------------- |
| `webjmail.com` (apex)   | A    | 157.180.90.37    | landing page                    |
| `www.webjmail.com`      | A    | 157.180.90.37    | landing page                    |
| `app.webjmail.com`      | A    | 157.180.90.37    | web app (production)            |
| `staging.webjmail.com`  | A    | 157.180.90.37    | web app (staging)               |
| `dev.webjmail.com`      | A    | 157.180.90.37    | dev                             |
| `*.dev.webjmail.com`    | A    | 157.180.90.37    | per-PR previews (`pr<N>.dev.…`) |

`scripts/dns-webjmail.sh` re-applies exactly this set in one shot.

## Common tasks

**Point a new subdomain at the web box**
```sh
./scripts/porkbun.sh set webjmail.com blog A 157.180.90.37
```

**Move a domain to the web box (kill parking first)** — Porkbun parks new domains with an
`ALIAS @ → uixie.porkbun.com` and a `CNAME *.…` wildcard; both must be **deleted** (find their ids
with `list`) or they shadow your records.

**Wildcard for PR previews** — one `*.dev` A record covers every `pr<N>.dev.webjmail.com`. HTTPS for
those needs a **wildcard cert** (`*.dev.webjmail.com`) via Let's Encrypt **DNS-01**, which uses these
same Porkbun keys to write the `_acme-challenge` TXT record.

## Propagation

Records use TTL 600s, but since the zone is on Porkbun's own nameservers, changes resolve within a
minute or two — check with `dig +short app.webjmail.com @1.1.1.1`.

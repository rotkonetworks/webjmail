# Deploying webjmail.com (on web.rotko.net)

Hosted on the rotko web box (`web.rotko.net`, 157.180.90.37): **HAProxy** terminates TLS and
routes by host (`/etc/haproxy/backends.map`), each site is an **nginx:alpine container** on a local
port, certs are Let's Encrypt in `/etc/haproxy/certs/*.pem`.

| Env         | Trigger              | Host(s)                              |
| ----------- | -------------------- | ------------------------------------ |
| **dev**     | pull request         | build + type-check only (CI)          |
| **staging** | push to `master`     | `staging.webjmail.com`                |
| **prod**    | manual "Run workflow"| `webjmail.com`, `www`, `app.webjmail.com` |

## First-time bring-up (blocked on two credentials)

1. **DNS → the box** (Porkbun). Decrypt `~/tommidata/secrets/porkbun.age` (the agent's age
   identity can't read it), then:
   ```
   export PORKBUN_API_KEY=pk1_…  PORKBUN_SECRET_KEY=sk1_…
   ./scripts/dns-webjmail.sh          # A records for @, www, app, staging → 157.180.90.37
   ```

2. **First deploy on the box** (from your machine, with the rotko key):
   ```
   bun run build
   ssh root@web.rotko.net 'mkdir -p /srv/webjmail/lander /srv/webjmail/app'
   rsync -az landing/ root@web.rotko.net:/srv/webjmail/lander/
   rsync -az dist/    root@web.rotko.net:/srv/webjmail/app/
   scp scripts/deploy-webjmail.sh root@web.rotko.net:/root/
   ssh root@web.rotko.net '/root/deploy-webjmail.sh prod'   # containers + HAProxy (validated reload)
   ```
   `deploy-webjmail.sh` is additive and idempotent — new backends + map entries only, backs up
   `haproxy.cfg`/`backends.map` and runs `haproxy -c` before reloading.

3. **Certificates** (once DNS resolves to the box):
   ```
   ssh root@web.rotko.net '/root/deploy-webjmail.sh certs'
   ```

## CI (after bring-up)

Add these GitHub Actions secrets so `master`/manual runs deploy themselves:

```
gh secret set WEBJMAIL_DEPLOY_KEY   # a deploy SSH private key authorized on the box
gh secret set WEBJMAIL_SSH_HOST     # web.rotko.net
gh secret set WEBJMAIL_SSH_USER     # root (or a dedicated deploy user)
```

Then: merge to `master` → staging; Actions → *deploy* → *Run workflow* → prod.

## Notes
- Self-hosted (Stalwart) **web** users must allow `https://app.webjmail.com` via CORS — the lander's
  "Self-hosting" section has copy-paste Caddy/nginx config. The desktop app has no CORS constraint.
- Add a 1200×630 `og.png` to `landing/` before launch (referenced by the OG/Twitter tags).
- Ports used on the box: lander `8110`, app `8111`, staging app `8121`.

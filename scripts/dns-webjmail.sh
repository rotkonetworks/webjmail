#!/usr/bin/env bash
# Point Porkbun DNS for webjmail.com at the rotko web box (web.rotko.net).
#
#   export PORKBUN_API_KEY=pk1_...   PORKBUN_SECRET_KEY=sk1_...
#   ./scripts/dns-webjmail.sh
#
# Porkbun creds live in ~/tommidata/secrets/porkbun.age (encrypted to an age
# recipient the agent couldn't read — decrypt and export the two keys first).
set -euo pipefail

: "${PORKBUN_API_KEY:?set PORKBUN_API_KEY}"
: "${PORKBUN_SECRET_KEY:?set PORKBUN_SECRET_KEY}"

DOMAIN=webjmail.com
IP=157.180.90.37 # web.rotko.net
API=https://api.porkbun.com/api/json/v3

create() { # name  type  content
  echo "→ ${1:-@}.$DOMAIN  $2  $3"
  curl -sS -X POST "$API/dns/create/$DOMAIN" \
    -H 'Content-Type: application/json' \
    -d "{\"apikey\":\"$PORKBUN_API_KEY\",\"secretapikey\":\"$PORKBUN_SECRET_KEY\",\"name\":\"$1\",\"type\":\"$2\",\"content\":\"$3\",\"ttl\":\"600\"}"
  echo
}

create ""        A  "$IP"   # webjmail.com          → lander
create "www"     A  "$IP"   # www.webjmail.com      → lander
create "app"     A  "$IP"   # app.webjmail.com      → web app
create "staging" A  "$IP"   # staging.webjmail.com  → web app (staging)

echo "Done. Once these resolve, issue certs on the box:  ./scripts/deploy-webjmail.sh certs"

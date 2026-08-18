#!/usr/bin/env bash
# Minimal Porkbun DNS CLI. Reads PORKBUN_API_KEY / PORKBUN_SECRET_KEY from env.
#
#   ./porkbun.sh list <domain>
#   ./porkbun.sh set  <domain> <name> <type> <content> [ttl]   # create-or-replace (name "" = apex)
#   ./porkbun.sh add  <domain> <name> <type> <content> [ttl]   # always create a new record
#   ./porkbun.sh del  <domain> <record-id>
#
# name is the subdomain only: "app", "www", "*.dev", or "" for the apex.
set -euo pipefail
: "${PORKBUN_API_KEY:?export PORKBUN_API_KEY}"
: "${PORKBUN_SECRET_KEY:?export PORKBUN_SECRET_KEY}"

API=https://api.porkbun.com/api/json/v3
auth() { printf '"apikey":"%s","secretapikey":"%s"' "$PORKBUN_API_KEY" "$PORKBUN_SECRET_KEY"; }
post() { curl -sS -X POST "$API/$1" -H 'Content-Type: application/json' -d "{$(auth)${2:+,$2}}"; }
show() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status"), d.get("message","")); [print(" ",r["id"],r["type"],r["name"],"->",r["content"]) for r in d.get("records",[])]'; }

cmd=${1:-}; dom=${2:-}
case "$cmd" in
  list) post "dns/retrieve/$dom" | show ;;
  set)  n=$3; t=$4; c=$5; ttl=${6:-600}
        post "dns/editByNameType/$dom/$t/$n" "\"content\":\"$c\",\"ttl\":\"$ttl\"" | show ;;
  add)  n=$3; t=$4; c=$5; ttl=${6:-600}
        post "dns/create/$dom" "\"name\":\"$n\",\"type\":\"$t\",\"content\":\"$c\",\"ttl\":\"$ttl\"" | show ;;
  del)  post "dns/delete/$dom/$3" | show ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac

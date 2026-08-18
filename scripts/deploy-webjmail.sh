#!/usr/bin/env bash
# Deploy webjmail on the rotko web box (HAProxy + per-site nginx:alpine containers).
# Run as root ON web.rotko.net. Static files are expected in the mode's dirs
# (rsync them there first — the CI workflow / DEPLOY.md does this).
#
#   ./deploy-webjmail.sh prod       # webjmail.com (lander) + app.webjmail.com
#   ./deploy-webjmail.sh staging    # staging.webjmail.com (app)
#   ./deploy-webjmail.sh certs      # issue/renew LE certs for all of the above (after DNS)
set -euo pipefail

CFG=/etc/haproxy/haproxy.cfg
MAP=/etc/haproxy/backends.map

spa_conf() { # writes an SPA-fallback nginx conf to $1
  # index.html must always revalidate (so a redeploy is picked up at once);
  # hashed /assets/* are content-addressed and cached forever. Skipping the
  # no-cache on index.html is what left stale clients staring at a blank page.
  cat >"$1" <<'EOF'
server {
  listen 80;
  root /usr/share/nginx/html;
  location /assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }
  location = /index.html { add_header Cache-Control "no-cache, must-revalidate"; }
  location / { try_files $uri $uri/ /index.html; }
}
EOF
}

run_static() { # name  htmldir  port  [spaconf]
  docker rm -f "$1" 2>/dev/null || true
  if [ -n "${4:-}" ]; then
    docker run -d --name "$1" --restart always -p 127.0.0.1:$3:80 \
      -v "$2":/usr/share/nginx/html:ro -v "$4":/etc/nginx/conf.d/default.conf:ro nginx:alpine
  else
    docker run -d --name "$1" --restart always -p 127.0.0.1:$3:80 \
      -v "$2":/usr/share/nginx/html:ro nginx:alpine
  fi
}

add_backend() { grep -q "^backend $1$" "$CFG" || printf '\nbackend %s\n    server %s 127.0.0.1:%s check\n' "$1" "$2" "$3" >>"$CFG"; }
add_map()     { grep -q "^$1 " "$MAP" || echo "$1 $2" >>"$MAP"; }

wire() { # after container + backend/map edits: validate then reload
  cp "$CFG" "$CFG.bak-webjmail-$(date +%s)"; cp "$MAP" "$MAP.bak-webjmail-$(date +%s)"
  haproxy -c -f "$CFG"
  systemctl reload haproxy
  echo "haproxy validated + reloaded"
}

deploy_prod() {
  local R=/srv/webjmail
  spa_conf "$R/app.nginx.conf"
  run_static webjmail-lander "$R/lander" 8110
  run_static webjmail-app    "$R/app"    8112 "$R/app.nginx.conf"
  add_backend be_webjmail_com     webjmail-lander 8110
  add_backend be_app_webjmail_com webjmail-app    8112
  add_map webjmail.com     be_webjmail_com
  add_map www.webjmail.com be_webjmail_com
  add_map app.webjmail.com be_app_webjmail_com
  wire
}

deploy_staging() {
  local R=/srv/webjmail
  spa_conf "$R/app-staging.nginx.conf"
  run_static webjmail-app-staging "$R/app-staging" 8121 "$R/app-staging.nginx.conf"
  add_backend be_app_webjmail_staging webjmail-app-staging 8121
  add_map staging.webjmail.com be_app_webjmail_staging
  wire
}

certs() {
  # This box serves the ACME challenge from /var/lib/letsencrypt via a python3
  # http.server on :8888 (HAProxy routes /.well-known/acme-challenge there), so
  # use --webroot, NOT --standalone (:8888 is already bound).
  certbot certonly --webroot -w /var/lib/letsencrypt \
    -d webjmail.com -d www.webjmail.com -d app.webjmail.com \
    --non-interactive --agree-tos --email admin@rotko.net --keep-until-expiring
  # Combine fullchain+privkey into HAProxy's single-file format, then reload.
  d=/etc/letsencrypt/live/webjmail.com
  cat "$d/fullchain.pem" "$d/privkey.pem" >/etc/haproxy/certs/webjmail.com.pem
  chmod 600 /etc/haproxy/certs/webjmail.com.pem
  systemctl reload haproxy
}

case "${1:-prod}" in
  prod) deploy_prod ;;
  staging) deploy_staging ;;
  certs) certs ;;
  *) echo "usage: $0 {prod|staging|certs}" >&2; exit 1 ;;
esac

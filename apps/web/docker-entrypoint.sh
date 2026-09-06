#!/bin/sh
# Render nginx.conf from the template, substituting ONLY ${PORT} and
# ${API_UPSTREAM} (so nginx's own $host / $uri / $scheme variables survive),
# then hand off to nginx. Defaults keep docker-compose working; Railway injects
# its own PORT and the API's internal address.
set -e

: "${PORT:=80}"
: "${API_UPSTREAM:=server:4000}"
export PORT API_UPSTREAM

envsubst '${PORT} ${API_UPSTREAM}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'

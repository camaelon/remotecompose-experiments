#!/usr/bin/env bash
# Install or update the RemoteCompose MCP servers on a Debian/Ubuntu VPS (x86_64 or arm64).
#
#   sudo mcp/deploy/setup.sh mcp.example.com      # from a checkout on the VPS
#
# Idempotent: re-run it after `git pull` to rebuild and restart. It
#   - installs the build/runtime packages (and Caddy, for TLS),
#   - copies this checkout to /opt/remotecompose-experiments and builds rc2image there,
#   - creates the `rcmcp` user and the workspace /var/lib/rcmcp,
#   - writes /etc/rcmcp/*.env, generating a token the first time,
#   - builds the TypeScript web player once (rc-deploy embeds it in the pages it makes),
#   - installs and (re)starts rcmcp@json2rc, rcmcp@rc-render, rcmcp@guide, rcmcp@deploy and
#     rcmcp@inspect, rcmcp@examples,
#     and the Caddy site.
set -euo pipefail

DOMAIN="${1:-}"
[[ $EUID -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
[[ -n "$DOMAIN" ]] || { echo "usage: $0 DOMAIN   (the name the servers will be reached at)" >&2; exit 1; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST=/opt/remotecompose-experiments

echo "== packages"
apt-get update -qq
# The same set CI builds with (.github/workflows/cpp.yml). The prebuilt Skia links against
# X11/GL even though rc2image renders on the CPU with no display; only the libraries are
# needed, no X server. Without a font Skia draws text as nothing, silently: fonts-dejavu-core.
apt-get install -y -qq git cmake pkg-config build-essential curl ca-certificates rsync \
    libfontconfig1-dev libfreetype-dev libgl1-mesa-dev libglfw3-dev \
    libx11-dev libxext-dev libxrender-dev fonts-dejavu-core nodejs
if ! command -v caddy >/dev/null && ! apt-get install -y -qq caddy; then
    echo "caddy is not in this distro's repositories; add Caddy's own apt repo first:" >&2
    echo "  https://caddyserver.com/docs/install#debian-ubuntu-raspbian" >&2
    exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
# npm installs esbuild, which builds the web player. Debian ships it separately from node;
# NodeSource's node includes it (and conflicts with the Debian package), hence the check.
command -v npm >/dev/null || apt-get install -y -qq npm
if (( NODE_MAJOR < 18 )); then
    echo "node $NODE_MAJOR is too old (need 18+). Install a current one, e.g.:" >&2
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs" >&2
    exit 1
fi

echo "== code -> $DEST"
if [[ "$SRC" != "$DEST" ]]; then
    mkdir -p "$DEST"
    # Sources only: no local build trees, no node_modules, no Xcode leftovers.
    rsync -a --delete \
        --exclude .git --exclude node_modules --exclude 'players/cpp/build*' \
        --exclude 'players/cpp/apps/iosViewer' --exclude 'players/compose' \
        "$SRC/" "$DEST/"
fi

echo "== build rc2image"
cmake -S "$DEST/players/cpp" -B "$DEST/players/cpp/build" \
      -DCMAKE_BUILD_TYPE=Release -DRCX_BUILD_APPS=OFF -DRCX_BUILD_TESTS=OFF
cmake --build "$DEST/players/cpp/build" --target rc2image -j"$(nproc)"

echo "== web player"
# The services cannot write the checkout, so the bundle is built here, as root, once.
(cd "$DEST" && npm ci --no-audit --no-fund --loglevel=error)
node "$DEST/mcp/lib/web-player.mjs" --build

echo "== user, workspace, config"
id rcmcp &>/dev/null || useradd --system --home /var/lib/rcmcp --shell /usr/sbin/nologin rcmcp
install -d -o rcmcp -g rcmcp -m 750 /var/lib/rcmcp
install -d -m 755 /etc/rcmcp
if [[ ! -f /etc/rcmcp/common.env ]]; then
    TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
    cat > /etc/rcmcp/common.env <<EOF
MCP_TOKEN=$TOKEN
MCP_ROOT=/var/lib/rcmcp
MCP_HTTP_HOST=127.0.0.1
MCP_OUT_TTL_HOURS=24
MCP_MAX_RENDERS=2
RC2IMAGE=$DEST/players/cpp/build/tools/rc2image/rc2image
EOF
    chmod 600 /etc/rcmcp/common.env
fi
echo "MCP_HTTP_PORT=8808" > /etc/rcmcp/json2rc.env
# rc-render returns public links to its renders under its own public base.
printf 'MCP_HTTP_PORT=8809\nMCP_PUBLIC_URL=https://%s/rc-render\n' "$DOMAIN" > /etc/rcmcp/rc-render.env
# The guide reports the public endpoints, so it needs to know the public name.
printf 'MCP_HTTP_PORT=8810\nMCP_PUBLIC_BASE_URL=https://%s\n' "$DOMAIN" > /etc/rcmcp/guide.env
# rc-deploy publishes pages under its own public base.
printf 'MCP_HTTP_PORT=8811\nMCP_PUBLIC_URL=https://%s/deploy\n' "$DOMAIN" > /etc/rcmcp/deploy.env
echo "MCP_HTTP_PORT=8812" > /etc/rcmcp/inspect.env
echo "MCP_HTTP_PORT=8813" > /etc/rcmcp/examples.env

echo "== services"
install -m 644 "$DEST/mcp/deploy/rcmcp@.service" /etc/systemd/system/rcmcp@.service
systemctl daemon-reload
systemctl enable --now rcmcp@json2rc rcmcp@rc-render rcmcp@guide rcmcp@deploy rcmcp@inspect rcmcp@examples
systemctl restart rcmcp@json2rc rcmcp@rc-render rcmcp@guide rcmcp@deploy rcmcp@inspect rcmcp@examples

echo "== caddy"
install -d /etc/caddy/sites
sed "s/DOMAIN/$DOMAIN/" "$DEST/mcp/deploy/Caddyfile" > /etc/caddy/sites/rcmcp.caddy
grep -q 'import sites/\*' /etc/caddy/Caddyfile 2>/dev/null || echo 'import sites/*' >> /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# Give each server a few seconds to come up; on failure show why, rather than pointing at logs.
for svc in json2rc:8808 rc-render:8809 guide:8810 deploy:8811 inspect:8812 examples:8813; do
    name="${svc%%:*}" port="${svc##*:}"
    for _ in $(seq 20); do curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
    if ! curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; then
        echo "rcmcp@$name is not answering on :$port. Its last log lines:" >&2
        journalctl -u "rcmcp@$name" -n 30 --no-pager >&2 || true
        exit 1
    fi
done

TOKEN="$(sed -n 's/^MCP_TOKEN=//p' /etc/rcmcp/common.env)"
cat <<EOF

Done. Endpoints:
  https://$DOMAIN/guide/mcp       start here: describes the others
  https://$DOMAIN/json2rc/mcp
  https://$DOMAIN/rc-render/mcp
  https://$DOMAIN/deploy/mcp      published pages: https://$DOMAIN/pages
  https://$DOMAIN/inspect/mcp
  https://$DOMAIN/examples/mcp     example catalog and component library
  https://$DOMAIN/examples/        browse the examples (and /examples/components/), public
Token (keep secret): $TOKEN

Claude Code:  claude mcp add --transport http rc-render https://$DOMAIN/rc-render/mcp --header "Authorization: Bearer $TOKEN"
              (same for json2rc, guide, deploy, inspect and examples)
claude.ai:    add a custom connector with URL https://$DOMAIN/rc-render/mcp/$TOKEN
              (and the same for /json2rc/, /guide/, /deploy/, /inspect/ and /examples/)
Logs:         journalctl -u 'rcmcp@*' -f
EOF

# MerQato Workstation Hub

A single operational dashboard for a small cloud stack: Homepage for the UI, a
tiny read-only aggregation API for the services Homepage has no native widget
for, and a restricted Docker proxy so the dashboard can see container health
without ever being able to change anything.

**No secrets reach the browser.** Tokens live in a root-owned `.env`, are
mounted into the API container only, and every response is measured data.

## What it shows

| Tile | Source | Data |
| --- | --- | --- |
| Coolify | REST API v1 (read-only PAT) | apps, projects, servers reachable, version |
| Docker (per container) | Homepage docker widget via proxy | CPU / MEM / RX / TX |
| Cloudflare | REST API (DNS-scoped token) | zones, DNS records, TLS days left |
| GitHub | public REST API | public repos per account |
| Uptime Kuma | Homepage uptimekuma widget | up / down / uptime % |
| Site Health | hub probe | HTTPS probe of every public hostname |
| Docker Host | hub + proxy | running / healthy / unhealthy / total |
| UpCloud | instance metadata + `/proc` | CPU, memory, disk, load, uptime, region |

## Layout

```
docker-compose.yml     Homepage + dockerproxy + hubapi + files
Caddyfile.example      edge routing incl. Access-protected canonical host
config/services.yaml   dashboard tiles and widget mappings
config/settings.yaml   groups and column layout
config/docker.yaml     points Homepage at the read-only proxy
hub/hub.py             aggregation API (python stdlib only)
hub/vps-agent.sh       writes vps.json every minute from the host
WORKSTATION.md         operations, rollback, verification
```

## Quick start

```bash
cp .env.example .env      # fill in tokens
docker compose up -d
# first run of vps-agent.sh, then add to cron:
chmod +x hub/vps-agent.sh && ./hub/vps-agent.sh
#   * * * * * /path/to/hub/vps-agent.sh >/dev/null 2>&1
```

Then point your edge proxy at the `work` hostname:

```
work.example.com
  /files/*  -> host.docker.internal:3004
  /hub/*    -> host.docker.internal:3010
  *         -> host.docker.internal:3003
```

Put Cloudflare Access (or any authenticating proxy) in front of the hostname.
Do not rely on app-level passwords — browsers drop URL-embedded basic-auth
credentials on subresource requests, which breaks widget fetches.

## Credentials

| Variable | Scope | Notes |
| --- | --- | --- |
| `CF_API_TOKEN` | Zone:Read, DNS:Read | certificate days come from a live TLS handshake, not the API |
| `COOLIFY_TOKEN` | Coolify PAT, ability `read` | must belong to the team that owns the resources (often the root team, id 0) |
| `GITHUB_ACCOUNTS` | none | comma-separated logins, public data only |
| `CACHE_TTL` | none | seconds, default 60 |

Adding a Coolify token: `POST` must return 403 afterwards. If it returns 200
the token can mutate infrastructure and must be recreated with `read` only.

## Hub API

`/summary.json` backs every customapi tile. Also available: `/domains.json`,
`/cloudflare.json`, `/docker.json`, `/github.json`, `/coolify.json`,
`/vps.json`, `/full.json`, `/health`.

## Security notes

- `dockerproxy` exposes only `CONTAINERS`, `VERSION`, `INFO`. `EXEC=0` and
  `POST=0` mean a compromised dashboard still cannot start a container.
- The hub never returns a token, only counts derived from one.
- Automation should use a dedicated key-only account with a narrow sudo
  allowlist plus an audit log, never shared root.
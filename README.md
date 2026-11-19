# MerQato Workstation Hub

A single operational dashboard for a small cloud stack: a purpose-built UI with a
Quick Links Manager, a small read-only aggregation API for the services that have
no native dashboard, and a restricted Docker proxy so the UI can see container
health without ever being able to change anything.

**No secrets reach the browser.** Tokens live in a root-owned `.env`, are mounted
into the API container only, and every response is measured data.

## Layout

```
app/server.py            UI + Quick Links API (Python stdlib, no framework)
app/static/              index.html, app.css, app.js, vendored Inter + Lucide
hub/hub.py               aggregation API (Cloudflare, GitHub, Vercel, Coolify,
                         Resend, UpCloud, Docker, project inventory)
hub/vps-agent.sh         writes vps.json every minute from the host
config/                  legacy Homepage config (kept for the fallback host)
WORKSTATION.md           operations, rollback, verification
```

## The two hosts

| Host | Serves |
| --- | --- |
| `home.` | the Workstation app (`app/`, port 3005) |
| `work.` | the legacy Homepage dashboard (port 3003), kept as a fallback |

## Quick Links Manager

Add, edit, delete, pin, drag-reorder, instant search, category filters, grid or
list layout, JSON export/import. Links live server-side in `data/links.json`
with an atomic write and a timestamped backup on every change.

Writes need a signed session cookie plus a same-origin check; URLs must be plain
http(s) with no embedded credentials.

## What it shows

| Card | Source | Data |
| --- | --- | --- |
| VPS | UpCloud metadata + `/proc` | CPU / memory / disk / load / uptime |
| Containers | Docker socket proxy (read-only) | running, healthy, total |
| Sites | hub HTTPS probes | up / down / failing names |
| GitHub | REST API (optional token) | public + private repo counts |
| Vercel | REST API | projects, ready, errors |
| Coolify | REST API v1 (read-only PAT) | apps, version, servers |
| Cloudflare | REST API (DNS-scoped token) | zones, DNS records, TLS days |
| Resend | REST API | delivered, bounced, verified domains |
| Projects | inventory snapshot | 51 rows with live URL, repo, state |

## Run it

```bash
docker compose up -d
# first run seeds 17 starter links into data/links.json
```
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
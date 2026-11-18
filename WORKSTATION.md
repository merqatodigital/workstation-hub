# MerQato Workstation — Operations

Canonical URL: **https://home.merqato.digital** (password prompt)
Secondary: `https://work.merqato.digital` (Cloudflare Access SSO / email OTP)
`dash.merqato.digital` 301-redirects to `home.`

## Access control

Two doors into the same dashboard:

| Host | Auth | Use it when |
| --- | --- | --- |
| `home.merqato.digital` | Caddy `basic_auth` (browser prompt) | daily use — one prompt, then cached for the session |
| `work.merqato.digital` | Cloudflare Access, app `MerQato Workstation` | you want SSO / one-time PIN instead of a password |

Credentials for `home` live in `/opt/homepage/auth.txt` (chmod 600):

```
user: david
pass: <in /opt/homepage/auth.txt>
```

The password prompt covers the whole origin, so Homepage's widget XHRs are
authenticated by the same cached browser credentials — no "API Error" tiles.

### Cloudflare Access details (work host)

| Item | Value |
| --- | --- |
| Team domain | `wild-fire-a01f.cloudflareaccess.com` |
| Application | `MerQato Workstation` |
| Destination | `work.merqato.digital` |
| Policy | `Owners` — Allow, Include → Emails |
| Allowed emails | david@merqato.digital, david@palawancollective.com, growpalawan@gmail.com |
| Login method | Cloudflare SSO + email one-time PIN |

If Access ever feels slow, use `home` — it never touches Cloudflare's edge
login flow.

## Services (docker compose, /opt/homepage/docker-compose.yml)

| Container | Port | Purpose |
| --- | --- | --- |
| `homepage` | 3003 | Dashboard UI (Homepage 2.8.0) |
| `hubapi` | 3010 | Aggregation API (python stdlib, `/opt/homepage/hub/hub.py`) |
| `dockerproxy` | 2375 (internal) | Read-only Docker API (tecnativa/docker-socket-proxy) |
| `hub-files` | 3004 | Static downloads, e.g. `/files/workstation-hub.zip` |

`social-caddy-1` (in `/opt/social`) terminates TLS and routes:

```
home.merqato.digital   (basic_auth)
  /files/*  -> host.docker.internal:3004
  /hub/*    -> host.docker.internal:3010
  *         -> host.docker.internal:3003

work.merqato.digital   (Cloudflare Access at the edge)
  /files/*  -> host.docker.internal:3004
  /hub/*    -> host.docker.internal:3010
  *         -> host.docker.internal:3003

dash.merqato.digital -> 301 https://home.merqato.digital{uri}
```

The Caddyfile is bind-mounted from `/opt/social/Caddyfile`. Edit it in place
with a text editor or Python — `sed -i` replaces the inode and the container
keeps serving the old file. After any edit:

```
docker exec social-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

## Hub API endpoints

| Path | Contents |
| --- | --- |
| `/health` | liveness |
| `/summary.json` | every tile's numbers (used by Homepage customapi widgets) |
| `/domains.json` | per-host HTTPS probe results + certificate days |
| `/cloudflare.json` | zones, DNS record count |
| `/docker.json` | container fleet counts |
| `/github.json` | per-account public repo counts |
| `/coolify.json` | Coolify projects/apps/servers/version |
| `/vps.json` | UpCloud instance metadata + live host resources |
| `/full.json` | everything |

Responses are cached 60s and refreshed in a background thread, so a request
never waits on a full rebuild. The first build also runs at container start, so
the first visitor already gets a warm cache (sub-millisecond responses). No
secret is ever returned; the Cloudflare and Coolify tokens live only in
`/opt/homepage/.env` (chmod 600).

## Data sources

| Integration | How it gets data | Credential |
| --- | --- | --- |
| Cloudflare | REST API, DNS-scoped token | `/opt/homepage/.env` → `CF_API_TOKEN` |
| Docker | read-only socket proxy (`CONTAINERS`,`INFO`,`VERSION` only) | none |
| Uptime Kuma | Homepage `uptimekuma` widget, public status page `/status/merqato` | none |
| GitHub | public REST API, 3 accounts | none (public data) |
| Coolify | REST API v1, read-only PAT | `COOLIFY_TOKEN` (token file `/opt/homepage/.coolify-token`) |
| UpCloud | instance metadata `169.254.169.254` + `/proc`, written by cron | none |

Coolify token abilities are `["read"]`; a `POST /api/v1/projects` returns 403.
The token is scoped to team `0` (Root Team), which is where the projects and
servers live — teams 1 and 2 are empty.

VPS metrics are produced by `/opt/homepage/vps-agent.sh` every minute into
`/opt/homepage/hub/vps.json` (root crontab). It reads the UpCloud metadata
service, `/proc/meminfo`, `/proc/loadavg` and `df`. No API key required.

## Known failing hosts

`Site Health` probes every public hostname in the Cloudflare zone (15s timeout,
follows redirects). Currently **15 up / 3 failing** — the failing ones are real:

| Host | Symptom |
| --- | --- |
| `command.merqato.digital` | 502 — Caddy route exists, nothing listens on :3100 |
| `susi.merqato.digital` | no TLS certificate / no DNS answer |
| `www.status.merqato.digital` | no such host |

Sites that answer slower than ~12s are reported as *slow* rather than *down*.
Several Hostinger/Vercel hosts take 3–15s, which is why the timeout is 15s.

## Automation agent identity

| Item | Value |
| --- | --- |
| User | `deploy` (key-only, password locked) |
| Key | `~/.ssh/merqato_deploy` on the operator machine |
| Allowed | read-only docker/systemctl/journalctl, `/opt/homepage` compose stack |
| Denied | everything else, incl. `docker run`, other compose projects |
| Audit log | `/var/log/agent-actions.log` (root:deploy 660) |

Use the logging wrapper for anything that should be recorded:

```
sudo /usr/local/sbin/agentcmd /usr/bin/docker ps
```

Root access remains with the owner's key `~/.ssh/merqato_vps`.

## Rollback

Every change is snapshotted in `/opt/homepage/backups/`:

| File pattern | Restores |
| --- | --- |
| `Caddyfile.<stamp>` | edge routing |
| `services.yaml.<stamp>` | dashboard tiles |
| `settings.yaml.<stamp>` | layout |
| `hub.py.<stamp>` | hub API logic |
| `docker-compose.yml.<stamp>` | container topology |
| `kuma.db.<stamp>` | Uptime Kuma status page |
| `env.<stamp>` | integration secrets |

Example — restore the Caddyfile:

```
cp /opt/homepage/backups/Caddyfile.<stamp> /opt/social/Caddyfile
docker exec social-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

Example — restore the hub:

```
cp /opt/homepage/backups/hub.py.<stamp> /opt/homepage/hub/hub.py
cd /opt/homepage && docker compose restart hubapi
```

## Verification

```
curl -s -o /dev/null -w '%{http_code}\n' https://home.merqato.digital                      # 401
curl -s -o /dev/null -w '%{http_code}\n' -u david:$PW https://home.merqato.digital        # 200
curl -s -o /dev/null -w '%{http_code}\n' -u david:$PW https://home.merqato.digital/hub/summary.json
curl -s -o /dev/null -w '%{http_code}\n' https://work.merqato.digital                     # 302 -> Access
curl -s -o /dev/null -w '%{http_code}\n' https://status.merqato.digital/api/status-page/merqato   # 200
```
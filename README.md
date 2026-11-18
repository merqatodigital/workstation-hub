# MerQato Workstation Hub

Self-hosted dashboard ( [Homepage](https://gethomepage.dev) ) that puts every tool,
repo, client site and dashboard in one place.

**Live:** <https://work.merqato.digital>
(aliases: `dash.merqato.digital`, `home.merqato.digital`)

## What's on it

| Section | Links |
| --- | --- |
| Infrastructure | Coolify, HyperLevel CRM, Uptime Kuma, MerQato Social, Cloudflare, Vercel, GitHub, Resend, UpCloud |
| Email & Comms | Gmail, Resend Emails, Resend Domains, Cloudflare Email Routing |
| Projects | 8 active client sites, Repository Intelligence, SBI Medical Deck |
| Client Sites | Palawan Collective, BAIA Lodge, Azarraga Glass, SANVIC |

## Files

```
config/
  settings.yaml   title, theme, colour, layout column counts
  services.yaml   the actual link groups and cards  <- edit this most
  bookmarks.yaml  top bookmark bar
  widgets.yaml    top bar widgets (CPU/RAM/disk, search)
docker-compose.yml
Caddyfile.example
```

## Edit the dashboard

Everything is plain YAML under `config/`. Add a card:

```yaml
- Projects:
    - New Client:
        href: https://new-client.vercel.app
        description: Client site
        icon: vercel
```

Then apply:

```bash
docker compose restart homepage
```

Icons come from [selfh.st/icons](https://selfh.st/icons) or
[dashboard-icons](https://github.com/homarr-labs/dashboard-icons); a slug name
like `vercel`, `github`, `cloudflare` is enough.

## Deploy somewhere else

```bash
git clone <this repo> workstation-hub
cd workstation-hub
docker compose up -d          # serves on http://localhost:3003
```

Put Caddy/nginx in front using `Caddyfile.example`. Set
`HOMEPAGE_ALLOWED_HOSTS` in `docker-compose.yml` to whatever hostname you use,
otherwise Homepage answers `400 Host validation error`.

## Current deployment

| | |
| --- | --- |
| VPS | UpCloud `95.111.196.120` (`ubuntu-4cpu-8gb-sg-sin1`) |
| Path | `/opt/homepage` |
| Port | `3003` → container `3000` |
| Proxy | `social-caddy-1`, route in `/opt/social/Caddyfile` |
| DNS | Cloudflare A record, proxied, zone `merqato.digital` |

Update it live:

```bash
ssh root@95.111.196.120
cd /opt/homepage
git pull            # if this repo was cloned there
docker compose restart homepage
```

> Editing a single bind-mounted file (like `/opt/social/Caddyfile`) with
> `sed -i` changes the inode and the container keeps seeing the old copy.
> Rewrite in place (`cat > file`) or restart the container after editing.

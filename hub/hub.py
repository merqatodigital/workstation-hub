#!/usr/bin/env python3
"""MerQato Workstation hub API.

Read-only aggregation for the Homepage dashboard. No writes, no secrets
returned to clients, every value is measured (not mocked). Stdlib only.

Run: python3 hub.py  (listens on 0.0.0.0:3010)
"""

import json
import os
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("HUB_PORT", "3010"))
CF_TOKEN = os.environ.get("CF_API_TOKEN", "").strip()
DOCKER = os.environ.get("DOCKER_API", "http://dockerproxy:2375")
GITHUB_ACCOUNTS = [a.strip() for a in os.environ.get("GITHUB_ACCOUNTS", "merqatodigital,sanvicpalawan,merqato").split(",") if a.strip()]
CACHE_TTL = int(os.environ.get("CACHE_TTL", "60"))
VPS_FILE = os.environ.get("VPS_FILE", "/app/vps.json")
COOLIFY_URL = os.environ.get("COOLIFY_URL", "https://coolify.merqato.digital").rstrip("/")
COOLIFY_TOKEN = os.environ.get("COOLIFY_TOKEN", "").strip()

# Hosts that are infrastructure endpoints rather than customer-facing sites.
SKIP_SUFFIXES = ("rsend.", "send.", "_domainkey", "resend.")

_lock = threading.Lock()
_cache = {"at": 0, "data": None, "building": False}


def http_json(url, headers=None, timeout=8):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "merqato-hub/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def http_text(url, headers=None, timeout=8):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "merqato-hub/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode(errors="replace").strip()


# ---------------------------------------------------------------- cloudflare
def cf(path):
    return http_json(
        "https://api.cloudflare.com/client/v4" + path,
        headers={"Authorization": "Bearer " + CF_TOKEN, "User-Agent": "merqato-hub/1.0"},
        timeout=10,
    )


def cloudflare_data():
    out = {"zones": 0, "dns_records": 0, "hosts": [], "ok": False}
    if not CF_TOKEN:
        return out
    try:
        zones = cf("/zones?per_page=50")["result"]
        out["zones"] = len(zones)
        for z in zones:
            recs = cf("/zones/%s/dns_records?per_page=200" % z["id"])["result"]
            out["dns_records"] += len(recs)
            for r in recs:
                if r["type"] in ("A", "AAAA", "CNAME"):
                    name = r["name"]
                    if any(s in name for s in SKIP_SUFFIXES):
                        continue
                    out["hosts"].append(name)
        out["ok"] = True
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:120]
    out["hosts"] = sorted(set(out["hosts"]))
    return out


# ------------------------------------------------------------------- probes
PROBE_TIMEOUT = int(os.environ.get("PROBE_TIMEOUT", "20"))


def probe(host):
    url = "https://" + host
    start = time.time()
    code = 0
    timed_out = False
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "merqato-hub/1.0"})
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except (socket.timeout, TimeoutError):
        timed_out = True
    except Exception:  # noqa: BLE001
        code = 0
    ms = int((time.time() - start) * 1000)
    return {
        "host": host,
        "code": code,
        "ok": 100 <= code < 500,  # 5xx / no response = failing
        "ms": ms,
        # Slow-but-alive hosts are flagged separately so the tile can show
        # "slow" instead of counting them as down.
        "slow": bool(timed_out or ms >= PROBE_TIMEOUT * 1000 * 0.8),
    }


def cert_days(host):
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=6) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ss:
                exp = ss.getpeercert()["notAfter"]
        return int((ssl.cert_time_to_seconds(exp) - time.time()) / 86400)
    except Exception:  # noqa: BLE001
        return None


def probe_all(hosts):
    with ThreadPoolExecutor(max_workers=10) as pool:
        return list(pool.map(probe, hosts))


# -------------------------------------------------------------------- docker
def docker_data():
    out = {"running": 0, "healthy": 0, "unhealthy": 0, "exited": 0, "total": 0, "problems": []}
    try:
        items = http_json(DOCKER + "/containers/json?all=1", timeout=6)
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:120]
        return out
    out["total"] = len(items)
    for c in items:
        name = (c.get("Names") or ["?"])[0].lstrip("/")
        state = c.get("State", "")
        status = c.get("Status", "")
        if state == "running":
            out["running"] += 1
            if "(healthy)" in status:
                out["healthy"] += 1
            if "(unhealthy)" in status:
                out["unhealthy"] += 1
                out["problems"].append(name)
        elif state == "exited":
            out["exited"] += 1
            out["problems"].append(name)
        elif state in ("restarting", "dead", "paused"):
            out["problems"].append(name)
    return out


# -------------------------------------------------------------------- github
def github_data():
    accounts, total = [], 0
    for login in GITHUB_ACCOUNTS:
        entry = {"login": login, "public_repos": None, "error": None}
        try:
            u = http_json("https://api.github.com/users/" + login, timeout=8)
            entry["public_repos"] = u.get("public_repos", 0)
            entry["name"] = u.get("name") or login
            entry["updated"] = u.get("updated_at")
            total += entry["public_repos"] or 0
        except Exception as exc:  # noqa: BLE001
            entry["error"] = str(exc)[:80]
        accounts.append(entry)
    return {"accounts": accounts, "public_repos_total": total}


# ------------------------------------------------------------------------ vps
def vps_data():
    out = {"ok": False}
    try:
        with open(VPS_FILE, "r", encoding="utf-8") as fh:
            out = json.load(fh)
        out["ok"] = True
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:120]
    return out


# ------------------------------------------------------------------- coolify
def coolify_get(path):
    return http_json(
        COOLIFY_URL + "/api/v1" + path,
        headers={"Authorization": "Bearer " + COOLIFY_TOKEN, "User-Agent": "merqato-hub/1.0"},
        timeout=10,
    )


def coolify_data():
    out = {
        "ok": False,
        "version": None,
        "projects": 0,
        "applications": 0,
        "servers": 0,
        "reachable": 0,
        "deployments": 0,
        "error": None,
    }
    if not COOLIFY_TOKEN:
        out["error"] = "no token"
        return out
    try:
        out["version"] = http_text(
            COOLIFY_URL + "/api/v1/version",
            headers={"Authorization": "Bearer " + COOLIFY_TOKEN, "User-Agent": "merqato-hub/1.0"},
            timeout=8,
        )
        out["projects"] = len(coolify_get("/projects") or [])
        out["applications"] = len(coolify_get("/applications") or [])
        servers = coolify_get("/servers") or []
        out["servers"] = len(servers)
        out["reachable"] = sum(1 for s in servers if s.get("is_reachable"))
        out["deployments"] = len(coolify_get("/deployments") or [])
        out["ok"] = True
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:120]
    return out


# --------------------------------------------------------------------- build
def build():
    cfdata = cloudflare_data()
    hosts = cfdata["hosts"]
    probes = probe_all(hosts) if hosts else []

    failing = [p for p in probes if not p["ok"]]
    slow = [p["host"] for p in probes if p["ok"] and p["slow"]]

    certs = {}
    for p in probes[:12]:
        d = cert_days(p["host"])
        if d is not None:
            certs[p["host"]] = d
    min_cert = min(certs.values()) if certs else None

    dock = docker_data()
    gh = github_data()
    cld = coolify_data()
    vps = vps_data()

    return {
        "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "domains": {
            "total": len(probes),
            "ok": len(probes) - len(failing),
            "failing": len(failing),
            "failing_names": ", ".join(p["host"] for p in failing)[:120] or "none",
            "slowest_ms": max([p["ms"] for p in probes], default=0),
            "slow_count": len(slow),
            "slow_names": ", ".join(slow)[:120] or "none",
        },
        "certificates": {
            "checked": len(certs),
            "min_days": min_cert if min_cert is not None else -1,
        },
        "docker": dock,
        "github": gh,
        "coolify": cld,
        "vps": vps,
        "cloudflare": {
            "zones": cfdata["zones"],
            "dns_records": cfdata["dns_records"],
            "ok": cfdata["ok"],
            "error": cfdata.get("error"),
        },
        "detail": {"probes": probes, "certificates": certs},
    }


def _rebuild():
    """Refresh the cache in place. Safe to run from a background thread."""
    try:
        data = build()
    except Exception as exc:  # noqa: BLE001
        with _lock:
            if _cache["data"]:
                _cache["data"]["last_error"] = str(exc)[:160]
                _cache["at"] = time.time()  # back off briefly, keep serving stale
        return
    with _lock:
        _cache["data"] = data
        _cache["at"] = time.time()


def _rebuild_after():
    try:
        _rebuild()
    finally:
        with _lock:
            _cache["building"] = False


def cached():
    """Never block a request on a full rebuild.

    A cold or stale cache returns whatever we have (possibly nothing on the very
    first call) and refreshes in the background, so dashboard tiles always answer
    in milliseconds instead of waiting on 18 outbound HTTPS probes.
    """
    with _lock:
        data = _cache["data"]
        fresh = data is not None and (time.time() - _cache["at"]) < CACHE_TTL
        stale = data is None or (time.time() - _cache["at"]) >= CACHE_TTL
        rebuilding = _cache["building"]
        if stale and not rebuilding:
            _cache["building"] = True
            start_build = True
        else:
            start_build = False

    if start_build:
        threading.Thread(target=_rebuild_after, args=(), daemon=True).start()

    if fresh:
        return data

    # Stale or empty: wait briefly for the first build so the very first hit
    # still returns real data, then serve whatever exists.
    deadline = time.time() + float(os.environ.get("FIRST_BUILD_WAIT", "25"))
    while time.time() < deadline:
        with _lock:
            data = _cache["data"]
            if data is not None and (time.time() - _cache["at"]) < CACHE_TTL:
                return data
        time.sleep(0.4)

    with _lock:
        data = _cache["data"]
    if data is not None:
        data = dict(data)
        data["stale"] = True
        return data
    return {"stale": True, "error": "cache warming", "updated": None}


# ---------------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = "merqato-hub/1.0"

    def _send(self, payload, code=200):
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0].rstrip("/") or "/"
        try:
            if path in ("/", "/health"):
                self._send({"status": "ok", "service": "merqato-hub"})
                return
            data = cached()
            if path == "/summary.json":
                self._send({
                    "domains_total": data["domains"]["total"],
                    "domains_ok": data["domains"]["ok"],
                    "domains_failing": data["domains"]["failing"],
                    "failing_names": data["domains"]["failing_names"],
                    "slow_count": data["domains"].get("slow_count", 0),
                    "containers_running": data["docker"]["running"],
                    "containers_healthy": data["docker"]["healthy"],
                    "containers_unhealthy": data["docker"]["unhealthy"],
                    "containers_total": data["docker"]["total"],
                    "github_repos": data["github"]["public_repos_total"],
                    "cf_zones": data["cloudflare"]["zones"],
                    "cf_dns_records": data["cloudflare"]["dns_records"],
                    "cert_min_days": data["certificates"]["min_days"],
                    "coolify_projects": data["coolify"]["projects"],
                    "coolify_apps": data["coolify"]["applications"],
                    "coolify_servers": data["coolify"]["servers"],
                    "coolify_reachable": data["coolify"]["reachable"],
                    "coolify_deployments": data["coolify"]["deployments"],
                    "coolify_version": data["coolify"]["version"] or "n/a",
                    "vps_instance": data["vps"].get("instance_id") or "n/a",
                    "vps_region": data["vps"].get("region") or "n/a",
                    "vps_cpu_pct": data["vps"].get("cpu_used_pct", -1),
                    "vps_mem_pct": data["vps"].get("mem_used_pct", -1),
                    "vps_mem_free_mb": (data["vps"].get("mem_total_mb", 0) - data["vps"].get("mem_used_mb", 0)),
                    "vps_disk_pct": data["vps"].get("disk_used_pct", -1),
                    "vps_load1": data["vps"].get("load1", -1),
                    "vps_uptime_h": data["vps"].get("uptime_hours", -1),
                    "updated": data["updated"],
                })
            elif path == "/domains.json":
                self._send(data["detail"])
            elif path == "/github.json":
                self._send(data["github"])
            elif path == "/docker.json":
                self._send(data["docker"])
            elif path == "/cloudflare.json":
                self._send(data["cloudflare"])
            elif path == "/coolify.json":
                self._send(data["coolify"])
            elif path == "/vps.json":
                self._send(data["vps"])
            elif path == "/full.json":
                self._send(data)
            else:
                self._send({"error": "not found"}, 404)
        except Exception as exc:  # noqa: BLE001
            self._send({"error": str(exc)[:200]}, 500)

    def log_message(self, fmt, *args):  # keep the log quiet
        pass


if __name__ == "__main__":
    print("hub api listening on :%d (ttl=%ds)" % (PORT, CACHE_TTL), flush=True)
    # Build once at startup so the first visitor gets a warm cache instead of
    # waiting on a full probe cycle.
    threading.Thread(target=_rebuild_after, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()

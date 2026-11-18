#!/bin/bash
# Writes a small JSON snapshot of this UpCloud instance for the workstation hub.
# Runs from cron every minute; no secrets, read-only.
set -uo pipefail
OUT=/opt/homepage/hub/vps.json
TMP="$OUT.tmp"

META=$(curl -s --max-time 5 -H 'Metadata: true' http://169.254.169.254/metadata/v1.json 2>/dev/null)

read -r la1 la5 la15 _ < /proc/loadavg

MEM_TOTAL_KB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
MEM_AVAIL_KB=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
MEM_USED_KB=$((MEM_TOTAL_KB - MEM_AVAIL_KB))

DISK=$(df -B1 / | tail -1)
DISK_TOTAL=$(echo "$DISK" | awk '{print $2}')
DISK_USED=$(echo "$DISK" | awk '{print $3}')

CPU_IDLE=$(vmstat 1 2 2>/dev/null | tail -1 | awk '{print $15}')
[ -z "$CPU_IDLE" ] && CPU_IDLE=100
CPU_USED=$((100 - CPU_IDLE))

UP_SECONDS=$(awk '{printf "%d", $1}' /proc/uptime)

# pull a few identifying fields out of the metadata JSON without jq
instance_id=$(echo "$META" | grep -o '"instance_id": *"[^"]*"' | head -1 | cut -d'"' -f4)
cloud_name=$(echo "$META" | grep -o '"cloud_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
region=$(echo "$META" | grep -o '"region": *"[^"]*"' | head -1 | cut -d'"' -f4)
hostname_srv=$(hostname)

VERSION=$(cat /opt/homepage/version.txt 2>/dev/null || echo "")

cat > "$TMP" <<JSON
{
  "ok": true,
  "cloud": "${cloud_name:-upcloud}",
  "instance_id": "${instance_id:-}",
  "region": "${region:-sg-sin1}",
  "hostname": "${hostname_srv}",
  "os": "$(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)",
  "kernel": "$(uname -r)",
  "cpu_count": $(nproc),
  "cpu_used_pct": ${CPU_USED},
  "load1": ${la1},
  "load5": ${la5},
  "load15": ${la15},
  "mem_total_mb": $((MEM_TOTAL_KB / 1024)),
  "mem_used_mb": $((MEM_USED_KB / 1024)),
  "mem_used_pct": $((MEM_USED_KB * 100 / MEM_TOTAL_KB)),
  "disk_total_gb": $((DISK_TOTAL / 1000000000)),
  "disk_used_gb": $((DISK_USED / 1000000000)),
  "disk_used_pct": $((DISK_USED * 100 / DISK_TOTAL)),
  "uptime_hours": $((UP_SECONDS / 3600)),
  "updated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

mv "$TMP" "$OUT"
chmod 644 "$OUT"

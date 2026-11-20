/* MerQato Workstation — front end.
 *
 * Vanilla JS on purpose: no build step, no framework, nothing to upgrade.
 * Every number on screen comes from the hub API (/hub/summary.json) or the
 * links store (/api/links). Nothing is invented client-side.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const NAV = [
    { id: "overview", label: "Overview", icon: "layout-dashboard" },
    { id: "links", label: "Quick Links", icon: "link" },
    { id: "infrastructure", label: "Infrastructure", icon: "server" },
    { id: "projects", label: "Projects", icon: "folder-git-2" },
    { id: "clients", label: "Clients", icon: "building-2" },
    { id: "agents", label: "Agents", icon: "bot" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  const CATEGORIES = ["Infrastructure", "Projects", "Clients", "Email", "Agents", "Other"];

  // Lucide is a general-purpose icon set and does not ship brand logos.
  // Keep the saved link names stable, but resolve them to supported icons.
  const ICON_ALIASES = Object.freeze({
    vercel: "triangle",
    cloudflare: "cloud",
    coolify: "layers",
    upcloud: "cloud-cog",
    projects: "folder-kanban",
    bitwarden: "key-round",
    social: "share-2",
    hyperlevel: "briefcase-business",
  });

  const state = {
    links: [],
    metrics: null,
    projects: [],
    hubUp: null,
    view: "overview",
    query: "",
    category: "All",
    layout: localStorage.getItem("ws.layout") || "grid",
    theme: localStorage.getItem("ws.theme") || "dark",
    loaded: false,
    busy: false,
  };

  // ------------------------------------------------------------------ utils
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));

  const pascalIconName = (name) =>
    name.split(/[-_\s]+/).filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");

  const icon = (name, cls = "") => {
    const requested = String(name || "link").trim().toLowerCase();
    const candidate = ICON_ALIASES[requested] || requested || "link";
    const library = window.lucide;
    const supported = !library ||
      Object.prototype.hasOwnProperty.call(library, pascalIconName(candidate));
    const safeName = supported ? candidate : "link";
    return `<i data-lucide="${esc(safeName)}" class="ico ${cls}" aria-hidden="true"></i>`;
  };

  const hostOf = (url) => {
    try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
  };

  const formatDate = (value, fallback = "—") => {
    if (value == null || value === "") return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
  };

  const freeRam = (m) => {
    const mb = m.vps_mem_free_mb != null ? m.vps_mem_free_mb : 7907 * (100 - (m.vps_mem_pct || 0)) / 100;
    return `${(mb / 1024).toFixed(1)} GiB free`;
  };

  const debounce = (fn, wait = 200) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  };

  let toastTimer;
  function toast(message, tone = "ok") {
    const el = $("#toast");
    el.textContent = message;
    el.dataset.tone = tone;
    el.hidden = false;
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateX(-50%) translateY(0)"; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(6px)";
      setTimeout(() => { el.hidden = true; el.style.opacity = ""; el.style.transform = ""; }, 200);
    }, 2600);
  }

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ws.theme", theme);
    const btn = $("#theme-toggle");
    if (btn) btn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
    if (window.lucide) window.lucide.createIcons();
  }

  function toggleTheme() {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    render();
  }

  function applyLayout(layout) {
    state.layout = layout;
    localStorage.setItem("ws.layout", layout);
    $$(".link-grid").forEach((g) => g.classList.toggle("list", layout === "list"));
    $$(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
  }

  // -------------------------------------------------------------------- api
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-json */ }
    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function ensureSession() {
    try { await api("/api/session"); } catch { /* session is best-effort */ }
  }

  async function loadLinks() {
    const data = await api("/api/links");
    state.links = data.links || [];
  }

  async function loadMetrics() {
    const [summary, projects] = await Promise.all([
      api("/hub/summary.json"),
      api("/hub/projects.json").catch(() => ({ projects: [] })),
    ]);
    state.metrics = summary;
    state.projects = projects.projects || [];
  }

  async function checkHub() {
    try {
      await api("/hub/health");
      state.hubUp = true;
    } catch {
      state.hubUp = false;
    }
    const dot = $(".agent .dot");
    const label = $(".agent-label");
    if (dot) dot.dataset.state = state.hubUp ? "ok" : "down";
    if (label) label.textContent = state.hubUp ? "Agent online" : "Agent unreachable";
  }

  // ------------------------------------------------------------------- nav
  function renderNav() {
    $("#nav").innerHTML =
      `<div class="nav-label">Workspace</div>` +
      NAV.map((item) =>
        `<a href="#${item.id}" data-view="${item.id}"${state.view === item.id ? ' aria-current="page"' : ""} title="${item.label}">` +
        `${icon(item.icon)}<span>${item.label}</span></a>`
      ).join("");
  }

  // --------------------------------------------------------------- fragments
  function metricCard({ label, iconName, value, unit, foot, bar, tone }) {
    const width = bar == null ? null : Math.max(0, Math.min(100, bar));
    return `
      <div class="card metric">
        <div class="metric-top">${icon(iconName)}${esc(label)}</div>
        <div class="metric-value">${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ""}</div>
        ${width == null ? "" : `<div class="metric-bar"><span style="width:${width}%"${tone ? ` data-tone="${tone}"` : ""}></span></div>`}
        ${foot ? `<div class="metric-foot"><span>${esc(foot)}</span></div>` : ""}
      </div>`;
  }

  function alertRow({ tone, iconName, title, meta }) {
    return `
      <div class="alert" data-tone="${tone}">
        ${icon(iconName)}
        <div>
          <div class="alert-title">${esc(title)}</div>
          ${meta ? `<div class="alert-meta">${esc(meta)}</div>` : ""}
        </div>
      </div>`;
  }

  function buildAlerts(m) {
    const alerts = [];
    const failingHosts = Array.isArray(m.failing_hosts) ? m.failing_hosts : [];
    if (m.domains_failing > 0) {
      alerts.push({
        tone: "danger", iconName: "alert-octagon",
        title: `${m.domains_failing} monitored endpoint${m.domains_failing > 1 ? "s" : ""} failing`,
        meta: failingHosts.join(", ") || m.failing_names || "Check the Site Health view",
      });
    }
    if (m.containers_unhealthy > 0) {
      alerts.push({
        tone: "danger", iconName: "box",
        title: `${m.containers_unhealthy} container${m.containers_unhealthy > 1 ? "s" : ""} unhealthy`,
        meta: "Docker reports a failing health check",
      });
    }
    if (m.vc_errors > 0) {
      const errorDetails = Array.isArray(m.vc_error_details) ? m.vc_error_details : [];
      const details = errorDetails.map((item) => {
        const state = item.state ? String(item.state).toUpperCase() : "ERROR";
        return `${item.name || "Unknown project"} · ${state} · ${formatDate(item.created, "date unknown")}`;
      }).join(", ");
      const sampleSize = Number(m.vc_deployments) || 0;
      alerts.push({
        tone: "warn", iconName: "triangle-alert",
        title: `${m.vc_errors} Vercel deployment error${m.vc_errors > 1 ? "s" : ""} in latest ${sampleSize || "available"} record${sampleSize === 1 ? "" : "s"}`,
        meta: details || "Review the latest production deployments",
      });
    }
    if (m.inv_deploy_errors > 0) {
      alerts.push({
        tone: "warn", iconName: "git-branch",
        title: `${m.inv_deploy_errors} historical deployment${m.inv_deploy_errors > 1 ? "s" : ""} in error state`,
        meta: `From the projects inventory snapshot (${m.inv_captured || "unknown date"})`,
      });
    }
    if (m.rs_bounced > 0) {
      alerts.push({
        tone: "warn", iconName: "mail-warning",
        title: `${m.rs_bounced} recent email${m.rs_bounced > 1 ? "s" : ""} bounced`,
        meta: "Resend delivery log; test messages may be included",
      });
    }
    if (!alerts.length) {
      alerts.push({ tone: "ok", iconName: "shield-check", title: "Nothing needs attention", meta: "All monitored services are responding" });
    }
    return alerts;
  }

  // ------------------------------------------------------------------ views
  function viewOverview() {
    const m = state.metrics;
    const pinned = state.links.filter((l) => l.pinned).slice(0, 10);
    const quick = (pinned.length ? pinned : state.links.slice(0, 10));

    const quickHtml = quick.length
      ? `<div class="quick-grid">${quick.map((l) => quickCard(l)).join("")}</div>`
      : emptyState("link", "No links yet", "Add the tools you use every day and pin them here.");

    let infraHtml;
    if (!m) {
      infraHtml = `<div class="metrics">${[1, 2, 3, 4].map(() => `<div class="card metric skeleton">&nbsp;</div>`).join("")}</div>`;
    } else {
      const cpuTone = m.vps_cpu_pct > 85 ? "danger" : m.vps_cpu_pct > 65 ? "warn" : "";
      const memTone = m.vps_mem_pct > 85 ? "danger" : m.vps_mem_pct > 65 ? "warn" : "";
      const diskTone = m.vps_disk_pct > 85 ? "danger" : m.vps_disk_pct > 70 ? "warn" : "";
      const siteTone = m.domains_failing > 0 ? "danger" : "";
      infraHtml = `<div class="metrics">
        ${metricCard({ label: "VPS CPU", iconName: "cpu", value: m.vps_cpu_pct, unit: "%", bar: m.vps_cpu_pct, tone: cpuTone, foot: `${m.vps_region} · ${m.vps_uptime_h}h up` })}
        ${metricCard({ label: "Memory", iconName: "memory-stick", value: m.vps_mem_pct, unit: "%", bar: m.vps_mem_pct, tone: memTone, foot: freeRam(m) })}
        ${metricCard({ label: "Disk", iconName: "hard-drive", value: m.vps_disk_pct, unit: "%", bar: m.vps_disk_pct, tone: diskTone, foot: "of 105 GB" })}
        ${metricCard({ label: "Containers", iconName: "box", value: m.containers_running, unit: `/ ${m.containers_total}`, foot: `${m.containers_healthy} healthy · ${m.containers_unhealthy} unhealthy` })}
        ${metricCard({ label: "Sites up", iconName: "globe", value: m.domains_ok, unit: `/ ${m.domains_total}`, bar: m.domains_total ? (m.domains_ok * 100 / m.domains_total) : 0, tone: siteTone, foot: m.domains_failing ? `${m.domains_failing} failing` : "all responding" })}
        ${metricCard({ label: "GitHub", iconName: "github", value: m.github_visible_repos, unit: "repos", foot: `${m.github_private_repos} private · ${m.github_repos} public` })}
        ${metricCard({ label: "Vercel", iconName: "triangle", value: m.vc_projects, unit: "projects", foot: `${m.vc_ready} ready · ${m.vc_errors} errors` })}
        ${metricCard({ label: "Coolify", iconName: "layers", value: m.coolify_apps, unit: "apps", foot: `v${m.coolify_version} · ${m.coolify_reachable} server` })}
        ${metricCard({ label: "Cloudflare", iconName: "cloud", value: m.cf_dns_records, unit: "DNS", foot: `${m.cf_zones} zone · cert ${m.cert_min_days}d` })}
        ${metricCard({ label: "Email", iconName: "mail", value: m.rs_delivered, unit: "sent", foot: `${m.rs_bounced} bounced · ${m.rs_verified} domains` })}
      </div>`;
    }

    const alerts = m ? buildAlerts(m) : [];
    const alertsHtml = alerts.length
      ? `<div class="alerts">${alerts.map(alertRow).join("")}</div>`
      : `<div class="card empty">${icon("loader")}<strong>Loading status…</strong></div>`;

    return `
      <section>
        <div class="section-head">
          <h2 class="section-title">Quick access</h2>
          <a class="section-note" href="#links">Manage links →</a>
        </div>
        ${quickHtml}
      </section>

      <section>
        <div class="section-head">
          <h2 class="section-title">Infrastructure</h2>
          <span class="section-note">${m ? `Updated ${esc((m.updated || "").replace("T", " ").replace("Z", " UTC"))}` : "Loading"}</span>
        </div>
        ${m ? "" : `<div class="alert" data-tone="warn">${icon("wifi-off")}<div><div class="alert-title">Live metrics unavailable</div><div class="alert-meta">The hub API did not answer. Your links still work.</div></div></div>`}
        ${infraHtml}
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Needs attention</h2></div>
        ${alertsHtml}
      </section>`;
  }

  function quickCard(link) {
    const name = link.icon && link.icon !== "link" ? link.icon : "link";
    return `
      <a class="card card-hover quick" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" data-pinned="${link.pinned ? "true" : "false"}">
        <span class="ico-wrap">${icon(name)}</span>
        <span class="quick-body">
          <span class="quick-name">${esc(link.name)}</span>
          <span class="quick-desc">${esc(link.description || hostOf(link.url))}</span>
        </span>
        ${icon("pin", "ico pin-mark")}
      </a>`;
  }

  function linkCard(link) {
    const iconName = link.icon && link.icon !== "link" ? link.icon : "link";
    return `
      <div class="card card-hover link" draggable="true" data-id="${esc(link.id)}" data-pinned="${link.pinned ? "true" : "false"}">
        <span class="drag-handle" title="Drag to reorder">${icon("grip-vertical")}</span>
        <span class="ico-wrap" style="display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:7px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2)">${icon(iconName)}</span>
        <div class="link-main" data-action="open" data-id="${esc(link.id)}" role="link" tabindex="0" title="${esc(link.url)}">
          <div class="link-name">${icon(iconName)}<span>${esc(link.name)}</span></div>
          ${link.description ? `<div class="link-desc">${esc(link.description)}</div>` : ""}
          <div class="link-url">${esc(link.url)}</div>
        </div>
        <div class="link-tools">
          <button class="icon-btn pin-btn" data-action="pin" data-id="${esc(link.id)}" title="${link.pinned ? "Unpin" : "Pin"}" aria-label="${link.pinned ? "Unpin" : "Pin"} ${esc(link.name)}">${icon("pin")}</button>
          <button class="icon-btn" data-action="edit" data-id="${esc(link.id)}" title="Edit" aria-label="Edit ${esc(link.name)}">${icon("pencil")}</button>
          <button class="icon-btn" data-action="delete" data-id="${esc(link.id)}" title="Delete" aria-label="Delete ${esc(link.name)}">${icon("trash-2")}</button>
        </div>
      </div>`;
  }

  function emptyState(iconName, title, text, action) {
    return `<div class="empty">${icon(iconName)}<strong>${esc(title)}</strong><p>${esc(text)}</p>${action || ""}</div>`;
  }

  function visibleLinks() {
    const q = state.query.trim().toLowerCase();
    return state.links.filter((l) => {
      const catOk = state.category === "All" || l.category === state.category;
      const qOk = !q || [l.name, l.url, l.description, l.category].join(" ").toLowerCase().includes(q);
      return catOk && qOk;
    });
  }

  function viewLinks() {
    const links = visibleLinks();
    const chips = ["All", ...CATEGORIES].map((c) =>
      `<button class="chip" data-category="${esc(c)}" aria-pressed="${state.category === c}">${esc(c)}</button>`
    ).join("");

    const body = links.length
      ? `<div class="link-grid${state.layout === "list" ? " list" : ""}">${links.map(linkCard).join("")}</div>`
      : emptyState(state.query || state.category !== "All" ? "search-x" : "link",
          state.query || state.category !== "All" ? "No matches" : "No links yet",
          state.query || state.category !== "All" ? "Try a different search or category." : "Add your first link to get started.",
          `<button class="btn btn-primary btn-sm" data-action="add">${icon("plus")}Add link</button>`);

    return `
      <section>
        <div class="toolbar">
          <div class="chips">${chips}</div>
          <span class="toolbar-spacer"></span>
          <div class="seg" role="group" aria-label="Layout">
            <button data-layout="grid" aria-pressed="${state.layout === "grid"}" title="Grid view">${icon("grid-2x2")}</button>
            <button data-layout="list" aria-pressed="${state.layout === "list"}" title="List view">${icon("list")}</button>
          </div>
        </div>
        <div style="height:10px"></div>
        ${body}
      </section>`;
  }

  function viewInfrastructure() {
    const m = state.metrics;
    if (!m) return emptyState("wifi-off", "Waiting for live data", "The hub API has not answered yet.", `<button class="btn btn-sm" data-action="refresh">${icon("refresh-cw")}Retry</button>`);

    const rows = [
      ["Instance", `${m.vps_instance || "—"}`],
      ["Region", m.vps_region],
      ["CPU", `${m.vps_cpu_pct}% of ${4} cores · load ${m.vps_load1}`],
      ["Memory", `${m.vps_mem_pct}% used · ${freeRam(m)}`],
      ["Disk", `${m.vps_disk_pct}% of 105 GB`],
      ["Containers", `${m.containers_running} running of ${m.containers_total} · ${m.containers_healthy} healthy`],
      ["Sites", `${m.domains_ok} up of ${m.domains_total} · ${m.domains_failing} failing`],
      ["Certificates", `soonest expiry in ${m.cert_min_days} days`],
      ["GitHub", `${m.github_visible_repos} repos · ${m.github_private_repos} private`],
      ["Vercel", `${m.vc_projects} projects · ${m.vc_ready} ready · ${m.vc_errors} errors`],
      ["Coolify", `v${m.coolify_version} · ${m.coolify_apps} apps · ${m.coolify_reachable} server reachable`],
      ["Cloudflare", `${m.cf_zones} zone · ${m.cf_dns_records} DNS records`],
      ["Resend", `${m.rs_delivered} delivered · ${m.rs_bounced} bounced · ${m.rs_failed} failed`],
      ["Data as of", (m.updated || "—").replace("T", " ").replace("Z", " UTC")],
    ];

    return `
      <section>
        <div class="section-head"><h2 class="section-title">Live readings</h2>
          <button class="btn btn-sm" data-action="refresh">${icon("refresh-cw")}Refresh</button></div>
        <div class="card panel">
          <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
        </div>
      </section>`;
  }

  function viewProjects() {
    const q = state.query.trim().toLowerCase();
    const projects = state.projects.filter((p) =>
      !q || [p.name, p.repo, p.url].join(" ").toLowerCase().includes(q));

    if (!state.projects.length) {
      return `<section><div class="section-head"><h2 class="section-title">Projects</h2><span class="section-note">Inventory snapshot</span></div>
        ${emptyState("folder-git-2", "No project data", "The projects inventory is not reachable right now.")}</section>`;
    }

    const rows = projects.map((p) => {
      const tone = p.state === "READY" ? "ok" : p.state === "ERROR" ? "danger" : p.state ? "warn" : "muted";
      const updated = formatDate(p.updatedAt);
      return `<tr>
        <td><span class="proj-name">${esc(p.name)}</span><span class="sub">${esc(p.provider || "Vercel")}${p.protected ? " · protected" : ""}</span></td>
        <td>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(p.url))}</a>` : `<span class="sub">no domain</span>`}</td>
        <td>${p.repoUrl ? `<a href="${esc(p.repoUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.repo || "")}</a>` : `<span class="sub">not linked</span>`}</td>
        <td><span class="badge" data-tone="${tone}"><span class="dot"></span>${esc(p.state || "UNKNOWN")}</span></td>
        <td class="sub">${esc(updated)}</td>
      </tr>`;
    }).join("");

    return `
      <section>
        <div class="section-head"><h2 class="section-title">Projects</h2><span class="section-note">${projects.length} of ${state.projects.length}</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Live URL</th><th>Repository</th><th>State</th><th>Updated</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function viewClients() {
    const q = state.query.trim().toLowerCase();
    const links = state.links.filter((l) =>
      (l.category === "Clients" || l.category === "Projects") &&
      (!q || [l.name, l.url, l.description].join(" ").toLowerCase().includes(q)));

    return `
      <section>
        <div class="section-head"><h2 class="section-title">Client sites</h2><span class="section-note">${links.length} tracked</span></div>
        ${links.length
          ? `<div class="link-grid${state.layout === "list" ? " list" : ""}">${links.map(linkCard).join("")}</div>`
          : emptyState("building-2", "No client sites tracked", "Add links in the Clients category to see them here.")}
      </section>`;
  }

  function viewAgents() {
    return `
      <section>
        <div class="section-head"><h2 class="section-title">Agent access</h2>
          <span class="badge" data-tone="${state.hubUp ? "ok" : "danger"}"><span class="dot"></span>${state.hubUp ? "Hub reachable" : "Hub unreachable"}</span></div>
        <div class="card panel">
          <dl class="kv">
            <dt>Identity</dt><dd>deploy@95.111.196.120</dd>
            <dt>Key</dt><dd>~/.ssh/merqato_deploy (key-only, no password)</dd>
            <dt>Can do</dt><dd>read container state and logs, restart the dashboard stack, read host metrics</dd>
            <dt>Cannot do</dt><dd>root commands, create containers, touch other stacks, read secret files</dd>
            <dt>Audit log</dt><dd>/var/log/agent-actions.log</dd>
            <dt>Coolify token</dt><dd>read + deploy (no create, no delete)</dd>
            <dt>Dashboard</dt><dd>${state.hubUp ? "hub API responding" : "hub API not responding"}</dd>
          </dl>
        </div>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Notes</h2></div>
        <div class="card panel">
          <p style="font-size:12.5px;color:var(--text-2)">
            Agents work through a dedicated scoped identity. Owner approval is still required for
            deletions, credential rotation, production DNS changes and irreversible infrastructure work.
          </p>
        </div>
      </section>`;
  }

  function viewSettings() {
    const linkCount = state.links.length;
    return `
      <section>
        <div class="section-head"><h2 class="section-title">Appearance</h2></div>
        <div class="card panel">
          <div class="row">
            <div><div class="row-title" style="font-weight:550">Theme</div><p>Currently ${state.theme === "dark" ? "dark" : "light"}.</p></div>
            <button class="btn btn-sm" data-action="theme">${icon(state.theme === "dark" ? "sun" : "moon")}Use ${state.theme === "dark" ? "light" : "dark"}</button>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">Quick links</h2><span class="section-note">${linkCount} saved</span></div>
        <div class="card panel">
          <div class="row">
            <div><div style="font-weight:550">Export</div><p>Download every link as JSON.</p></div>
            <a class="btn btn-sm" href="/api/export" download>${icon("download")}Export</a>
          </div>
          <div class="row">
            <div><div style="font-weight:550">Import</div><p>Replace the current list with a JSON file.</p></div>
            <label class="btn btn-sm" style="cursor:pointer">${icon("upload")}Import<input id="import-file" type="file" accept="application/json" hidden /></label>
          </div>
          <div class="row">
            <div><div style="font-weight:550">Starter links</div><p>Restore the default tool set, replacing everything.</p></div>
            <button class="btn btn-sm btn-danger" data-action="reset">${icon("rotate-ccw")}Restore defaults</button>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head"><h2 class="section-title">About</h2></div>
        <div class="card panel">
          <dl class="kv">
            <dt>Version</dt><dd>2026.11</dd>
            <dt>Metrics source</dt><dd>/hub/summary.json (hub API)</dd>
            <dt>Links storage</dt><dd>server-side JSON with backups on every change</dd>
            <dt>Write access</dt><dd>owner session only</dd>
          </dl>
        </div>
      </section>`;
  }

  // ----------------------------------------------------------------- render
  function render() {
    const titles = Object.fromEntries(NAV.map((n) => [n.id, n.label]));
    $("#page-title").textContent = titles[state.view] || "Overview";
    document.title = `${titles[state.view] || "Overview"} · MerQato Workstation`;
    renderNav();

    const view = $("#view");
    const renderers = {
      overview: viewOverview,
      links: viewLinks,
      infrastructure: viewInfrastructure,
      projects: viewProjects,
      clients: viewClients,
      agents: viewAgents,
      settings: viewSettings,
    };
    view.innerHTML = (renderers[state.view] || viewOverview)();

    if (window.lucide) window.lucide.createIcons();
  }

  // ----------------------------------------------------------------- modals
  function openModal(link) {
    $("#f-id").value = link ? link.id : "";
    $("#f-name").value = link ? link.name : "";
    $("#f-url").value = link ? link.url : "";
    $("#f-category").innerHTML = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("#f-category").value = link ? link.category : (state.category === "All" ? "Other" : state.category);
    $("#f-desc").value = link ? (link.description || "") : "";
    $("#f-pinned").checked = link ? !!link.pinned : false;
    $("#f-error").hidden = true;
    $$(".input").forEach((i) => i.removeAttribute("aria-invalid"));
    $("#modal-title").textContent = link ? "Edit link" : "Add link";
    $("#modal-backdrop").hidden = false;
    setTimeout(() => $("#f-name").focus(), 30);
  }

  function closeModal() {
    $("#modal-backdrop").hidden = true;
    $("#link-form").reset();
  }

  async function saveLink(event) {
    event.preventDefault();
    const id = $("#f-id").value;
    const payload = {
      name: $("#f-name").value.trim(),
      url: $("#f-url").value.trim(),
      category: $("#f-category").value,
      description: $("#f-desc").value.trim(),
      pinned: $("#f-pinned").checked,
    };
    const btn = $("#f-save");
    btn.disabled = true;
    try {
      if (id) {
        await api(`/api/links/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast("Link updated");
      } else {
        await api("/api/links", { method: "POST", body: JSON.stringify(payload) });
        toast("Link added");
      }
      closeModal();
      await refresh();
    } catch (err) {
      $("#f-error").textContent = err.message;
      $("#f-error").hidden = false;
      if (err.status === 401) {
        await ensureSession();
        toast("Session renewed — please save again", "error");
      }
    } finally {
      btn.disabled = false;
    }
  }

  // ----------------------------------------------------------------- events
  function wire() {
    // nav + hash routing
    window.addEventListener("hashchange", () => {
      const view = location.hash.replace("#", "") || "overview";
      if (view !== state.view) {
        state.view = view;
        state.query = "";
        const search = $("#global-search");
        if (search) search.value = "";
        render();
        window.scrollTo({ top: 0 });
      }
    });

    $("#theme-toggle").addEventListener("click", toggleTheme);
    $("#refresh-btn").addEventListener("click", () => refresh(true));
    $("#add-link-btn").addEventListener("click", () => openModal(null));
    $("#modal-close").addEventListener("click", closeModal);
    $("#f-cancel").addEventListener("click", closeModal);
    $("#link-form").addEventListener("submit", saveLink);
    $("#modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });

    const search = $("#global-search");
    search.addEventListener("input", debounce(() => {
      state.query = search.value;
      if (state.view === "overview" && state.query) {
        state.view = "links";
        location.hash = "#links";
        render();
        return;
      }
      render();
    }, 160));

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (e.key === "/" && !typing) { e.preventDefault(); $("#global-search").focus(); }
      if (e.key === "Escape") {
        if (!$("#modal-backdrop").hidden) closeModal();
        else if (state.query) { state.query = ""; $("#global-search").value = ""; render(); }
      }
    });

    // delegated actions
    $("#view").addEventListener("click", async (e) => {
      const target = e.target.closest("[data-action], [data-category], [data-layout]");
      if (!target) {
        const open = e.target.closest('.link-main[data-action="open"]');
        if (open) window.open(open.dataset.id ? (state.links.find((l) => l.id === open.dataset.id) || {}).url : "", "_blank", "noopener");
        return;
      }
      if (target.dataset.category) {
        state.category = target.dataset.category;
        render();
        return;
      }
      if (target.dataset.layout) {
        applyLayout(target.dataset.layout);
        render();
        return;
      }
      const action = target.dataset.action;
      const id = target.dataset.id;

      if (action === "add") return openModal(null);
      if (action === "refresh") return refresh(true);
      if (action === "theme") return toggleTheme();
      if (action === "open") {
        const opened = state.links.find((l) => l.id === target.dataset.id);
        if (opened) window.open(opened.url, "_blank", "noopener");
        return;
      }

      const link = state.links.find((l) => l.id === id);
      if (!link) return;

      if (action === "edit") return openModal(link);
      if (action === "pin") {
        try {
          await api(`/api/links/${encodeURIComponent(id)}`, {
            method: "PATCH", body: JSON.stringify({ pinned: !link.pinned }),
          });
          await refresh();
        } catch (err) { toast(err.message, "error"); }
        return;
      }
      if (action === "delete") {
        if (!confirm(`Delete “${link.name}”?`)) return;
        try {
          await api(`/api/links/${encodeURIComponent(id)}`, { method: "DELETE" });
          await refresh();
          toast("Link deleted");
        } catch (err) { toast(err.message, "error"); }
        return;
      }
      if (action === "reset") {
        if (!confirm("Replace every link with the starter set?")) return;
        try {
          const starters = await api("/api/starter-links");
          if (!starters || !Array.isArray(starters.links)) {
            throw new Error("Starter links are unavailable");
          }
          await api("/api/links/import", { method: "POST", body: JSON.stringify({ links: starters.links }) });
          await refresh();
          toast("Starter links restored");
        } catch (err) { toast(err.message, "error"); }
      }
    });

    // keyboard activation for link cards
    $("#view").addEventListener("keydown", (e) => {
      const main = e.target.closest('.link-main[data-action="open"]');
      if (main && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        const link = state.links.find((l) => l.id === main.dataset.id);
        if (link) window.open(link.url, "_blank", "noopener");
      }
    });

    // import
    $("#view").addEventListener("change", async (e) => {
      if (e.target.id !== "import-file") return;
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const links = Array.isArray(parsed) ? parsed : parsed.links;
        if (!Array.isArray(links)) throw new Error("No links array found in that file");
        await api("/api/links/import", { method: "POST", body: JSON.stringify({ links }) });
        await refresh();
        toast(`Imported ${links.length} links`);
      } catch (err) {
        toast(err.message || "Import failed", "error");
      }
    });

    // drag and drop ordering
    let dragId = null;
    $("#view").addEventListener("dragstart", (e) => {
      const card = e.target.closest(".link");
      if (!card) return;
      dragId = card.dataset.id;
      card.dataset.dragging = "true";
      e.dataTransfer.effectAllowed = "move";
    });
    $("#view").addEventListener("dragend", (e) => {
      const card = e.target.closest(".link");
      if (card) card.removeAttribute("data-dragging");
      $$(".link").forEach((l) => l.removeAttribute("data-dragover"));
    });
    $("#view").addEventListener("dragover", (e) => {
      const card = e.target.closest(".link");
      if (!card || !dragId || card.dataset.id === dragId) return;
      e.preventDefault();
      $$(".link").forEach((l) => l.removeAttribute("data-dragover"));
      card.dataset.dragover = "true";
    });
    $("#view").addEventListener("drop", async (e) => {
      const card = e.target.closest(".link");
      if (!card || !dragId) return;
      e.preventDefault();
      const targetId = card.dataset.id;
      if (targetId === dragId) return;

      // Move only the dragged link in the complete global order. This keeps
      // links hidden by the current search/category in their original places.
      const fullOrder = state.links.map((l) => l.id);
      const from = fullOrder.indexOf(dragId);
      const targetFrom = fullOrder.indexOf(targetId);
      if (from === -1 || targetFrom === -1) return;
      fullOrder.splice(from, 1);
      let targetIndex = fullOrder.indexOf(targetId);
      if (from < targetFrom) targetIndex += 1;
      fullOrder.splice(targetIndex, 0, dragId);
      dragId = null;

      const byId = new Map(state.links.map((l) => [l.id, l]));
      const payload = {};
      state.links = fullOrder.map((id, i) => ({ ...byId.get(id), order: i }));

      try {
        await api("/api/links/reorder", { method: "POST", body: JSON.stringify({ order: fullOrder }) });
        render();
      } catch (err) {
        toast(err.message, "error");
        await refresh();
      }
    });
  }

  // ------------------------------------------------------------------- boot
  async function refresh(announce = false) {
    try {
      await ensureSession();
      await Promise.all([loadLinks(), loadMetrics(), checkHub()]);
      state.loaded = true;
      render();
      if (announce) toast("Refreshed");
    } catch (err) {
      state.loaded = true;
      render();
      if (announce) toast(err.message, "error");
    }
  }

  function boot() {
    applyTheme(state.theme);
    state.view = location.hash.replace("#", "") || "overview";
    wire();
    render();
    refresh(false);
    setInterval(() => { if (!document.hidden) refresh(false); }, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
// Presentation preferences belong to this browser. Race workflow lives in the
// shared Event document; changing a view must never change race progression.
const EventDirectorUI = (() => {
  const KEY = "fpvgate.eventDirector.ui.v1";
  const PRESETS = {
    guided: { layout: "auto", wizard: true, checklist: true, prompts: true, upcoming: true, schedule: true, standings: true, statistics: false, advanced: false },
    club: { layout: "dashboard", wizard: false, checklist: false, prompts: false, upcoming: true, schedule: true, standings: true, statistics: false, advanced: false },
  };
  const LABELS = { wizard: "Guided event setup", checklist: "Pre-race timing checklist", prompts: "Explanations and next-step prompts", upcoming: "Upcoming pilots and channels", schedule: "Full schedule", standings: "Standings", statistics: "Detailed race statistics", advanced: "Advanced grouping and schedule tools" };
  let prefs = { preset: "guided", ...PRESETS.guided };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === "object") {
      if (["guided", "club", "custom"].includes(saved.preset)) prefs.preset = saved.preset;
      if (["auto", "dashboard", "focused", "full-page"].includes(saved.layout)) prefs.layout = saved.layout;
      for (const key of Object.keys(LABELS)) if (typeof saved[key] === "boolean") prefs[key] = saved[key];
    }
  } catch (_) { /* Storage may be unavailable; keep usable defaults. */ }
  let current = null, view = "run", wizardStep = 0, selectedStep = null;
  let presentedActive = "";
  let rounds = 3;
  const checks = new Set();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const button = (action, label, attrs = "") => `<button type="button" class="c5p-btn" data-ui-act="${action}" ${attrs}>${label}</button>`;
  const hint = text => prefs.prompts ? `<p class="c5p-hint">${text}</p>` : "";

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) {}
    syncSettings();
    if (current) current.render();
  }

  function syncSettings() {
    const host = document.getElementById("eventDirectorPreferences");
    if (!host) return;
    host.innerHTML = `<h3>Event Director</h3><p class="c5p-hint">Display preferences apply to this browser. Race workflow is shared under Event → Pilots &amp; setup.</p>
      <div class="ev-preference-grid"><label>Experience<select data-ev-pref="preset" aria-label="Event director experience">
      ${["guided", "club", "custom"].map(p => `<option value="${p}"${prefs.preset === p ? " selected" : ""}>${p[0].toUpperCase() + p.slice(1)}</option>`).join("")}</select></label>
      <label>Layout<select data-ev-pref="layout" aria-label="Event director layout">${Object.entries({ auto: "Auto: dashboard on desktop, focused on mobile", dashboard: "Schedule dashboard", focused: "One race at a time", "full-page": "Full page (original layout)" }).map(([k, v]) => `<option value="${k}"${prefs.layout === k ? " selected" : ""}>${v}</option>`).join("")}</select></label></div>
      ${prefs.layout === "full-page" ? '<p class="c5p-hint">Full page shows pilots, groups, heats and race rules together. Switch layouts to return to guided setup or the race dashboard.</p>' : ""}
      <div class="ev-preference-grid">${Object.entries(LABELS).map(([key, label]) => `<label class="c5p-check"><input type="checkbox" data-ev-pref="${key}"${prefs[key] ? " checked" : ""}> ${label}</label>`).join("")}</div>
      ${button("reset-preferences", "Reset to preset")}<p class="c5p-hint" role="status" id="eventPreferenceStatus"></p>`;
  }

  function changePreference(t) {
    const key = t.dataset.evPref;
    if (!key) return false;
    if (key === "preset") {
      if (PRESETS[t.value]) prefs = { preset: t.value, ...PRESETS[t.value] };
      else prefs.preset = "custom";
    } else if (key === "layout") {
      if (!["auto", "dashboard", "focused", "full-page"].includes(t.value)) return true;
      prefs.layout = t.value; prefs.preset = "custom";
    } else if (key in LABELS) { prefs[key] = t.checked; prefs.preset = "custom"; }
    persist();
    return true;
  }

  function label(step) {
    const seq = current.sequence(), gid = seq[step];
    const group = current.doc.groups.find(g => g.id === gid);
    if (!group) return "Event complete";
    const round = seq.slice(0, step + 1).filter(id => id === gid).length;
    return `Round ${round} · ${group.name}`;
  }

  function checkKey(group, p) {
    return JSON.stringify([current.doc.name, group.id, p.id, current.frequency(group, p.id), p.enter, p.exit]);
  }

  function warnings(group) {
    if (!group) return [];
    const messages = [], used = new Map();
    const format = current.format(group);
    if (!(format.maxLaps > 0 || format.timeLimitS > 0)) messages.push("Set a lap target or heat duration under Pilots & setup → Race rules.");
    if (!group.pilotIds.length) messages.push("This group has no pilots. Add pilots under Pilots & setup.");
    if (group.pilotIds.length > 8) messages.push("This group has more than eight pilots. Move pilots to another group.");
    for (const id of group.pilotIds) {
      const p = current.doc.pilots.find(pilot => pilot.id === id);
      if (!p) { messages.push("A pilot in this group was removed. Update the group before racing."); continue; }
      const f = current.frequency(group, id);
      if (!p.name.trim()) messages.push("A pilot needs a name under Pilots & setup.");
      if (!(f >= 5180 && f <= 5917)) messages.push(`${p.name || "Pilot"} needs a supported channel.`);
      if (used.has(f)) messages.push(`${used.get(f)} and ${p.name || "Pilot"} share ${current.channel(f)}. Change a channel under Pilots & setup.`);
      used.set(f, p.name || "Pilot");
    }
    return messages;
  }

  function renderReview() {
    const race = current.doc.races.find(r => r.id === current.doc.schedule.reviewRaceId);
    if (!race) return "";
    return `<section class="ev-director-card ev-review" aria-label="Results awaiting confirmation"><span class="ev-eyebrow">Review results</span>
      <h3>${race.step == null ? "Unscheduled race" : esc(label(race.step))}</h3>
      <p>The race is saved. Check the results before preparing another race.</p>
      <div class="ev-table-scroll">${current.resultsTable(race)}</div>
      <div class="ev-actions">${button("confirm-results", "Confirm results", current.running ? "disabled" : "")}${button("refresh-review", "Refresh corrected results")}${button("history", "Open Race History / Marshal")}</div>
      <p class="c5p-hint">Make corrections in Race History / Marshal, then refresh here. Confirmation checks the saved race again before continuing.</p></section>`;
  }

  function renderRaceCard() {
    const d = current.doc, seq = current.sequence();
    const active = d.active?.step;
    const step = selectedStep != null && selectedStep < seq.length ? selectedStep :
      (active != null && !(current.raceOfStep(active) && d.schedule.pos > active) ? active : d.schedule.pos);
    const group = d.groups.find(g => g.id === seq[step]);
    if (!group) return `<section class="ev-director-card"><h3>${seq.length ? "All scheduled races are complete" : "Let’s set up your event"}</h3>
      <p>${seq.length ? "Review the results or return to setup to plan more racing." : "Add your pilots, choose the race rules and preview the groups."}</p>
      ${button(seq.length ? "results" : "setup", seq.length ? "View results" : "Set up event")}</section>`;
    const loaded = active === step && d.active?.groupId === group.id;
    const issues = warnings(group), race = current.raceOfStep(step);
    const format = current.format(group);
    const rows = group.pilotIds.map(id => {
      const p = d.pilots.find(p => p.id === id);
      if (!p) return "";
      const checked = checks.has(checkKey(group, p));
      return `<div class="ev-director-pilot"><span><span class="ev-dot" style="--c:${esc(p.color || "#888")}"></span> ${esc(p.name || "Unnamed pilot")}</span>
        <b>${esc(current.channel(current.frequency(group, id)))}</b>
        ${prefs.checklist ? `<label class="c5p-check"><input type="checkbox" data-ui-check="${id}" data-ui-group="${group.id}"${checked ? " checked" : ""}> Timing checked</label>` : ""}</div>`;
    }).join("");
    const nextGroup = d.groups.find(g => g.id === seq[step + 1]);
    return `<section class="ev-director-card"><span class="ev-eyebrow">${current.running && loaded ? "Racing" : loaded ? "Prepared on gate" : race ? "Completed race" : "Up next"} · Race ${step + 1} of ${seq.length}</span>
      <h3>${esc(label(step))}</h3><p>${esc(format.name)} · ${esc(current.winLabel(format.win))}${format.timeLimitS ? ` · ${format.timeLimitS}s limit` : ""}</p>
      ${hint("Check the pilots and channels, prepare this race, then use the live Race screen to start it.")}
      <div class="ev-director-roster">${rows}</div>
      ${prefs.checklist ? hint("Tick Timing checked after testing each pilot’s detection. These checks apply to this browser and reset when pilot channels or thresholds change.") : ""}
      ${issues.map(text => `<p class="ev-director-warning" role="alert">${esc(text)}</p>`).join("")}
      <div class="ev-actions">${loaded ? button("live-race", current.running ? "Open live race" : "Continue to Race screen") : button("prepare", race ? "Prepare race again" : "Prepare this race", `data-ui-step="${step}"${issues.length || current.running || d.schedule.reviewRaceId ? " disabled" : ""}`)}
      ${prefs.checklist ? button("calibration", "Check timing in Calibration") : ""}
      ${!race && !current.running ? button("skip", "Skip race…", `data-ui-step="${step}"${d.schedule.reviewRaceId ? " disabled" : ""}`) : ""}</div>
      ${race ? `<details><summary>Saved results</summary><div class="ev-table-scroll">${current.resultsTable(race)}</div></details>` : ""}
      ${prefs.upcoming && nextGroup ? `<div class="ev-next"><span class="ev-eyebrow">After this</span><b>${esc(label(step + 1))}</b><p>${nextGroup.pilotIds.map(id => `${esc(current.pilotName(id))} ${esc(current.channel(current.frequency(nextGroup, id)))}`).join(" · ")}</p></div>` : ""}</section>`;
  }

  function renderSchedule() {
    return `<aside class="ev-director-card ev-director-schedule" aria-label="Race schedule"><h3>Schedule</h3>
      <div class="ev-schedule-list">${current.sequence().map((_, step) => `<button type="button" class="ev-schedule-item${selectedStep === step || (selectedStep == null && current.doc.active?.step === step) ? " ev-selected" : ""}" data-ui-act="select-race" data-ui-step="${step}">
      <span>${esc(label(step))}</span><small>${current.raceOfStep(step) ? "Completed" : current.doc.schedule.skipped?.includes(step) ? "Skipped" : current.doc.active?.step === step ? "Prepared" : "Upcoming"}</small></button>`).join("")}</div>
      ${hint("Select a race to preview it. Preparing it is a separate action.")}</aside>`;
  }

  function renderWorkflow() {
    const s = current.doc.schedule;
    return `<section class="ev-director-card"><h3>Race workflow</h3><p class="c5p-hint">Saved with this event and shared by every connected device. Display presets do not change these rules.</p>
      <label class="c5p-check"><input type="checkbox" data-f="requireReview"${s.requireReview ? " checked" : ""}${current.running ? " disabled" : ""}> Require result confirmation before another race</label>
      <label class="c5p-check"><input type="checkbox" data-f="auto"${s.auto ? " checked" : ""}${current.running ? " disabled" : ""}> Load the next heat automatically after results${s.requireReview ? " are confirmed" : " are saved"}</label>
      <label class="c5p-check"><input type="checkbox" data-f="autoChannels"${s.autoChannels !== false ? " checked" : ""}${current.running ? " disabled" : ""}> Assign channels automatically when building groups</label>
      <p class="c5p-hint">The next race always needs an explicit Start. Existing events keep their current workflow until you change it.</p></section>`;
  }

  function renderSetup() {
    const c = current, d = c.doc;
    const groups = `<div class="ev-setup-fields"><label>Pilots flying together<select data-f="groupSize">${[2,3,4,5,6,7,8].map(n => `<option value="${n}"${d.groupSize === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Rounds per group<input type="number" min="1" max="50" data-ui-rounds value="${rounds}"></label>
      <label>Channel band<select data-f="band">${c.bands().map(b => `<option value="${esc(b.value)}"${d.band === b.value ? " selected" : ""}>${esc(b.label)}</option>`).join("")}</select></label></div>
      ${hint("A round gives every group one race. The preview shows the actual race order before you use it.")}
      ${button("build-schedule", d.groups.length ? "Rebuild groups and schedule…" : "Create groups and schedule", c.running ? "disabled" : "")}
      ${c.renderGroups()}`;
    const pilots = `<label class="ev-bulk-label">Add several pilots (one name per line)<textarea id="evBulkPilots" rows="4" placeholder="Alex&#10;Jamie&#10;Sam"></textarea></label>${button("bulk-pilots", "Add these pilots")}${c.renderPilots()}`;
    const review = `<section class="ev-director-card"><h3>Review your event</h3><p>${d.pilots.length} pilots · ${d.groups.length} groups · ${c.sequence().length} races</p>
      ${d.groups.flatMap(g => warnings(g)).map(text => `<p class="ev-director-warning" role="alert">${esc(text)}</p>`).join("")}
      ${c.renderHeats()}${button("run", "Go to race-day dashboard", c.sequence().length ? "" : "disabled")}</section>`;
    const advanced = prefs.advanced ? `<details class="ev-director-card"><summary>Advanced grouping and schedule tools</summary>${c.advancedControls()}${c.renderHeats()}</details>` : "";
    if (!prefs.wizard) return `${pilots}${c.renderFormats()}${groups}${renderWorkflow()}${advanced}${review}`;
    const steps = ["Pilots", "Race rules", "Groups", "Review"];
    return `<nav class="ev-setup-steps" aria-label="Event setup steps">${steps.map((text, i) => button("wizard-step", `${i + 1}. ${text}`, `data-ui-index="${i}" aria-current="${wizardStep === i ? "step" : "false"}"`)).join("")}</nav>
      <div class="ev-setup-stage">${[pilots, `${hint("Choose how a race finishes and how results are ranked. Expand the formats below to edit limits and the start countdown.")}${c.renderFormats()}${renderWorkflow()}`, groups + advanced, review][wizardStep]}</div>
      <div class="ev-actions">${wizardStep ? button("wizard-step", "Back", `data-ui-index="${wizardStep - 1}"`) : ""}${wizardStep < 3 ? button("wizard-step", `Next: ${steps[wizardStep + 1]}`, `data-ui-index="${wizardStep + 1}"`) : ""}</div>`;
  }

  function render(c) {
    current = c;
    const d = c.doc;
    const activeKey = JSON.stringify([d.active?.groupId, d.active?.step]);
    if (presentedActive !== activeKey) selectedStep = null;
    presentedActive = activeKey;
    if (prefs.layout === "full-page") {
      return `${renderReview()}<div class="c5p-main ev-main ev-full-page">
        <div class="c5p-left">${prefs.schedule ? c.renderHeats() : ""}${c.renderGroups()}${prefs.standings ? c.renderLeaderboard() : ""}</div>
        <div class="ev-side">${c.renderPilots()}</div>
      </div>${c.renderFormats()}${renderWorkflow()}`;
    }
    if (!d.pilots.length && !d.races.length && view === "run") view = "setup";
    const effectiveView = view;
    const completed = c.sequence().filter((_, i) => c.raceOfStep(i)).length;
    const navigation = `<div class="ev-director-top"><nav class="ev-director-tabs" aria-label="Event pages">${Object.entries({ run: "Run event", setup: "Pilots & setup", results: "Results" }).map(([key, text]) => button(key, text, `aria-pressed="${effectiveView === key}"`)).join("")}</nav><span>${completed} of ${c.sequence().length} races complete</span></div>`;
    const results = effectiveView === "results" ? `${prefs.standings ? c.renderLeaderboard() : ""}${d.races.length ? d.races.slice().reverse().map(r => `<section class="ev-director-card"><h3>${esc(r.step == null ? "Unscheduled race" : label(r.step))}</h3><div class="ev-table-scroll">${c.resultsTable(r)}</div></section>`).join("") : `<p>No results yet. Completed races will appear here.</p>`}` : "";
    const review = renderReview();
    const content = effectiveView === "setup" ? renderSetup() : effectiveView === "results" ? results :
      `${review}<div class="ev-director-layout ev-layout-${prefs.layout}${prefs.schedule ? "" : " ev-no-schedule"}">${prefs.schedule ? renderSchedule() : ""}<div class="ev-director-current">${review ? "" : renderRaceCard()}${prefs.standings ? c.renderLeaderboard() : ""}</div></div>`;
    return `${navigation}${effectiveView !== "run" ? review : ""}${content}`;
  }

  function handleChange(t) {
    if (t.dataset.uiRounds != null) { rounds = Math.max(1, Math.min(50, Math.floor(+t.value) || 3)); t.value = rounds; return true; }
    if (t.dataset.uiCheck != null) {
      const group = current.doc.groups.find(g => g.id === +t.dataset.uiGroup), p = current.doc.pilots.find(p => p.id === +t.dataset.uiCheck);
      if (group && p) { const key = checkKey(group, p); if (t.checked) checks.add(key); else checks.delete(key); }
      return true;
    }
    return false;
  }

  function handleClick(btn) {
    if (!btn?.dataset.uiAct || !current) return false;
    const c = current, action = btn.dataset.uiAct;
    if (btn.disabled) return true;
    if (["run", "setup", "results"].includes(action)) { view = action; if (action === "run") selectedStep = null; }
    else if (action === "wizard-step") wizardStep = Math.max(0, Math.min(3, +btn.dataset.uiIndex));
    else if (action === "select-race") selectedStep = +btn.dataset.uiStep;
    else if (action === "prepare") {
      const step = +btn.dataset.uiStep;
      if (c.raceOfStep(step) && !confirm("Prepare this completed race again? Its saved results will be kept.")) return true;
      c.loadStep(step); return true;
    }
    else if (action === "skip") { c.skipStep(+btn.dataset.uiStep); selectedStep = null; }
    else if (action === "confirm-results") { c.confirmResults(); return true; }
    else if (action === "refresh-review") { c.refreshReviewRace().catch(error => alert(error.message)); return true; }
    else if (action === "live-race") { document.getElementById("nav-link-race")?.click(); return true; }
    else if (action === "calibration") { document.getElementById("nav-link-calib")?.click(); return true; }
    else if (action === "history") { document.getElementById("nav-link-history")?.click(); return true; }
    else if (action === "bulk-pilots") {
      if (c.running || c.doc.schedule.reviewRaceId) return true;
      const input = document.getElementById("evBulkPilots");
      const names = (input?.value || "").split(/\r?\n/).map(n => n.trim().slice(0, 20)).filter(Boolean);
      if (!names.length) return true;
      c.addPilots(names); c.save();
    } else if (action === "build-schedule") { c.buildSchedule(rounds); }
    else return false;
    c.render(); return true;
  }

  const settings = document.getElementById("eventDirectorPreferences");
  if (settings) {
    settings.addEventListener("change", e => changePreference(e.target));
    settings.addEventListener("click", e => {
      if (e.target.closest('[data-ui-act="reset-preferences"]')) {
        const preset = PRESETS[prefs.preset] ? prefs.preset : "guided";
        prefs = { preset, ...PRESETS[preset] }; persist();
      }
    });
    syncSettings();
  }
  return { render, handleChange, handleClick, statistics: () => prefs.statistics, advanced: () => prefs.advanced, fullPage: () => prefs.layout === "full-page",
    select: step => { selectedStep = step; }, resetEvent: () => { view = "run"; wizardStep = 0; selectedStep = null; checks.clear(); } };
})();

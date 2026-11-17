/* ===== Supabase Config ===== */
const SUPABASE_URL = "https://kxdqarwlemjqdfuzwwdz.supabase.co";
const SUPABASE_KEY = "sb_publishable_nv77vPgILmqZyZKzRkz7NA_UfyJuigG"; // publishable key – safe in the browser (RLS protects data)

// NOTE: named `sb` because the CDN script already defines a global called `supabase`
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ===== State ===== */
let EVENTS = [];         // loaded from Supabase (list_events)
let REGISTRATIONS = [];  // this visitor's registrations (loaded from Supabase)
let currentFilter = "all";
let selectedEventId = null;

/* ===== DOM refs ===== */
const eventsGrid = document.getElementById("eventsGrid");
const registeredList = document.getElementById("registeredList");
const emptyRegistered = document.getElementById("emptyRegistered");
const regModal = document.getElementById("regModal");
const slipModal = document.getElementById("slipModal");
const regForm = document.getElementById("regForm");
const toast = document.getElementById("toast");

/* ===== Helpers ===== */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function getRegistrations() {
  return REGISTRATIONS;
}

function shortRef(id) {
  return String(id).slice(0, 8).toUpperCase();
}

/* ===== Supabase data layer ===== */
// Every visitor gets a private anonymous account, so "My Registrations"
// is tied to them and protected by Row Level Security.
async function ensureSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return anon.session;
}

async function loadEvents() {
  const { data, error } = await sb.rpc("list_events");
  if (error) throw error;
  EVENTS = (data || []).map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    date: e.event_date,
    time: e.time_label,
    venue: e.venue,
    description: e.description,
    seats: e.seats,
    registered: e.registered,
    eligibility: e.eligibility
  }));
}

async function loadRegistrations() {
  const { data, error } = await sb
    .from("registrations")
    .select("id, event_id, full_name, student_id, email, phone, department, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  REGISTRATIONS = (data || []).map((r) => ({
    id: r.id,
    eventId: r.event_id,
    fullName: r.full_name,
    studentId: r.student_id,
    email: r.email,
    phone: r.phone,
    department: r.department || "—",
    registeredAt: r.created_at
  }));
}

async function refreshData() {
  await Promise.all([loadEvents(), loadRegistrations()]);
  renderEvents();
  renderRegistered();
  updateStats();
}

function formatDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function seatsLeft(event) {
  return Math.max(0, event.seats - event.registered);
}

function seatStatus(left, total) {
  if (left <= 0) return { text: "Full", class: "full" };
  if (left <= total * 0.15) return { text: `${left} seats left`, class: "low" };
  return { text: `${left} seats available`, class: "available" };
}

function isAlreadyRegistered(eventId) {
  return getRegistrations().some((r) => r.eventId === eventId);
}

/* ===== Render Events ===== */
function renderEvents() {
  const filtered =
    currentFilter === "all"
      ? EVENTS
      : EVENTS.filter((e) => e.category === currentFilter);

  eventsGrid.innerHTML = "";

  if (filtered.length === 0) {
    eventsGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>No events in this category.</p></div>`;
    return;
  }

  filtered.forEach((event, i) => {
    const left = seatsLeft(event);
    const status = seatStatus(left, event.seats);
    const already = isAlreadyRegistered(event.id);
    const catClass = event.category.toLowerCase();

    const card = document.createElement("article");
    card.className = "event-card";
    card.style.animationDelay = `${i * 0.06}s`;
    card.innerHTML = `
      <div class="event-banner ${catClass}">
        <span class="event-category">${escapeHtml(event.category)}</span>
      </div>
      <div class="event-body">
        <h3 class="event-title">${escapeHtml(event.title)}</h3>
        <p class="event-desc">${escapeHtml(event.description)}</p>
        <div class="event-meta">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${formatDate(event.date)} · ${escapeHtml(event.time)}
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${escapeHtml(event.venue)}
          </span>
        </div>
        <div class="event-footer">
          <span class="seats ${status.class}">${status.text}</span>
          ${
            already
              ? `<button class="btn btn-outline btn-sm" disabled>Registered</button>`
              : left > 0
              ? `<button class="btn btn-primary btn-sm" data-register="${escapeHtml(event.id)}">Register</button>`
              : `<button class="btn btn-primary btn-sm" disabled>Full</button>`
          }
        </div>
      </div>
    `;
    eventsGrid.appendChild(card);
  });

  // Attach register buttons
  eventsGrid.querySelectorAll("[data-register]").forEach((btn) => {
    btn.addEventListener("click", () => openRegistration(btn.dataset.register));
  });

  updateStats();
}

/* ===== Render Registered ===== */
function renderRegistered() {
  const regs = getRegistrations();
  registeredList.innerHTML = "";

  if (regs.length === 0) {
    emptyRegistered.classList.remove("hidden");
    return;
  }

  emptyRegistered.classList.add("hidden");

  regs
    .slice()
    .reverse()
    .forEach((reg, i) => {
      const event = EVENTS.find((e) => e.id === reg.eventId);
      if (!event) return;

      const card = document.createElement("div");
      card.className = "reg-card";
      card.style.animationDelay = `${i * 0.05}s`;
      card.innerHTML = `
        <div class="reg-card-info">
          <h4>${escapeHtml(event.title)}</h4>
          <div class="reg-card-meta">
            <span>${formatDate(event.date)}</span>
            <span>${escapeHtml(event.venue)}</span>
            <span>ID: ${escapeHtml(reg.studentId)}</span>
          </div>
        </div>
        <div class="reg-card-actions">
          <button class="btn btn-outline btn-sm" data-slip="${escapeHtml(reg.id)}">View Slip</button>
          <button class="btn btn-ghost btn-sm" data-cancel="${escapeHtml(reg.id)}">Cancel</button>
        </div>
      `;
      registeredList.appendChild(card);
    });

  registeredList.querySelectorAll("[data-slip]").forEach((btn) => {
    btn.addEventListener("click", () => showSlip(btn.dataset.slip));
  });

  registeredList.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => cancelRegistration(btn.dataset.cancel));
  });

  updateStats();
}

/* ===== Stats ===== */
function updateStats() {
  const totalEvents = EVENTS.length;
  const totalSeatsLeft = EVENTS.reduce((sum, e) => sum + seatsLeft(e), 0);
  const myCount = getRegistrations().length;

  animateNumber("statEvents", totalEvents);
  animateNumber("statSeats", totalSeatsLeft);
  animateNumber("statRegistered", myCount);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent, 10) || 0;
  if (start === target) return;
  const duration = 500;
  const startTime = performance.now();

  function tick(now) {
    const p = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * ease);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ===== Modal: Registration ===== */
function openRegistration(eventId) {
  const event = EVENTS.find((e) => e.id === eventId);
  if (!event || seatsLeft(event) <= 0 || isAlreadyRegistered(eventId)) return;

  selectedEventId = eventId;
  document.getElementById("eventId").value = eventId;
  document.getElementById("modalTitle").textContent = "Register for Event";
  document.getElementById("modalEventMeta").textContent =
    `${event.title} · ${formatDate(event.date)} · ${event.venue}`;

  regForm.reset();
  clearErrors();
  regModal.classList.add("open");
  regModal.setAttribute("aria-hidden", "false");
  document.getElementById("fullName").focus();
}

function closeRegModal() {
  regModal.classList.remove("open");
  regModal.setAttribute("aria-hidden", "true");
  selectedEventId = null;
}

/* ===== Validation ===== */
function clearErrors() {
  ["errName", "errId", "errEmail", "errPhone", "errAgree"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  });
  regForm.querySelectorAll(".error").forEach((el) => el.classList.remove("error"));
}

function validateForm() {
  clearErrors();
  let valid = true;

  const name = document.getElementById("fullName").value.trim();
  const studentId = document.getElementById("studentId").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const agree = document.getElementById("agree").checked;

  if (!name || name.length < 3) {
    document.getElementById("errName").textContent = "Please enter your full name (min 3 characters).";
    document.getElementById("fullName").classList.add("error");
    valid = false;
  }

  if (!studentId || studentId.length < 4) {
    document.getElementById("errId").textContent = "Enter a valid Student ID.";
    document.getElementById("studentId").classList.add("error");
    valid = false;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRe.test(email)) {
    document.getElementById("errEmail").textContent = "Enter a valid email address.";
    document.getElementById("email").classList.add("error");
    valid = false;
  }

  const phoneRe = /^[6-9]\d{9}$/;
  if (!phone || !phoneRe.test(phone.replace(/\s+/g, ""))) {
    document.getElementById("errPhone").textContent = "Enter a valid 10-digit mobile number.";
    document.getElementById("phone").classList.add("error");
    valid = false;
  }

  if (!agree) {
    document.getElementById("errAgree").textContent = "You must confirm the details.";
    valid = false;
  }

  return valid;
}

/* ===== Submit Registration ===== */
function setSubmitting(on) {
  const submitBtn = document.getElementById("submitReg");
  submitBtn.disabled = on;
  submitBtn.querySelector(".btn-text").classList.toggle("hidden", on);
  submitBtn.querySelector(".btn-loader").classList.toggle("hidden", !on);
}

regForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validateForm()) return;

  const eventId = document.getElementById("eventId").value;
  const event = EVENTS.find((ev) => ev.id === eventId);
  if (!event || seatsLeft(event) <= 0) {
    showToast("Registration Failed", "This event is full or no longer available.");
    closeRegModal();
    return;
  }

  if (isAlreadyRegistered(eventId)) {
    showToast("Already Registered", "You have already registered for this event.");
    closeRegModal();
    return;
  }

  setSubmitting(true);

  const payload = {
    event_id: eventId,
    full_name: document.getElementById("fullName").value.trim(),
    student_id: document.getElementById("studentId").value.trim(),
    email: document.getElementById("email").value.trim().toLowerCase(),
    phone: document.getElementById("phone").value.trim().replace(/\s+/g, ""),
    department: document.getElementById("department").value || null
  };

  try {
    await ensureSession();
    const { error } = await sb.from("registrations").insert(payload);

    if (error) {
      const msg = error.message || "";
      if (msg.includes("EVENT_FULL")) {
        showToast("Event Full", "Sorry, the last seat was just taken.");
      } else if (error.code === "23505") {
        showToast("Already Registered", "This Student ID or device is already registered for this event.");
      } else {
        console.error(error);
        showToast("Registration Failed", "Something went wrong. Please try again.");
      }
      closeRegModal();
      await refreshData();
      return;
    }

    closeRegModal();
    await refreshData();
    showToast(
      "Registration Successful!",
      `You are registered for "${event.title}". View confirmation in My Registrations.`
    );
  } catch (err) {
    console.error(err);
    showToast("Network Error", "Could not reach the server. Check your connection and try again.");
  } finally {
    setSubmitting(false);
  }
});

/* ===== Cancel Registration ===== */
async function cancelRegistration(regId) {
  if (!confirm("Cancel this registration? The seat will be released.")) return;

  try {
    const { error } = await sb.from("registrations").delete().eq("id", regId);
    if (error) throw error;
    await refreshData();
    showToast("Registration Cancelled", "Your seat has been released.");
  } catch (err) {
    console.error(err);
    showToast("Cancel Failed", "Could not cancel right now. Please try again.");
  }
}

/* ===== Confirmation Slip ===== */
function showSlip(regId) {
  const reg = getRegistrations().find((r) => r.id === regId);
  if (!reg) return;
  const event = EVENTS.find((e) => e.id === reg.eventId);
  if (!event) return;

  document.getElementById("slipEventName").textContent = event.title;
  document.getElementById("slipMeta").innerHTML = `
    ${formatDate(event.date)} · ${escapeHtml(event.time)}<br/>
    ${escapeHtml(event.venue)}
  `;
  document.getElementById("slipDetails").innerHTML = `
    <p><span>Name</span><span>${escapeHtml(reg.fullName)}</span></p>
    <p><span>Student ID</span><span>${escapeHtml(reg.studentId)}</span></p>
    <p><span>Email</span><span>${escapeHtml(reg.email)}</span></p>
    <p><span>Phone</span><span>${escapeHtml(reg.phone)}</span></p>
    <p><span>Department</span><span>${escapeHtml(reg.department)}</span></p>
    <p><span>Reg. ID</span><span>${shortRef(reg.id)}</span></p>
  `;

  slipModal.classList.add("open");
  slipModal.setAttribute("aria-hidden", "false");
}

function closeSlipModal() {
  slipModal.classList.remove("open");
  slipModal.setAttribute("aria-hidden", "true");
}

/* ===== Toast ===== */
let toastTimer;
function showToast(title, msg) {
  document.getElementById("toastTitle").textContent = title;
  document.getElementById("toastMsg").textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4500);
}

/* ===== Theme ===== */
function initTheme() {
  const saved = localStorage.getItem("campusEvents_theme");
  if (saved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

document.getElementById("themeToggle").addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  if (isLight) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("campusEvents_theme", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("campusEvents_theme", "light");
  }
});

/* ===== Navigation ===== */
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const section = btn.dataset.section;
    document.getElementById("eventsSection").classList.toggle("active", section === "events");
    document.getElementById("registeredSection").classList.toggle("active", section === "registered");
    if (section === "registered") renderRegistered();
    else loadEvents().then(renderEvents).catch(console.error);
  });
});

document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelector('.nav-btn[data-section="events"]').click();
  });
});

/* ===== Filters ===== */
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderEvents();
  });
});

/* ===== Modal close handlers ===== */
document.getElementById("modalClose").addEventListener("click", closeRegModal);
document.getElementById("cancelReg").addEventListener("click", closeRegModal);
document.getElementById("slipClose").addEventListener("click", closeSlipModal);

regModal.querySelector(".modal-backdrop").addEventListener("click", closeRegModal);
slipModal.querySelector(".modal-backdrop").addEventListener("click", closeSlipModal);

document.getElementById("toastClose").addEventListener("click", () => {
  toast.classList.remove("show");
});

document.getElementById("printSlip").addEventListener("click", () => {
  window.print();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeRegModal();
    closeSlipModal();
  }
});

/* ===== Init ===== */
function showLoadError() {
  eventsGrid.innerHTML = `
    <div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">⚠️</div>
      <h3>Couldn't load events</h3>
      <p>Check your internet connection and that the Supabase SQL has been run.</p>
      <button class="btn btn-primary" id="retryLoad">Retry</button>
    </div>`;
  document.getElementById("retryLoad").addEventListener("click", init);
}

async function init() {
  eventsGrid.innerHTML = `<div class="loading-state" style="grid-column:1/-1"><span class="btn-loader"></span><p>Loading events…</p></div>`;
  try {
    await ensureSession();
    await refreshData();
  } catch (err) {
    console.error(err);
    showLoadError();
  }
}

initTheme();
init();

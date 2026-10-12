'use strict';

/* =============================================================
   Easy Approve – Approval Management System (interactive prototype)
   -------------------------------------------------------------
   • Vanilla ES6+, no frameworks, no backend.
   • All data lives in memory and is persisted to localStorage.
   • The role switcher only changes what the UI shows. It is a
     demo convenience, NOT an access-control or security layer.

   Sections
     1. Constants & configuration
     2. Utilities
     3. State: seed, load, save, selectors
     4. Workflow mutations (create, approve, reject, …)
     5. UI primitives (buttons, badges, fields, toasts, modal, menu)
     6. Router & app shell
     7. Pages
     8. Event wiring
   ============================================================= */

/* =============================================================
   1. CONSTANTS & CONFIGURATION
   ============================================================= */
const STORAGE_KEY = 'easyApprove.state.v1';
const SCHEMA_VERSION = 1;
const PAGE_SIZE = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'png', 'jpg', 'jpeg'];

const STATUS = Object.freeze({
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLARIFICATION: 'Clarification Requested',
  DELEGATED: 'Delegated',
});
const STATUS_LIST = Object.values(STATUS);
/** Statuses on which an approver may still take a decision. */
const ACTIONABLE_STATUSES = [STATUS.PENDING, STATUS.DELEGATED, STATUS.CLARIFICATION];
/** Statuses that count as "pending approval". */
const OPEN_STATUSES = [STATUS.PENDING, STATUS.DELEGATED];

const STATUS_STYLE = {
  [STATUS.PENDING]: { badge: 'bg-amber-50 text-amber-700 ring-amber-600/25', bar: 'bg-amber-400', icon: 'clock' },
  [STATUS.APPROVED]: { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/25', bar: 'bg-emerald-500', icon: 'circle-check' },
  [STATUS.REJECTED]: { badge: 'bg-rose-50 text-rose-700 ring-rose-600/25', bar: 'bg-rose-500', icon: 'circle-x' },
  [STATUS.CLARIFICATION]: { badge: 'bg-sky-50 text-sky-700 ring-sky-600/25', bar: 'bg-sky-500', icon: 'message-circle-question' },
  [STATUS.DELEGATED]: { badge: 'bg-violet-50 text-violet-700 ring-violet-600/25', bar: 'bg-violet-500', icon: 'forward' },
};

const ALL_ROLES = ['Requester', 'Approver', 'Admin'];
/** Each demo role is played by one seeded persona. */
const ROLES = {
  Requester: { personaId: 'u1', description: 'Create requests and track their progress.' },
  Approver: { personaId: 'u5', description: 'Review, decide on and delegate routed requests.' },
  Admin: { personaId: 'u8', description: 'Oversee all requests, users and recipient groups.' },
};

const NAV_ITEMS = [
  { route: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', section: 'Workspace', roles: ALL_ROLES },
  { route: 'create', label: 'Create Request', icon: 'file-plus', section: 'Workspace', roles: ['Requester', 'Admin'] },
  { route: 'my-requests', label: 'My Requests', icon: 'folder-open', section: 'Workspace', roles: ['Requester', 'Admin'] },
  { route: 'approvals', label: 'Approval List', icon: 'list-checks', section: 'Approvals', roles: ['Approver', 'Admin'], badge: () => actionableRequests().length },
  { route: 'clarifications', label: 'Clarifications', icon: 'messages-square', section: 'Approvals', roles: ALL_ROLES, badge: () => clarificationsNeedingMe().length },
  { route: 'delegation', label: 'Delegation', icon: 'forward', section: 'Approvals', roles: ['Approver', 'Admin'] },
  { route: 'notifications', label: 'Notifications', icon: 'bell', section: 'Updates', roles: ALL_ROLES, badge: () => unreadCount() },
  { route: 'admin', label: 'Groups & Users', icon: 'users', section: 'Administration', roles: ['Admin'] },
];

const PAGES = {
  dashboard: { title: 'Dashboard', subtitle: () => `Overview of ${scopeLabel()}`, roles: ALL_ROLES, render: renderDashboard },
  create: { title: 'Create Approval Request', subtitle: () => 'Submit a new request to a recipient group', roles: ['Requester', 'Admin'], render: renderCreate },
  'my-requests': { title: 'My Requests', subtitle: () => 'Requests you have submitted', roles: ['Requester', 'Admin'], render: renderMyRequests },
  approvals: { title: 'Approval List', subtitle: () => 'Review and act on requests routed to your groups', roles: ['Approver', 'Admin'], render: renderApprovals },
  request: { title: 'Request Details', subtitle: () => 'Request information, conversation and approval history', roles: ALL_ROLES, render: renderRequestDetails },
  clarifications: { title: 'Clarifications', subtitle: () => 'Questions from approvers and answers from requesters', roles: ALL_ROLES, render: renderClarifications },
  delegation: { title: 'Approval Delegation', subtitle: () => 'Hand over an approval to another approver for a period', roles: ['Approver', 'Admin'], render: renderDelegation },
  notifications: { title: 'Notifications', subtitle: () => 'Updates on requests that involve you', roles: ALL_ROLES, render: renderNotifications },
  admin: { title: 'Group & User Management', subtitle: () => 'Manage users, recipient groups and approvers', roles: ['Admin'], render: renderAdmin },
};

const NOTIF_TYPES = {
  new: { label: 'New request', icon: 'inbox', tone: 'bg-indigo-100 text-indigo-600' },
  approved: { label: 'Approved', icon: 'circle-check', tone: 'bg-emerald-100 text-emerald-600' },
  rejected: { label: 'Rejected', icon: 'circle-x', tone: 'bg-rose-100 text-rose-600' },
  clarification: { label: 'Clarification', icon: 'message-circle-question', tone: 'bg-sky-100 text-sky-600' },
  response: { label: 'Response', icon: 'reply', tone: 'bg-sky-100 text-sky-600' },
  delegated: { label: 'Delegated', icon: 'forward', tone: 'bg-violet-100 text-violet-600' },
  comment: { label: 'Comment', icon: 'message-square', tone: 'bg-slate-100 text-slate-600' },
  system: { label: 'System', icon: 'settings', tone: 'bg-slate-100 text-slate-600' },
};

const HISTORY_STYLE = {
  Submitted: { icon: 'send', tone: 'bg-indigo-100 text-indigo-600' },
  Viewed: { icon: 'eye', tone: 'bg-slate-100 text-slate-500' },
  Approved: { icon: 'check', tone: 'bg-emerald-100 text-emerald-600' },
  Rejected: { icon: 'x', tone: 'bg-rose-100 text-rose-600' },
  'Clarification Requested': { icon: 'message-circle-question', tone: 'bg-sky-100 text-sky-600' },
  'Clarification Response': { icon: 'reply', tone: 'bg-sky-100 text-sky-600' },
  Delegated: { icon: 'forward', tone: 'bg-violet-100 text-violet-600' },
};

const TONES = {
  indigo: 'bg-indigo-50 text-indigo-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  violet: 'bg-violet-50 text-violet-600',
};

/** Shared Tailwind class recipes. */
const UI = {
  card: 'rounded-xl bg-white shadow-sm ring-1 ring-slate-200',
  input: 'block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 disabled:bg-slate-50 disabled:text-slate-500 read-only:bg-slate-50',
  select: 'block w-full rounded-lg border-0 bg-white py-2.5 pl-3 pr-8 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600',
  label: 'mb-1.5 block text-sm font-medium text-slate-700',
  hint: 'mt-1.5 text-xs text-slate-500',
  iconBtn: 'inline-grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-indigo-600',
};

const BTN_TONES = {
  primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-indigo-600',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500 focus-visible:outline-emerald-600',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-500 focus-visible:outline-rose-600',
  secondary: 'bg-white text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-indigo-600',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-indigo-600',
  link: 'text-indigo-600 hover:text-indigo-500 focus-visible:outline-indigo-600 !px-0',
};
function btnClass(tone = 'primary', size = 'md') {
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-4 py-2.5 text-sm' };
  return `inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${BTN_TONES[tone]}`;
}

/* =============================================================
   2. UTILITIES
   ============================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any user- or data-provided value before putting it in HTML. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nowISO = () => new Date().toISOString();

/** ISO timestamp `days` ago at a given hour, never in the future. */
function daysAgoISO(days, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() > Date.now()) {
    // Keep same-day ordering intact while staying in the past.
    return new Date(Date.now() - (24 - hour) * 4 * 60000 - (60 - minute) * 1000).toISOString();
  }
  return d.toISOString();
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)}, ${timeFmt.format(new Date(iso))}` : '—');

function timeAgo(iso) {
  const sec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr${hr > 1 ? 's' : ''} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day > 1 ? 's' : ''} ago`;
  return fmtDate(iso);
}

/** YYYY-MM-DD in local time, for <input type="date">. */
function toDateInput(date) {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const addDays = (date, n) => new Date(new Date(date).getTime() + n * 86400000);

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const fileExt = (name) => (String(name).split('.').pop() || '').toLowerCase();
function fileIcon(name) {
  const ext = fileExt(name);
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'file-spreadsheet';
  if (['png', 'jpg', 'jpeg'].includes(ext)) return 'file-image';
  if (['ppt', 'pptx'].includes(ext)) return 'presentation';
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return 'file-text';
  return 'file';
}

const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const AVATAR_TONES = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-teal-100 text-teal-700'];
function avatarTone(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
const pluralize = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
const byDesc = (key) => (a, b) => (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0);
const byAsc = (key) => (a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0);
const requestNumber = (id) => parseInt(String(id).split('-')[1], 10) || 0;

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

/* =============================================================
   3. STATE
   ============================================================= */
let state = null;
let storageAvailable = true;
/** Non-persisted UI state. */
const ui = {
  route: { page: 'dashboard', param: null, query: new URLSearchParams() },
  flash: null,
  adminTab: 'users',
  userSearch: '',
  notifFilter: 'all',
  notifType: '',
  clarTab: 'action',
};
const tableStates = {};
let pendingAttachment = null;

/* ---------- Seed data ---------- */
const SEED_USERS = [
  { id: 'u1', name: 'Priya Sharma', email: 'priya.sharma@easyapprove.demo', role: 'Requester', department: 'Finance' },
  { id: 'u2', name: 'Arjun Menon', email: 'arjun.menon@easyapprove.demo', role: 'Requester', department: 'Operations' },
  { id: 'u3', name: 'Kavitha Raman', email: 'kavitha.raman@easyapprove.demo', role: 'Requester', department: 'Nursing' },
  { id: 'u4', name: 'Daniel Thomas', email: 'daniel.thomas@easyapprove.demo', role: 'Requester', department: 'Information Technology' },
  { id: 'u5', name: 'Rajesh Kumar', email: 'rajesh.kumar@easyapprove.demo', role: 'Approver', department: 'SRMT Office' },
  { id: 'u6', name: 'Meena Iyer', email: 'meena.iyer@easyapprove.demo', role: 'Approver', department: 'Hospital Administration' },
  { id: 'u7', name: 'Suresh Babu', email: 'suresh.babu@easyapprove.demo', role: 'Approver', department: "President's Office" },
  { id: 'u9', name: 'Farah Khan', email: 'farah.khan@easyapprove.demo', role: 'Approver', department: 'Federal Affairs' },
  { id: 'u8', name: 'Anita Desai', email: 'anita.desai@easyapprove.demo', role: 'Admin', department: 'IT Administration' },
];

const SEED_GROUPS = [
  { id: 'g1', name: 'SRMT', description: 'Senior Resource Management Team – budgets, staffing and operations.', approverIds: ['u5', 'u9'] },
  { id: 'g2', name: 'Federal', description: 'Federal affairs, grants and regulatory submissions.', approverIds: ['u5', 'u9'] },
  { id: 'g3', name: 'Hospital', description: 'Hospital administration – clinical equipment and services.', approverIds: ['u5', 'u6'] },
  { id: 'g4', name: 'President Office', description: 'Executive approvals, communications and sponsorships.', approverIds: ['u7', 'u6'] },
];

/**
 * Seed requests. `flow` replays real workflow actions so that history,
 * notifications and statuses are produced by the same code the UI uses.
 * Each step: [action, actorId, daysAgo, text, extra]
 */
const SEED_REQUESTS = [
  { t: 'Annual IT hardware refresh budget', d: 'Replace 120 end-of-life laptops and 14 network switches as part of the FY27 refresh cycle. Quotes from three vendors attached.', by: 'u4', g: 'g1', ago: 28, att: ['IT_Hardware_Refresh_FY27.xlsx', 412], flow: [['approve', 'u5', 26, 'Approved within the FY27 capital plan. Please stage procurement in two batches.']] },
  { t: 'Travel approval – Federal compliance summit', d: 'Attendance for two finance staff at the three-day federal compliance summit in Delhi, including travel and accommodation.', by: 'u1', g: 'g2', ago: 25, att: ['Summit_Itinerary.pdf', 188], flow: [['approve', 'u5', 24, 'Approved. Economy fare and per-diem as per policy.']] },
  { t: 'Q4 marketing campaign spend', d: 'Digital and print campaign to promote the new outpatient wing, running for eight weeks across Q4.', by: 'u2', g: 'g4', ago: 20, att: ['Q4_Campaign_Plan.pptx', 2380], flow: [['reject', 'u7', 18, 'Campaign overlaps with the annual report launch. Please resubmit with a revised timeline for Q1.']] },
  { t: 'Laboratory reagent bulk purchase', d: 'Six-month bulk order of haematology and biochemistry reagents to secure a 12% volume discount.', by: 'u3', g: 'g3', ago: 18, att: ['Reagent_Quotes.pdf', 640], flow: [['comment', 'u5', 17, 'Can we confirm cold-chain storage capacity for the full order?'], ['comment', 'u3', 17, 'Confirmed with the lab manager – capacity is available.'], ['approve', 'u5', 16, 'Approved.']] },
  { t: 'Office relocation plan – Block C', d: 'Move the operations team from Block A to the renovated Block C, including furniture and IT cabling.', by: 'u2', g: 'g1', ago: 15, att: ['Block_C_Floorplan.pdf', 1450], flow: [['approve', 'u5', 13, 'Approved. Coordinate with facilities for a weekend move.']] },
  { t: 'Overtime policy exception – December', d: 'Temporary exception to the overtime cap for ward nursing staff to cover the December holiday roster.', by: 'u3', g: 'g3', ago: 12, flow: [['clarify', 'u5', 11, 'How many staff are affected, and for how many weeks?'], ['respond', 'u3', 11, '14 nursing staff for three weeks during the holiday roster.'], ['reject', 'u5', 10, 'Exceeds the Q4 overtime budget. Please explore agency staffing instead.']] },
  { t: 'Press release approval – annual report', d: 'Approval of the press release announcing the publication of the annual report and key highlights.', by: 'u2', g: 'g4', ago: 10, att: ['Annual_Report_Press_Release.docx', 96], flow: [['approve', 'u7', 9, 'Approved for release on the scheduled date.']] },
  { t: 'Petty cash limit increase', d: 'Increase the departmental petty cash float from ₹25,000 to ₹50,000 to cover frequent small purchases.', by: 'u1', g: 'g1', ago: 9, flow: [['reject', 'u5', 8, 'Current limit is sufficient based on the last two quarters of usage.']] },
  { t: 'Data sharing agreement – state registry', d: 'Sign the data sharing agreement allowing anonymised outcome data to be submitted to the state disease registry.', by: 'u4', g: 'g2', ago: 8, att: ['DSA_Draft_v3.pdf', 520], flow: [['clarify', 'u5', 6, 'Has the legal team reviewed clause 7 on data retention?']] },
  { t: 'Research ethics committee funding', d: 'Annual operating budget for the research ethics committee, including external reviewer honoraria.', by: 'u4', g: 'g2', ago: 7, att: ['REC_Budget.xlsx', 74] },
  { t: 'Software license renewal – EHR platform', d: 'Three-year renewal of the electronic health record platform licence with an updated support SLA.', by: 'u4', g: 'g3', ago: 6, att: ['EHR_License_Quote.pdf', 310], flow: [['delegate', 'u5', 5, 'Meena owns the EHR vendor relationship and contract history.', { toId: 'u6', startOffset: -5, endOffset: 9 }]] },
  { t: 'Federal grant application co-signature', d: 'Co-signature for the federal infrastructure grant application due at the end of the month.', by: 'u1', g: 'g2', ago: 5, att: ['Grant_Application_Draft.pdf', 905], flow: [['clarify', 'u5', 2, 'Please attach the detailed budget breakdown and confirm the source of matching funds.']] },
  { t: 'Conference sponsorship – HealthTech 2026', d: 'Silver-tier sponsorship of the HealthTech 2026 conference, including a booth and one speaking slot.', by: 'u1', g: 'g4', ago: 4, att: ['Sponsorship_Tiers.pdf', 233] },
  { t: 'New infusion pumps for ICU', d: 'Purchase 20 smart infusion pumps for the ICU to replace units that are no longer supported by the manufacturer.', by: 'u3', g: 'g3', ago: 3, att: ['Infusion_Pump_Comparison.xlsx', 128], flow: [['comment', 'u5', 2, 'Reviewing the vendor comparison – will decide by Friday.']] },
  { t: 'Executive visit logistics', d: 'Logistics and hospitality budget for the visiting board delegation next month.', by: 'u1', g: 'g4', ago: 3, flow: [['delegate', 'u7', 2, 'Travelling this week; Meena will cover executive approvals.', { toId: 'u6', startOffset: -2, endOffset: 5 }]] },
  { t: 'Contractor onboarding – facilities', d: 'Onboard four maintenance contractors for the HVAC upgrade project, including site access badges.', by: 'u2', g: 'g1', ago: 2, att: ['Contractor_List.xlsx', 41] },
  { t: 'Vendor contract extension – catering', d: 'Extend the staff cafeteria catering contract by 12 months on current terms while a new tender is prepared.', by: 'u1', g: 'g1', ago: 1, att: ['Catering_Contract_Ext.pdf', 214] },
  { t: 'Training budget for nurse residency', d: 'Budget for the 2027 nurse residency programme covering 30 graduates, including simulation lab time.', by: 'u3', g: 'g3', ago: 0, att: ['Residency_Budget.xlsx', 66] },
];

function mimeFor(name) {
  const map = { pdf: 'application/pdf', xlsx: 'application/vnd.ms-excel', xls: 'application/vnd.ms-excel', docx: 'application/msword', doc: 'application/msword', pptx: 'application/vnd.ms-powerpoint', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', csv: 'text/csv', txt: 'text/plain' };
  return map[fileExt(name)] || 'application/octet-stream';
}

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    role: 'Requester',
    seq: 1000,
    users: structuredClone(SEED_USERS),
    groups: structuredClone(SEED_GROUPS),
    requests: [],
    notifications: [],
    delegations: [],
  };
}

/** Build a fresh demo dataset by replaying the seed through the workflow. */
function seedData() {
  state = emptyState();
  SEED_REQUESTS.forEach((s, i) => {
    const at = daysAgoISO(s.ago, 8 + (i % 4), (i * 7) % 60);
    const attachment = s.att ? { name: s.att[0], size: s.att[1] * 1024, type: mimeFor(s.att[0]) } : null;
    const req = createRequest({ title: s.t, description: s.d, groupId: s.g, attachment }, { actorId: s.by, at });
    (s.flow || []).forEach(([action, actorId, ago, text, extra = {}], step) => {
      const ctx = { actorId, at: daysAgoISO(ago, 12 + step, 15 + step * 5) };
      if (action === 'approve') approveRequest(req.id, text, ctx);
      if (action === 'reject') rejectRequest(req.id, text, ctx);
      if (action === 'clarify') requestClarification(req.id, text, ctx);
      if (action === 'respond') respondClarification(req.id, text, ctx);
      if (action === 'comment') addComment(req.id, text, ctx);
      if (action === 'delegate') {
        delegateRequest({
          requestId: req.id,
          toId: extra.toId,
          startDate: toDateInput(addDays(new Date(), extra.startOffset)),
          endDate: toDateInput(addDays(new Date(), extra.endOffset)),
          reason: text,
        }, ctx);
      }
    });
  });
  // Older notifications start as read so the demo has a realistic unread mix.
  const cutoff = Date.now() - 2.5 * 86400000;
  state.notifications.forEach((n) => { n.read = new Date(n.at).getTime() < cutoff; });
  return state;
}

function isValidState(s) {
  return s && s.version === SCHEMA_VERSION && ['users', 'groups', 'requests', 'notifications', 'delegations'].every((k) => Array.isArray(s[k])) && ROLES[s.role];
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) { state = parsed; return; }
    }
  } catch (err) {
    storageAvailable = false;
    console.warn('Easy Approve: localStorage unavailable, running in memory only.', err);
  }
  seedData();
  saveState();
}

function saveState() {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    storageAvailable = false;
    toast('Changes can’t be saved in this browser (storage unavailable).', 'warning');
  }
}

/* ---------- Selectors ---------- */
const getUser = (id) => state.users.find((u) => u.id === id);
const getGroup = (id) => state.groups.find((g) => g.id === id);
const getRequest = (id) => state.requests.find((r) => r.id === id);
const userName = (id) => getUser(id)?.name ?? 'Unknown user';
const groupName = (id) => getGroup(id)?.name ?? 'Unknown group';
const adminIds = () => state.users.filter((u) => u.role === 'Admin').map((u) => u.id);
const approverUsers = () => state.users.filter((u) => u.role === 'Approver');

function currentUser() {
  return getUser(ROLES[state.role].personaId) || state.users.find((u) => u.role === state.role);
}

function isVisible(req, user = currentUser()) {
  if (state.role === 'Admin') return true;
  if (req.requesterId === user.id) return true;
  if (state.role === 'Requester') return false;
  const group = getGroup(req.groupId);
  return req.approverId === user.id
    || Boolean(group && group.approverIds.includes(user.id))
    || state.delegations.some((d) => d.requestId === req.id && (d.fromId === user.id || d.toId === user.id));
}
const visibleRequests = () => state.requests.filter((r) => isVisible(r));
const myRequests = () => state.requests.filter((r) => r.requesterId === currentUser().id);

/** Demo-only permission check: decides which buttons are shown, nothing more. */
function canActOn(req) {
  if (!req || !ACTIONABLE_STATUSES.includes(req.status)) return false;
  if (state.role === 'Admin') return true;
  return state.role === 'Approver' && req.approverId === currentUser().id;
}
const canRespond = (req) => req.status === STATUS.CLARIFICATION && req.requesterId === currentUser().id;
const actionableRequests = () => state.requests.filter(canActOn);

function clarificationsNeedingMe() {
  if (state.role === 'Requester') return myRequests().filter(canRespond);
  // For approvers/admins: a requester has replied and the approver now needs to act.
  return actionableRequests().filter((r) => {
    const last = r.clarifications[r.clarifications.length - 1];
    return last && last.role === 'requester' && r.status !== STATUS.CLARIFICATION;
  });
}

const myNotifications = () => state.notifications.filter((n) => n.userId === currentUser().id).sort(byDesc('at'));
const unreadCount = () => myNotifications().filter((n) => !n.read).length;

function scopeLabel() {
  if (state.role === 'Admin') return 'all requests in the organisation';
  if (state.role === 'Approver') return 'requests routed to your groups';
  return 'your requests';
}
const primaryListRoute = () => (state.role === 'Requester' ? 'my-requests' : 'approvals');

/* =============================================================
   4. WORKFLOW MUTATIONS
   These functions only change `state`. Callers persist and
   re-render via commit(). `ctx` lets the seeder replay history.
   ============================================================= */
function withCtx(ctx = {}) {
  return { actorId: ctx.actorId || currentUser().id, at: ctx.at || nowISO() };
}

function nextRequestId() {
  const maxExisting = state.requests.reduce((m, r) => Math.max(m, requestNumber(r.id)), 0);
  state.seq = Math.max(state.seq, maxExisting) + 1;
  return `EA-${state.seq}`;
}

function addHistory(req, action, ctx, note = '') {
  req.history.push({ id: uid('h'), action, actorId: ctx.actorId, at: ctx.at, note, status: req.status });
  req.updatedAt = ctx.at;
}

function notify(userIds, type, req, title, message, at) {
  [...new Set(userIds)].filter(Boolean).forEach((userId) => {
    state.notifications.push({ id: uid('n'), userId, type, requestId: req ? req.id : null, title, message, at, read: false });
  });
}

function assertActionable(req) {
  if (!req) throw new Error('Request not found.');
  if (!ACTIONABLE_STATUSES.includes(req.status)) throw new Error(`${req.id} is already ${req.status.toLowerCase()}.`);
}

function createRequest(data, ctx) {
  const c = withCtx(ctx);
  const group = getGroup(data.groupId);
  if (!group) throw new Error('Please choose a recipient group.');
  if (!group.approverIds.length) throw new Error(`${group.name} has no approvers assigned yet.`);
  const req = {
    id: nextRequestId(),
    title: data.title.trim(),
    description: data.description.trim(),
    groupId: group.id,
    requesterId: c.actorId,
    approverId: group.approverIds[0],
    status: STATUS.PENDING,
    submittedAt: c.at,
    updatedAt: c.at,
    attachment: data.attachment || null,
    comments: [],
    clarifications: [],
    history: [],
    viewedBy: [],
  };
  addHistory(req, 'Submitted', c, `Submitted to ${group.name} and routed to ${userName(req.approverId)}.`);
  state.requests.push(req);
  const requester = userName(c.actorId);
  notify(group.approverIds, 'new', req, `New request ${req.id}`, `${requester} submitted “${req.title}” to ${group.name}.`, c.at);
  notify(adminIds().filter((id) => id !== c.actorId && !group.approverIds.includes(id)), 'new', req, `New request ${req.id}`, `${requester} submitted “${req.title}” to ${group.name}.`, c.at);
  return req;
}

function approveRequest(id, comment, ctx) {
  const c = withCtx(ctx);
  const req = getRequest(id);
  assertActionable(req);
  req.status = STATUS.APPROVED;
  req.decidedAt = c.at;
  req.decidedBy = c.actorId;
  addHistory(req, 'Approved', c, comment || '');
  notify([req.requesterId], 'approved', req, `${req.id} approved`, `${userName(c.actorId)} approved “${req.title}”.${comment ? ` Note: ${comment}` : ''}`, c.at);
  return req;
}

function rejectRequest(id, reason, ctx) {
  const c = withCtx(ctx);
  const req = getRequest(id);
  assertActionable(req);
  if (!reason || reason.trim().length < 10) throw new Error('A rejection reason of at least 10 characters is required.');
  req.status = STATUS.REJECTED;
  req.rejectionReason = reason.trim();
  req.decidedAt = c.at;
  req.decidedBy = c.actorId;
  addHistory(req, 'Rejected', c, reason.trim());
  notify([req.requesterId], 'rejected', req, `${req.id} rejected`, `${userName(c.actorId)} rejected “${req.title}”. Reason: ${reason.trim()}`, c.at);
  return req;
}

function requestClarification(id, question, ctx) {
  const c = withCtx(ctx);
  const req = getRequest(id);
  assertActionable(req);
  if (!question || !question.trim()) throw new Error('Please enter your question.');
  if (req.status !== STATUS.CLARIFICATION) req.statusBeforeClarification = req.status;
  req.status = STATUS.CLARIFICATION;
  req.clarifications.push({ id: uid('c'), authorId: c.actorId, role: 'approver', text: question.trim(), at: c.at });
  addHistory(req, 'Clarification Requested', c, question.trim());
  notify([req.requesterId], 'clarification', req, `Clarification needed on ${req.id}`, `${userName(c.actorId)} asked: “${question.trim()}”`, c.at);
  return req;
}

function respondClarification(id, text, ctx) {
  const c = withCtx(ctx);
  const req = getRequest(id);
  if (!req) throw new Error('Request not found.');
  if (req.status !== STATUS.CLARIFICATION) throw new Error(`${req.id} is not waiting for clarification.`);
  if (!text || !text.trim()) throw new Error('Please enter a response.');
  req.clarifications.push({ id: uid('c'), authorId: c.actorId, role: 'requester', text: text.trim(), at: c.at });
  req.status = req.statusBeforeClarification || STATUS.PENDING;
  delete req.statusBeforeClarification;
  addHistory(req, 'Clarification Response', c, text.trim());
  const askers = req.clarifications.filter((m) => m.role === 'approver').map((m) => m.authorId);
  notify([req.approverId, askers[askers.length - 1]].filter((uidv) => uidv !== c.actorId), 'response', req, `Response on ${req.id}`, `${userName(c.actorId)} replied: “${text.trim()}”`, c.at);
  return req;
}

function delegateRequest({ requestId, toId, startDate, endDate, reason }, ctx) {
  const c = withCtx(ctx);
  const req = getRequest(requestId);
  assertActionable(req);
  const fromId = req.approverId;
  if (!getUser(toId)) throw new Error('Please choose a delegate.');
  if (toId === fromId) throw new Error('The delegate must be different from the current approver.');
  req.approverId = toId;
  req.delegatedFromId = fromId;
  if (req.status === STATUS.CLARIFICATION) req.statusBeforeClarification = STATUS.DELEGATED;
  else req.status = STATUS.DELEGATED;
  state.delegations.push({ id: uid('d'), requestId, fromId, toId, startDate, endDate, reason: reason.trim(), at: c.at, byId: c.actorId });
  const by = c.actorId === fromId ? '' : ` (on behalf of ${userName(fromId)})`;
  addHistory(req, 'Delegated', c, `${userName(fromId)} → ${userName(toId)}${by}. Period ${fmtDate(startDate)} – ${fmtDate(endDate)}. Reason: ${reason.trim()}`);
  notify([toId], 'delegated', req, `${req.id} delegated to you`, `${userName(c.actorId)} delegated “${req.title}” to you until ${fmtDate(endDate)}.`, c.at);
  notify([req.requesterId], 'delegated', req, `${req.id} reassigned`, `Your request “${req.title}” is now with ${userName(toId)}.`, c.at);
  if (fromId !== c.actorId) notify([fromId], 'delegated', req, `${req.id} delegated`, `${userName(c.actorId)} delegated your approval of “${req.title}” to ${userName(toId)}.`, c.at);
  return req;
}

function addComment(id, text, ctx) {
  const c = withCtx(ctx);
  const req = getRequest(id);
  if (!req) throw new Error('Request not found.');
  if (!text || !text.trim()) throw new Error('Comment cannot be empty.');
  req.comments.push({ id: uid('m'), authorId: c.actorId, text: text.trim(), at: c.at });
  req.updatedAt = c.at;
  const recipients = [req.requesterId, req.approverId].filter((u) => u !== c.actorId);
  notify(recipients, 'comment', req, `New comment on ${req.id}`, `${userName(c.actorId)}: “${text.trim()}”`, c.at);
  return req;
}

function markViewed(req) {
  const me = currentUser();
  if (!canActOn(req) || req.approverId !== me.id || req.viewedBy.includes(me.id)) return false;
  req.viewedBy.push(me.id);
  addHistory(req, 'Viewed', withCtx(), 'Opened for review by the assigned approver.');
  return true;
}

function addUser({ name, email, role, department }) {
  const user = { id: uid('u'), name: name.trim(), email: email.trim().toLowerCase(), role, department: department.trim() };
  state.users.push(user);
  return user;
}

function createGroup({ name, description, approverIds }) {
  const group = { id: uid('g'), name: name.trim(), description: description.trim(), approverIds };
  state.groups.push(group);
  notify(approverIds, 'system', null, 'Added as approver', `You were added as an approver for the new ${group.name} group.`, nowISO());
  return group;
}

function setGroupApprovers(groupId, approverIds) {
  const group = getGroup(groupId);
  const added = approverIds.filter((id) => !group.approverIds.includes(id));
  group.approverIds = approverIds;
  notify(added, 'system', null, 'Added as approver', `You were added as an approver for ${group.name}.`, nowISO());
  return group;
}

function markNotificationRead(id) {
  const n = state.notifications.find((x) => x.id === id);
  if (n) n.read = true;
}
function markAllNotificationsRead() {
  myNotifications().forEach((n) => { n.read = true; });
}

/* =============================================================
   5. UI PRIMITIVES
   ============================================================= */
function statusBadge(status, size = 'md') {
  const s = STATUS_STYLE[status] || STATUS_STYLE[STATUS.PENDING];
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return `<span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset ${pad} ${s.badge}"><span class="size-1.5 rounded-full ${s.bar}" aria-hidden="true"></span>${esc(status)}</span>`;
}

function avatarHTML(user, size = 'md') {
  const sizes = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' };
  const u = user || { id: '?', name: '?' };
  return `<span class="inline-grid shrink-0 place-items-center rounded-full font-semibold ${sizes[size]} ${avatarTone(u.id)}" aria-hidden="true">${esc(initials(u.name))}</span>`;
}

function personHTML(userId, sub = '') {
  const u = getUser(userId);
  return `<span class="flex min-w-0 items-center gap-2.5">${avatarHTML(u, 'xs')}<span class="min-w-0"><span class="block truncate text-slate-800">${esc(u ? u.name : 'Unknown')}</span>${sub ? `<span class="block truncate text-xs text-slate-500">${esc(sub)}</span>` : ''}</span></span>`;
}

function cardHeader(title, { icon = '', subtitle = '', action = '', id = '' } = {}) {
  return `<div class="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
    <div class="min-w-0">
      <h2 ${id ? `id="${id}"` : ''} class="flex items-center gap-2 text-base font-semibold text-slate-900">${icon ? `<i data-lucide="${icon}" class="size-4 text-slate-400"></i>` : ''}${esc(title)}</h2>
      ${subtitle ? `<p class="mt-0.5 text-sm text-slate-500">${subtitle}</p>` : ''}
    </div>${action}</div>`;
}

function emptyStateHTML({ icon = 'inbox', title, text = '', action = '' }) {
  return `<div class="flex flex-col items-center justify-center px-6 py-12 text-center">
    <span class="grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400"><i data-lucide="${icon}" class="size-6"></i></span>
    <p class="mt-4 text-sm font-semibold text-slate-900">${esc(title)}</p>
    ${text ? `<p class="mt-1 max-w-sm text-sm text-slate-500">${esc(text)}</p>` : ''}
    ${action ? `<div class="mt-4">${action}</div>` : ''}
  </div>`;
}

function alertHTML(tone, title, message = '', { dismissible = true } = {}) {
  const tones = {
    success: ['bg-emerald-50 text-emerald-800 ring-emerald-200', 'circle-check'],
    error: ['bg-rose-50 text-rose-800 ring-rose-200', 'circle-alert'],
    warning: ['bg-amber-50 text-amber-800 ring-amber-200', 'triangle-alert'],
    info: ['bg-sky-50 text-sky-800 ring-sky-200', 'info'],
  };
  const [cls, icon] = tones[tone] || tones.info;
  return `<div class="mb-5 flex items-start gap-3 rounded-xl p-4 ring-1 ${cls}" role="${tone === 'error' ? 'alert' : 'status'}">
    <i data-lucide="${icon}" class="mt-0.5 size-5 shrink-0"></i>
    <div class="min-w-0 flex-1 text-sm"><p class="font-semibold">${esc(title)}</p>${message ? `<p class="mt-0.5 opacity-90">${message}</p>` : ''}</div>
    ${dismissible ? '<button type="button" class="rounded p-0.5 opacity-70 hover:opacity-100" data-action="dismiss-alert" aria-label="Dismiss message"><i data-lucide="x" class="size-4"></i></button>' : ''}
  </div>`;
}

/** One-time message shown at the top of the next render of a page. */
function setFlash(page, tone, title, message = '') { ui.flash = { page, tone, title, message }; }
function flashHTML(page) {
  if (!ui.flash || ui.flash.page !== page) return '';
  const f = ui.flash;
  ui.flash = null;
  return alertHTML(f.tone, f.title, f.message);
}

/* ---------- Form fields ---------- */
function fieldWrap({ id, name, label, required, hint, control, counter }) {
  const describedBy = [hint ? `${id}-hint` : '', `${id}-error`].filter(Boolean).join(' ');
  return `<div>
    <div class="flex items-baseline justify-between gap-2">
      <label for="${id}" class="${UI.label}">${esc(label)}${required ? ' <span class="text-rose-600" aria-hidden="true">*</span>' : ''}</label>
      ${counter ? `<span class="text-xs text-slate-400" id="${id}-counter" aria-hidden="true"></span>` : ''}
    </div>
    ${control(describedBy)}
    ${hint ? `<p id="${id}-hint" class="${UI.hint}">${hint}</p>` : ''}
    <p id="${id}-error" class="field-error" data-error-for="${name}" hidden></p>
  </div>`;
}

function inputField({ id, name, label, type = 'text', value = '', required = false, placeholder = '', hint = '', maxlength, readonly = false, min, autocomplete = 'off' }) {
  return fieldWrap({
    id, name, label, required, hint, counter: Boolean(maxlength),
    control: (db) => `<input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required aria-required="true"' : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} ${maxlength ? `maxlength="${maxlength}" data-counter="${id}-counter"` : ''} ${readonly ? 'readonly' : ''} ${min ? `min="${min}"` : ''} autocomplete="${autocomplete}" aria-describedby="${db}" class="${UI.input}">`,
  });
}

function textareaField({ id, name, label, value = '', required = false, placeholder = '', hint = '', rows = 4, maxlength }) {
  return fieldWrap({
    id, name, label, required, hint, counter: Boolean(maxlength),
    control: (db) => `<textarea id="${id}" name="${name}" rows="${rows}" ${required ? 'required aria-required="true"' : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} ${maxlength ? `maxlength="${maxlength}" data-counter="${id}-counter"` : ''} aria-describedby="${db}" class="${UI.input} resize-y">${esc(value)}</textarea>`,
  });
}

function selectField({ id, name, label, options, value = '', required = false, hint = '', placeholder = 'Select…' }) {
  return fieldWrap({
    id, name, label, required, hint,
    control: (db) => `<select id="${id}" name="${name}" ${required ? 'required aria-required="true"' : ''} aria-describedby="${db}" class="${UI.select}">
      ${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}
      ${options.map((o) => `<option value="${esc(o.value)}" ${o.value === value ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`,
  });
}

function updateCounter(el) {
  const out = document.getElementById(el.dataset.counter);
  if (out) out.textContent = `${el.value.length}/${el.maxLength}`;
}

/* ---------- Validation ---------- */
const rules = {
  required: (label) => (v) => (v ? '' : `${label} is required.`),
  minLength: (n, label) => (v) => (!v || v.length >= n ? '' : `${label} must be at least ${n} characters.`),
  maxLength: (n, label) => (v) => (v.length <= n ? '' : `${label} must be ${n} characters or fewer.`),
  email: () => (v) => (!v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Enter a valid email address, e.g. name@company.com.'),
};

function setFieldError(form, name, message) {
  const field = form.elements[name];
  const errEl = form.querySelector(`[data-error-for="${name}"]`);
  if (field && field.classList) {
    field.classList.toggle('field-invalid', Boolean(message));
    field.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  if (errEl) {
    errEl.innerHTML = message ? `<i data-lucide="circle-alert" class="mt-px size-3.5 shrink-0"></i><span>${esc(message)}</span>` : '';
    errEl.hidden = !message;
  }
}

function clearErrors(form) {
  $$('[data-error-for]', form).forEach((el) => setFieldError(form, el.dataset.errorFor, ''));
}

/**
 * Validate a form against a map of { fieldName: [ruleFn, …] }.
 * `extra` may return additional errors computed from the whole form.
 * Returns an errors object (empty when valid) and focuses the first invalid field.
 */
function validateForm(form, ruleMap, extra) {
  const errors = {};
  Object.entries(ruleMap).forEach(([name, fns]) => {
    const raw = form.elements[name] ? form.elements[name].value : '';
    const value = typeof raw === 'string' ? raw.trim() : raw;
    for (const fn of fns) {
      const msg = fn(value, form);
      if (msg) { errors[name] = msg; break; }
    }
  });
  if (extra) Object.entries(extra(form) || {}).forEach(([k, v]) => { if (v && !errors[k]) errors[k] = v; });
  clearErrors(form);
  Object.entries(errors).forEach(([name, msg]) => setFieldError(form, name, msg));
  refreshIcons();
  const first = Object.keys(errors)[0];
  if (first) {
    const el = form.elements[first];
    const focusTarget = el && el.focus ? el : (el && el[0]) || form.querySelector(`[data-error-for="${first}"]`);
    if (focusTarget && focusTarget.focus) focusTarget.focus();
  }
  return errors;
}

/* ---------- Toasts ---------- */
const TOAST_TONES = {
  success: ['circle-check', 'text-emerald-500'],
  error: ['circle-x', 'text-rose-500'],
  warning: ['triangle-alert', 'text-amber-500'],
  info: ['info', 'text-sky-500'],
};
function toast(message, tone = 'success', timeout = 4200) {
  const root = $('#toastRoot');
  if (!root) return;
  const [icon, color] = TOAST_TONES[tone] || TOAST_TONES.info;
  const el = document.createElement('div');
  el.className = 'toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200';
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i data-lucide="${icon}" class="mt-0.5 size-5 shrink-0 ${color}"></i>
    <p class="flex-1 text-sm font-medium text-slate-800">${esc(message)}</p>
    <button type="button" class="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Dismiss notification"><i data-lucide="x" class="size-4"></i></button>`;
  const remove = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  };
  el.querySelector('button').addEventListener('click', remove);
  root.appendChild(el);
  refreshIcons();
  if (timeout) setTimeout(remove, timeout);
}

/* ---------- Modal ---------- */
let modalCtx = null;

/**
 * openModal({ title, description, body, confirmLabel, confirmTone, icon, iconTone, onConfirm, size })
 * onConfirm(form) may return false to keep the dialog open (e.g. on validation errors).
 */
function openModal(opts) {
  closeModal({ restoreFocus: false });
  const { title, description = '', body = '', confirmLabel = 'Confirm', confirmTone = 'primary', cancelLabel = 'Cancel', icon = '', iconTone = 'indigo', onConfirm, size = 'md' } = opts;
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };
  const root = $('#modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" data-modal-backdrop>
      <div class="modal-panel flex w-full ${widths[size]} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="modalTitle" ${description ? 'aria-describedby="modalDesc"' : ''}>
        <form id="modalForm" novalidate class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-start gap-4 px-6 pt-6">
            ${icon ? `<span class="grid size-10 shrink-0 place-items-center rounded-full ${TONES[iconTone] || TONES.indigo}"><i data-lucide="${icon}" class="size-5"></i></span>` : ''}
            <div class="min-w-0 flex-1">
              <h2 id="modalTitle" class="text-lg font-semibold text-slate-900">${esc(title)}</h2>
              ${description ? `<p id="modalDesc" class="mt-1 text-sm text-slate-600">${description}</p>` : ''}
            </div>
            <button type="button" class="${UI.iconBtn} -mr-2 -mt-1" data-modal-close aria-label="Close dialog"><i data-lucide="x" class="size-5"></i></button>
          </div>
          <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">${body}</div>
          <div class="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
            <button type="button" class="${btnClass('secondary')}" data-modal-close>${esc(cancelLabel)}</button>
            <button type="submit" class="${btnClass(confirmTone)}" data-modal-confirm>${esc(confirmLabel)}</button>
          </div>
        </form>
      </div>
    </div>`;
  modalCtx = { onConfirm, returnFocus: document.activeElement };
  document.body.classList.add('modal-open');

  const form = $('#modalForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = onConfirm ? onConfirm(form) : true;
    if (result !== false) closeModal();
  });
  root.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', () => closeModal()));
  root.querySelector('[data-modal-backdrop]').addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  refreshIcons();
  const first = form.querySelector('input:not([type=hidden]):not([readonly]), textarea, select') || form.querySelector('[data-modal-confirm]');
  if (first) first.focus();
}

function closeModal({ restoreFocus = true } = {}) {
  const root = $('#modalRoot');
  if (!root || !root.innerHTML) return;
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
  const ret = modalCtx && modalCtx.returnFocus;
  modalCtx = null;
  if (restoreFocus && ret && document.contains(ret)) ret.focus();
}

function trapModalFocus(e) {
  const panel = $('#modalRoot [role="dialog"]');
  if (!panel) return;
  const focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])', panel);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Convenience: confirmation dialog with no form fields. */
function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'primary', icon = 'info', iconTone = 'indigo', onConfirm }) {
  openModal({ title, description: message, confirmLabel, confirmTone: tone, icon, iconTone, onConfirm: () => { onConfirm(); } });
}

/* ---------- Three-dot action menu ---------- */
let menuTrigger = null;

function menuItemsFor(req) {
  const items = [{ action: 'view-request', label: 'View details', icon: 'eye' }];
  const isApproverView = state.role !== 'Requester';
  const can = canActOn(req);
  if (isApproverView || can) {
    const reason = can ? '' : (ACTIONABLE_STATUSES.includes(req.status) ? `Assigned to ${userName(req.approverId)}` : `Already ${req.status.toLowerCase()}`);
    items.push({ divider: true });
    items.push({ action: 'approve', label: 'Approve', icon: 'check', disabled: !can, reason });
    items.push({ action: 'reject', label: 'Reject', icon: 'x', disabled: !can, reason, danger: true });
    items.push({ action: 'clarify', label: 'Request clarification', icon: 'message-circle-question', disabled: !can, reason });
    items.push({ action: 'delegate', label: 'Delegate approval', icon: 'forward', disabled: !can, reason });
  }
  if (canRespond(req)) {
    items.push({ divider: true });
    items.push({ action: 'respond', label: 'Respond to clarification', icon: 'reply' });
  }
  return items;
}

function openActionMenu(trigger) {
  const menu = $('#actionMenu');
  const req = getRequest(trigger.dataset.id);
  if (!req) return;
  if (menuTrigger === trigger && !menu.hidden) { closeActionMenu(); return; }
  closeActionMenu(false);
  const items = menuItemsFor(req);
  menu.innerHTML = `<p class="truncate px-3.5 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">${esc(req.id)}</p>` + items.map((it) => (it.divider
    ? '<div class="my-1 h-px bg-slate-100" role="separator"></div>'
    : `<button type="button" role="menuitem" class="menu-item ${it.danger ? 'is-danger' : ''}" data-action="${it.action}" data-id="${esc(req.id)}" ${it.disabled ? `disabled aria-disabled="true" title="${esc(it.reason)}"` : ''}>
        <i data-lucide="${it.icon}" class="size-4 shrink-0"></i><span class="flex-1">${esc(it.label)}</span>
      </button>`)).join('')
    + (items.some((i) => i.disabled) ? `<p class="border-t border-slate-100 px-3.5 py-2 text-xs text-slate-500">${esc(items.find((i) => i.disabled).reason)}</p>` : '');
  menu.hidden = false;
  refreshIcons();

  const r = trigger.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  menuTrigger = trigger;
  trigger.setAttribute('aria-expanded', 'true');
  const firstItem = menu.querySelector('.menu-item:not(:disabled)');
  if (firstItem) firstItem.focus();
}

function closeActionMenu(restoreFocus = false) {
  const menu = $('#actionMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  menu.innerHTML = '';
  if (menuTrigger) {
    menuTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && document.contains(menuTrigger)) menuTrigger.focus();
  }
  menuTrigger = null;
}

function onMenuKeydown(e) {
  const items = $$('#actionMenu .menu-item:not(:disabled)');
  const idx = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
  else if (e.key === 'Tab') closeActionMenu(false);
}

/* =============================================================
   6. ROUTER & APP SHELL
   ============================================================= */
function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs = ''] = raw.split('?');
  const [page, param] = path.split('/');
  return { page: page || 'dashboard', param: param ? decodeURIComponent(param) : null, query: new URLSearchParams(qs) };
}

function navigate(path) {
  const target = `#/${path}`;
  if (location.hash === target) renderApp({ focusMain: true });
  else location.hash = target;
}

function renderApp({ focusMain = false } = {}) {
  let route = parseRoute();
  if (!PAGES[route.page]) route = { page: 'dashboard', param: null, query: new URLSearchParams() };
  if (!PAGES[route.page].roles.includes(state.role)) {
    toast(`${PAGES[route.page].title} isn’t available in the ${state.role} view.`, 'warning');
    history.replaceState(null, '', '#/dashboard');
    route = { page: 'dashboard', param: null, query: new URLSearchParams() };
  }
  ui.route = route;
  closeActionMenu();

  $$('.page').forEach((sec) => { sec.hidden = sec.dataset.page !== route.page; });
  const container = $(`#page-${route.page}`);
  PAGES[route.page].render(container, route);
  renderChrome();
  refreshIcons();
  if (focusMain) {
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
  }
}

/** Persist and re-render after any state change. */
function commit(message, tone = 'success') {
  saveState();
  renderApp();
  if (message) toast(message, tone);
}

/** Run a workflow mutation with error handling. */
function runAction(fn, successMessage) {
  try {
    const result = fn();
    commit(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    return result;
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'error');
    return null;
  }
}

function renderChrome() {
  const me = currentUser();
  const page = PAGES[ui.route.page];
  const title = ui.route.page === 'request' && ui.route.param ? `Request ${ui.route.param}` : page.title;
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = page.subtitle();
  document.title = `${title} · Easy Approve`;

  renderSidebarNav();

  const unread = unreadCount();
  const badge = $('#notifCount');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = unread === 0;
  $('#notifBell').setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
  if (!$('#notifPanel').hidden) renderNotifPanel();

  $('#profileAvatar').innerHTML = avatarHTML(me, 'md');
  $('#profileName').textContent = me.name;
  $('#profileMeta').textContent = `${me.department} · ${me.email}`;
  const switcher = $('#roleSwitcher');
  if (!switcher.options.length) {
    switcher.innerHTML = ALL_ROLES.map((r) => `<option value="${r}">${r} (${esc(userName(ROLES[r].personaId))})</option>`).join('');
  }
  switcher.value = state.role;
}

function renderSidebarNav() {
  const active = ui.route.page === 'request' ? primaryListRoute() : ui.route.page;
  const items = NAV_ITEMS.filter((n) => n.roles.includes(state.role));
  const sections = [...new Set(items.map((i) => i.section))];
  $('#sidebarNav').innerHTML = sections.map((section) => `
    <p class="mb-1.5 mt-4 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 first:mt-0">${esc(section)}</p>
    <ul class="space-y-0.5">
      ${items.filter((i) => i.section === section).map((item) => {
        const count = item.badge ? item.badge() : 0;
        return `<li><a href="#/${item.route}" class="sidebar-link" ${item.route === active ? 'aria-current="page"' : ''}>
          <i data-lucide="${item.icon}" class="size-[18px] shrink-0"></i>
          <span class="flex-1">${esc(item.label)}</span>
          ${count ? `<span class="rounded-full bg-indigo-500/90 px-2 py-0.5 text-[11px] font-semibold text-white" aria-label="${count} items">${count}</span>` : ''}
        </a></li>`;
      }).join('')}
    </ul>`).join('');
}

function openSidebar() {
  $('#sidebar').classList.add('is-open');
  $('#sidebarOverlay').hidden = false;
  $('#sidebarToggle').setAttribute('aria-expanded', 'true');
  const firstLink = $('#sidebar a, #sidebar button');
  if (firstLink) firstLink.focus();
}
function closeSidebar() {
  const sb = $('#sidebar');
  if (!sb.classList.contains('is-open')) return;
  sb.classList.remove('is-open');
  $('#sidebarOverlay').hidden = true;
  $('#sidebarToggle').setAttribute('aria-expanded', 'false');
}

function switchRole(role) {
  if (!ROLES[role] || role === state.role) return;
  state.role = role;
  saveState();
  Object.keys(tableStates).forEach((k) => { tableStates[k].page = 1; tableStates[k].mine = false; });
  closeNotifPanel();
  toast(`Now viewing as ${role}: ${currentUser().name}`, 'info');
  if (!PAGES[ui.route.page].roles.includes(role) || (ui.route.page === 'request' && !canSeeRoute())) navigate('dashboard');
  else renderApp();
}
function canSeeRoute() {
  const req = getRequest(ui.route.param);
  return req && isVisible(req);
}

function resetDemo() {
  confirmDialog({
    title: 'Reset demo data?',
    message: 'All requests, users, groups and notifications you created will be replaced with the original sample data. This can’t be undone.',
    confirmLabel: 'Reset data',
    tone: 'danger',
    icon: 'rotate-ccw',
    iconTone: 'rose',
    onConfirm: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      seedData();
      saveState();
      Object.keys(tableStates).forEach((k) => delete tableStates[k]);
      pendingAttachment = null;
      Object.assign(ui, { flash: null, adminTab: 'users', userSearch: '', notifFilter: 'all', notifType: '', clarTab: 'action' });
      closeSidebar();
      navigate('dashboard');
      toast('Demo data has been reset.', 'success');
    },
  });
}

/* ---------- Header: notification panel ---------- */
function renderNotifPanel() {
  const list = myNotifications().slice(0, 6);
  const unread = unreadCount();
  $('#notifPanel').innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <p class="text-sm font-semibold text-slate-900">Notifications ${unread ? `<span class="ml-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">${unread} new</span>` : ''}</p>
      <button type="button" class="${btnClass('link', 'sm')}" data-action="mark-all-read" ${unread ? '' : 'disabled'}>Mark all read</button>
    </div>
    <ul class="max-h-96 divide-y divide-slate-100 overflow-y-auto">${list.length ? list.map((n) => notificationItemHTML(n, { compact: true })).join('') : `<li>${emptyStateHTML({ icon: 'bell-off', title: 'You’re all caught up' })}</li>`}</ul>
    <a href="#/notifications" class="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-indigo-600 hover:bg-slate-50">View all notifications</a>`;
  refreshIcons();
}
function toggleNotifPanel() {
  const panel = $('#notifPanel');
  if (panel.hidden) {
    renderNotifPanel();
    panel.hidden = false;
    $('#notifBell').setAttribute('aria-expanded', 'true');
  } else closeNotifPanel();
}
function closeNotifPanel() {
  const panel = $('#notifPanel');
  if (panel.hidden) return;
  panel.hidden = true;
  $('#notifBell').setAttribute('aria-expanded', 'false');
}

/* ---------- Header: global search ---------- */
function searchRequests(term, source = visibleRequests()) {
  const q = term.trim().toLowerCase();
  if (!q) return source;
  return source.filter((r) => [r.id, r.title, r.description, userName(r.requesterId), groupName(r.groupId), r.status, r.attachment?.name].some((v) => String(v || '').toLowerCase().includes(q)));
}

function renderGlobalSearch(term) {
  const box = $('#globalSearchResults');
  const input = $('#globalSearch');
  if (!term.trim()) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  const hits = searchRequests(term).sort(byDesc('submittedAt')).slice(0, 6);
  box.innerHTML = hits.length
    ? hits.map((r) => `<a href="#/request/${esc(r.id)}" role="option" class="search-hit flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
        <span class="font-mono text-xs text-slate-500">${esc(r.id)}</span>
        <span class="min-w-0 flex-1 truncate text-sm text-slate-800">${esc(r.title)}</span>${statusBadge(r.status, 'sm')}</a>`).join('')
      + `<button type="button" class="block w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-indigo-600 hover:bg-slate-50" data-action="search-all">See all results for “${esc(term)}”</button>`
    : `<p class="px-4 py-3 text-sm text-slate-500">No requests match “${esc(term)}”.</p>`;
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function closeGlobalSearch() {
  $('#globalSearchResults').hidden = true;
  $('#globalSearch').setAttribute('aria-expanded', 'false');
}
function searchAll() {
  const term = $('#globalSearch').value.trim();
  const key = state.role === 'Requester' ? 'mine' : 'approvals';
  Object.assign(getTableState(key), { search: term, status: '', group: '', page: 1 });
  closeGlobalSearch();
  navigate(primaryListRoute());
}

/* =============================================================
   7. PAGES
   ============================================================= */

/* ---------- Shared: request tables (search/filter/sort/paginate) ---------- */
function getTableState(key) {
  if (!tableStates[key]) tableStates[key] = { search: '', status: '', group: '', sortKey: 'submittedAt', sortDir: 'desc', page: 1, mine: false };
  return tableStates[key];
}

const SORTERS = {
  id: (r) => requestNumber(r.id),
  title: (r) => r.title.toLowerCase(),
  requester: (r) => userName(r.requesterId).toLowerCase(),
  group: (r) => groupName(r.groupId).toLowerCase(),
  approver: (r) => userName(r.approverId).toLowerCase(),
  submittedAt: (r) => r.submittedAt,
  status: (r) => STATUS_LIST.indexOf(r.status),
};

const COLUMNS = {
  id: { label: 'Request ID', sort: 'id', cell: (r) => `<span class="font-mono text-xs font-medium text-slate-600">${esc(r.id)}</span>` },
  title: { label: 'Title', sort: 'title', td: 'max-w-xs', cell: (r) => `<a href="#/request/${esc(r.id)}" class="block truncate font-medium text-slate-900 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-600">${esc(r.title)}</a>${r.attachment ? `<span class="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><i data-lucide="paperclip" class="size-3"></i><span class="truncate">${esc(r.attachment.name)}</span></span>` : ''}` },
  requester: { label: 'Requested By', sort: 'requester', cell: (r) => personHTML(r.requesterId) },
  group: { label: 'Recipient Group', sort: 'group', cell: (r) => `<span class="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"><i data-lucide="building-2" class="size-3"></i>${esc(groupName(r.groupId))}</span>` },
  approver: { label: 'Current Approver', sort: 'approver', cell: (r) => personHTML(r.approverId) },
  submittedAt: { label: 'Submitted', sort: 'submittedAt', cell: (r) => `<time datetime="${esc(r.submittedAt)}" class="whitespace-nowrap text-slate-600">${fmtDate(r.submittedAt)}</time>` },
  status: { label: 'Status', sort: 'status', cell: (r) => statusBadge(r.status) },
};

const TABLES = {
  approvals: { source: () => visibleRequests(), columns: ['id', 'title', 'requester', 'group', 'submittedAt', 'status'], mineFilter: true, label: 'Approval requests' },
  mine: { source: () => myRequests(), columns: ['id', 'title', 'group', 'approver', 'submittedAt', 'status'], mineFilter: false, label: 'My requests' },
};

function queryTable(key) {
  const ts = getTableState(key);
  const me = currentUser();
  let rows = searchRequests(ts.search, TABLES[key].source());
  if (ts.status) rows = rows.filter((r) => r.status === ts.status);
  if (ts.group) rows = rows.filter((r) => r.groupId === ts.group);
  if (ts.mine) rows = rows.filter((r) => canActOn(r) && r.approverId === me.id);
  const getter = SORTERS[ts.sortKey] || SORTERS.submittedAt;
  const dir = ts.sortDir === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    const va = getter(a);
    const vb = getter(b);
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return requestNumber(b.id) - requestNumber(a.id);
  });
  return rows;
}

function paginate(rows, page, size = PAGE_SIZE) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * size;
  const end = Math.min(start + size, total);
  return { rows: rows.slice(start, end), total, totalPages, page: current, start, end };
}

function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current, current - 1, current + 1].filter((n) => n >= 1 && n <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function tableToolbarHTML(key) {
  const ts = getTableState(key);
  const cfg = TABLES[key];
  const groups = [...state.groups].sort(byAsc('name'));
  const active = ts.search || ts.status || ts.group || ts.mine;
  return `<div class="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center">
    <div class="relative flex-1">
      <label for="search-${key}" class="sr-only">Search ${esc(cfg.label.toLowerCase())}</label>
      <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"></i>
      <input id="search-${key}" type="search" data-filter="search" data-table="${key}" value="${esc(ts.search)}" placeholder="Search by ID, title, requester, group…" class="${UI.input} pl-9">
    </div>
    <div class="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
      <div><label for="status-${key}" class="sr-only">Filter by status</label>
        <select id="status-${key}" data-filter="status" data-table="${key}" class="${UI.select} sm:w-48">
          <option value="">All statuses</option>${STATUS_LIST.map((s) => `<option value="${esc(s)}" ${ts.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select></div>
      <div><label for="group-${key}" class="sr-only">Filter by recipient group</label>
        <select id="group-${key}" data-filter="group" data-table="${key}" class="${UI.select} sm:w-44">
          <option value="">All groups</option>${groups.map((g) => `<option value="${esc(g.id)}" ${ts.group === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
        </select></div>
      ${cfg.mineFilter && state.role === 'Approver' ? `<label class="col-span-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700 sm:col-span-1">
          <input type="checkbox" data-filter="mine" data-table="${key}" class="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600" ${ts.mine ? 'checked' : ''}> Awaiting my action</label>` : ''}
      <button type="button" class="${btnClass('ghost')} col-span-2 sm:col-span-1" data-action="clear-filters" data-table="${key}" ${active ? '' : 'disabled'}><i data-lucide="filter-x" class="size-4"></i> Clear</button>
    </div>
  </div>`;
}

function renderTableArea(key, focusSelector) {
  const host = document.getElementById(`table-${key}`);
  if (!host) return;
  const ts = getTableState(key);
  const cfg = TABLES[key];
  const p = paginate(queryTable(key), ts.page);
  ts.page = p.page;

  const head = cfg.columns.map((c) => {
    const col = COLUMNS[c];
    const isSorted = ts.sortKey === col.sort;
    const ariaSort = isSorted ? (ts.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    const icon = isSorted ? (ts.sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down';
    return `<th scope="col" aria-sort="${ariaSort}" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      <button type="button" class="sort-btn hover:text-slate-800" data-action="sort" data-table="${key}" data-sort="${col.sort}">${esc(col.label)}<i data-lucide="${icon}" class="size-3.5"></i></button></th>`;
  }).join('');

  const body = p.rows.map((r) => `<tr class="transition-colors hover:bg-slate-50/80">
      ${cfg.columns.map((c) => `<td class="px-4 py-3 text-sm ${COLUMNS[c].td || ''}">${COLUMNS[c].cell(r)}</td>`).join('')}
      <td class="px-4 py-3 text-right">
        <button type="button" class="${UI.iconBtn}" data-action="open-menu" data-id="${esc(r.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(r.id)}"><i data-lucide="more-vertical" class="size-4"></i></button>
      </td></tr>`).join('');

  const isFiltered = ts.search || ts.status || ts.group || ts.mine;
  host.innerHTML = p.total
    ? `<div class="overflow-x-auto">
        <table class="data-table min-w-[760px] w-full divide-y divide-slate-200" aria-label="${esc(cfg.label)}">
          <thead class="bg-slate-50">${`<tr>${head}<th scope="col" class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th></tr>`}</thead>
          <tbody class="divide-y divide-slate-100 bg-white">${body}</tbody>
        </table></div>
      ${paginationHTML(key, p)}`
    : emptyStateHTML(isFiltered
      ? { icon: 'search', title: 'No matching requests', text: 'Try a different search term or clear the filters.', action: `<button type="button" class="${btnClass('secondary')}" data-action="clear-filters" data-table="${key}">Clear filters</button>` }
      : { icon: 'inbox', title: key === 'mine' ? 'You haven’t submitted any requests yet' : 'No requests to review', text: key === 'mine' ? 'Create your first approval request to see it here.' : 'Requests routed to your groups will appear here.', action: key === 'mine' ? `<a href="#/create" class="${btnClass('primary')}"><i data-lucide="plus" class="size-4"></i> New request</a>` : '' });

  const clearBtn = document.querySelector(`.page:not([hidden]) [data-action="clear-filters"][data-table="${key}"]`);
  if (clearBtn) clearBtn.disabled = !isFiltered;
  refreshIcons();
  if (focusSelector) host.querySelector(focusSelector)?.focus();
}

function paginationHTML(key, p) {
  const nums = pageNumbers(p.page, p.totalPages).map((n) => (n === '…'
    ? '<span class="px-2 text-sm text-slate-400" aria-hidden="true">…</span>'
    : `<button type="button" class="min-w-9 rounded-lg px-3 py-1.5 text-sm font-medium ${n === p.page ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}" data-action="page" data-table="${key}" data-page="${n}" ${n === p.page ? 'aria-current="page"' : ''} aria-label="Page ${n}">${n}</button>`)).join('');
  return `<nav class="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row" aria-label="Pagination">
    <p class="text-sm text-slate-600" aria-live="polite">Showing <span class="font-semibold text-slate-900">${p.start + 1}</span>–<span class="font-semibold text-slate-900">${p.end}</span> of <span class="font-semibold text-slate-900">${p.total}</span></p>
    <div class="flex items-center gap-1">
      <button type="button" class="${UI.iconBtn} disabled:opacity-40" data-action="page" data-table="${key}" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''} aria-label="Previous page"><i data-lucide="chevron-left" class="size-4"></i></button>
      ${nums}
      <button type="button" class="${UI.iconBtn} disabled:opacity-40" data-action="page" data-table="${key}" data-page="${p.page + 1}" ${p.page >= p.totalPages ? 'disabled' : ''} aria-label="Next page"><i data-lucide="chevron-right" class="size-4"></i></button>
    </div>
  </nav>`;
}

function statusChipsHTML(key, rows) {
  const ts = getTableState(key);
  const chips = [{ value: '', label: 'All', n: rows.length }, ...STATUS_LIST.map((s) => ({ value: s, label: s, n: rows.filter((r) => r.status === s).length }))];
  return `<div class="mb-4 flex flex-wrap gap-2" role="group" aria-label="Quick status filter">${chips.map((c) => `
    <button type="button" data-action="quick-status" data-table="${key}" data-status="${esc(c.value)}" aria-pressed="${ts.status === c.value}"
      class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${ts.status === c.value ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}">
      ${esc(c.label)}<span class="rounded-full px-1.5 text-xs ${ts.status === c.value ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}">${c.n}</span></button>`).join('')}</div>`;
}

/* ---------- A. Dashboard ---------- */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function pendingForDashboard() {
  if (state.role === 'Approver') return actionableRequests().sort(byAsc('submittedAt'));
  const pool = state.role === 'Requester' ? myRequests() : state.requests;
  return pool.filter((r) => ACTIONABLE_STATUSES.includes(r.status)).sort(byAsc('submittedAt'));
}

function statCardHTML({ label, value, icon, tone, hint, status }) {
  return `<button type="button" data-action="goto-list" data-status="${esc(status)}" class="${UI.card} group flex w-full items-start justify-between p-5 text-left transition hover:shadow-md hover:ring-indigo-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
    <div><p class="text-sm font-medium text-slate-500">${esc(label)}</p>
      <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900" data-stat="${esc(label)}">${value}</p>
      <p class="mt-1 text-xs text-slate-500">${hint}</p></div>
    <span class="rounded-lg p-2.5 ${TONES[tone]}"><i data-lucide="${icon}" class="size-5"></i></span>
  </button>`;
}

function renderDashboard(el) {
  const me = currentUser();
  const reqs = visibleRequests();
  const count = (s) => reqs.filter((r) => r.status === s).length;
  const openCount = reqs.filter((r) => OPEN_STATUSES.includes(r.status)).length;
  const decided = count(STATUS.APPROVED) + count(STATUS.REJECTED);
  const stats = [
    { label: 'Total Requests', value: reqs.length, icon: 'files', tone: 'indigo', hint: esc(scopeLabel().replace(/^./, (c) => c.toUpperCase())), status: '' },
    { label: 'Pending Approvals', value: openCount, icon: 'hourglass', tone: 'amber', hint: `${count(STATUS.DELEGATED)} delegated · ${count(STATUS.CLARIFICATION)} awaiting clarification`, status: STATUS.PENDING },
    { label: 'Approved Requests', value: count(STATUS.APPROVED), icon: 'circle-check', tone: 'emerald', hint: decided ? `${Math.round((count(STATUS.APPROVED) / decided) * 100)}% approval rate` : 'No decisions yet', status: STATUS.APPROVED },
    { label: 'Rejected Requests', value: count(STATUS.REJECTED), icon: 'circle-x', tone: 'rose', hint: `${pluralize(decided, 'decision')} recorded`, status: STATUS.REJECTED },
  ];
  const ctaByRole = {
    Requester: `<a href="#/create" class="${btnClass('primary', 'lg')}"><i data-lucide="plus" class="size-4"></i> New request</a>`,
    Approver: `<a href="#/approvals" class="${btnClass('primary', 'lg')}"><i data-lucide="list-checks" class="size-4"></i> Review approvals</a>`,
    Admin: `<a href="#/admin" class="${btnClass('primary', 'lg')}"><i data-lucide="users" class="size-4"></i> Manage groups</a>`,
  };
  const actionable = actionableRequests().length;
  const toRespond = myRequests().filter(canRespond).length;
  const nudge = state.role === 'Requester'
    ? (toRespond ? `You have <strong>${pluralize(toRespond, 'clarification')}</strong> waiting for your response.` : 'All your requests are moving along.')
    : `You have <strong>${pluralize(actionable, 'request')}</strong> awaiting your decision.`;

  el.innerHTML = `
    ${flashHTML('dashboard')}
    <div class="mb-6 flex flex-col gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 p-6 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p class="text-sm font-medium text-indigo-200">${esc(state.role)} view</p>
        <h2 class="mt-1 text-2xl font-semibold">${greeting()}, ${esc(me.name.split(' ')[0])}</h2>
        <p class="mt-1 text-sm text-indigo-100">${nudge}</p>
      </div>
      <div class="[&_a]:bg-white [&_a]:text-indigo-700 [&_a:hover]:bg-indigo-50">${ctaByRole[state.role]}</div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">${stats.map(statCardHTML).join('')}</div>

    <div class="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
      <section class="${UI.card} xl:col-span-2" aria-labelledby="dash-recent">
        ${cardHeader('Recent Requests', { id: 'dash-recent', icon: 'files', action: `<a href="#/${primaryListRoute()}" class="${btnClass('link', 'sm')}">View all</a>` })}
        ${recentRequestsHTML(reqs)}
      </section>
      <section class="${UI.card}" aria-labelledby="dash-pending">
        ${cardHeader(state.role === 'Requester' ? 'Awaiting Approval' : 'Pending Approvals', { id: 'dash-pending', icon: 'hourglass', subtitle: state.role === 'Approver' ? 'Assigned to you, oldest first' : 'Oldest first' })}
        ${pendingListHTML(pendingForDashboard().slice(0, 5))}
      </section>
    </div>

    <div class="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
      <section class="${UI.card} xl:col-span-2" aria-labelledby="dash-overview">
        ${cardHeader('Status Overview', { id: 'dash-overview', icon: 'chart-pie' })}
        ${statusOverviewHTML(reqs)}
      </section>
      <section class="${UI.card}" aria-labelledby="dash-notifs">
        ${cardHeader('Recent Notifications', { id: 'dash-notifs', icon: 'bell', action: `<a href="#/notifications" class="${btnClass('link', 'sm')}">View all</a>` })}
        <ul class="divide-y divide-slate-100">${myNotifications().slice(0, 5).map((n) => notificationItemHTML(n, { compact: true })).join('') || `<li>${emptyStateHTML({ icon: 'bell-off', title: 'No notifications yet' })}</li>`}</ul>
      </section>
    </div>`;
}

function recentRequestsHTML(reqs) {
  const recent = [...reqs].sort(byDesc('submittedAt')).slice(0, 6);
  if (!recent.length) return emptyStateHTML({ icon: 'inbox', title: 'No requests yet', text: 'Submitted requests will show up here.' });
  return `<ul class="divide-y divide-slate-100">${recent.map((r) => `
    <li><a href="#/request/${esc(r.id)}" class="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500"><i data-lucide="${r.attachment ? fileIcon(r.attachment.name) : 'file'}" class="size-4"></i></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-slate-900">${esc(r.title)}</span>
        <span class="block truncate text-xs text-slate-500">${esc(r.id)} · ${esc(userName(r.requesterId))} · ${esc(groupName(r.groupId))} · ${fmtDate(r.submittedAt)}</span>
      </span>
      ${statusBadge(r.status, 'sm')}
    </a></li>`).join('')}</ul>`;
}

function pendingListHTML(items) {
  if (!items.length) return emptyStateHTML({ icon: 'check-check', title: 'Nothing pending', text: state.role === 'Approver' ? 'You have no requests waiting for a decision.' : 'No requests are waiting for approval.' });
  return `<ul class="divide-y divide-slate-100">${items.map((r) => {
    const days = Math.floor((Date.now() - new Date(r.submittedAt)) / 86400000);
    const quick = canActOn(r)
      ? `<div class="mt-2 flex gap-1.5">
          <button type="button" class="${btnClass('success', 'sm')}" data-action="approve" data-id="${esc(r.id)}"><i data-lucide="check" class="size-3.5"></i> Approve</button>
          <button type="button" class="${btnClass('secondary', 'sm')}" data-action="reject" data-id="${esc(r.id)}"><i data-lucide="x" class="size-3.5"></i> Reject</button>
        </div>` : '';
    return `<li class="px-5 py-3">
      <div class="flex items-start justify-between gap-3">
        <a href="#/request/${esc(r.id)}" class="min-w-0 text-sm font-medium text-slate-900 hover:text-indigo-600"><span class="line-clamp-2">${esc(r.title)}</span></a>
        ${statusBadge(r.status, 'sm')}
      </div>
      <p class="mt-1 text-xs text-slate-500">${esc(r.id)} · ${esc(groupName(r.groupId))} · waiting ${days ? pluralize(days, 'day') : 'since today'}${state.role !== 'Approver' ? ` · with ${esc(userName(r.approverId))}` : ''}</p>
      ${quick}
    </li>`;
  }).join('')}</ul>`;
}

function statusOverviewHTML(reqs) {
  if (!reqs.length) return emptyStateHTML({ icon: 'chart-pie', title: 'No data yet' });
  const total = reqs.length;
  const segs = STATUS_LIST.map((s) => ({ s, n: reqs.filter((r) => r.status === s).length }));
  const groups = state.groups.map((g) => ({ g, n: reqs.filter((r) => r.groupId === g.id).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const maxG = Math.max(1, ...groups.map((x) => x.n));
  return `<div class="grid gap-6 p-5 md:grid-cols-2">
    <div>
      <p class="text-sm font-medium text-slate-700">By status</p>
      <div class="dist-bar mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="${segs.map((x) => `${x.s}: ${x.n}`).join(', ')}">
        ${segs.filter((x) => x.n).map((x) => `<span class="${STATUS_STYLE[x.s].bar}" style="width:${(x.n / total) * 100}%" title="${esc(x.s)}: ${x.n}"></span>`).join('')}
      </div>
      <ul class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">${segs.map((x) => `
        <li class="flex items-center gap-2"><span class="size-2.5 rounded-full ${STATUS_STYLE[x.s].bar}" aria-hidden="true"></span><span class="flex-1 truncate text-slate-600">${esc(x.s)}</span><span class="font-semibold text-slate-900">${x.n}</span></li>`).join('')}
      </ul>
    </div>
    <div>
      <p class="text-sm font-medium text-slate-700">By recipient group</p>
      <ul class="mt-3 space-y-3">${groups.map((x) => `
        <li><div class="flex justify-between text-sm"><span class="text-slate-600">${esc(x.g.name)}</span><span class="font-semibold text-slate-900">${x.n}</span></div>
          <div class="mt-1 h-2 rounded-full bg-slate-100"><div class="h-2 rounded-full bg-indigo-500" style="width:${(x.n / maxG) * 100}%"></div></div></li>`).join('')}
      </ul>
    </div>
  </div>`;
}

/* ---------- B. Create Approval Request ---------- */
function renderCreate(el) {
  pendingAttachment = null;
  const groupOptions = state.groups.map((g) => ({ value: g.id, label: g.approverIds.length ? g.name : `${g.name} (no approvers yet)`, disabled: !g.approverIds.length }));
  el.innerHTML = `
    ${flashHTML('create')}
    <div class="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
      <form id="createForm" data-form="create-request" novalidate class="${UI.card} lg:col-span-2" aria-describedby="createFormStatus">
        ${cardHeader('Request details', { icon: 'file-plus', subtitle: 'Fields marked <span class="text-rose-600">*</span> are required.' })}
        <div class="space-y-5 p-5">
          <div id="createFormStatus"></div>
          ${inputField({ id: 'req-title', name: 'title', label: 'Title / Subject', required: true, maxlength: 120, placeholder: 'e.g. Purchase of 20 infusion pumps for ICU' })}
          ${textareaField({ id: 'req-description', name: 'description', label: 'Description', required: true, rows: 6, maxlength: 2000, placeholder: 'Explain what you need approved, why, and any cost or deadline involved.' })}
          ${selectField({ id: 'req-group', name: 'groupId', label: 'Recipient Group', required: true, options: groupOptions, placeholder: 'Select a recipient group' })}
          <div id="routingPreview" aria-live="polite"></div>
          <div>
            <span class="${UI.label}" id="attach-label">Attachment <span class="font-normal text-slate-400">(optional)</span></span>
            <label for="req-attachment" data-dropzone class="dropzone flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center hover:border-indigo-400 hover:bg-indigo-50/40">
              <i data-lucide="upload" class="size-6 text-slate-400"></i>
              <span class="text-sm text-slate-600"><span class="font-semibold text-indigo-600">Click to upload</span> or drag and drop</span>
              <span class="text-xs text-slate-500">PDF, Word, Excel, PowerPoint, CSV or image · up to ${formatBytes(MAX_ATTACHMENT_BYTES)}</span>
              <input id="req-attachment" name="attachment" type="file" class="sr-only" aria-labelledby="attach-label" aria-describedby="req-attachment-error" accept="${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',')}">
            </label>
            <p id="req-attachment-error" class="field-error" data-error-for="attachment" hidden></p>
            <div id="attachmentChip" class="mt-3"></div>
          </div>
        </div>
        <div class="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" class="${btnClass('secondary', 'lg')}" data-action="cancel-create">Cancel</button>
          <button type="submit" class="${btnClass('primary', 'lg')}"><i data-lucide="send" class="size-4"></i> Submit request</button>
        </div>
      </form>

      <aside class="space-y-4">
        <div class="${UI.card} p-5">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-slate-900"><i data-lucide="route" class="size-4 text-slate-400"></i> What happens next</h2>
          <ol class="mt-3 space-y-3 text-sm text-slate-600">
            ${['Your request is routed to the primary approver of the selected group.', 'Every approver in the group is notified.', 'The approver may approve, reject, ask for clarification or delegate.', 'You’ll be notified of every decision and question.'].map((t, i) => `<li class="flex gap-3"><span class="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">${i + 1}</span><span>${t}</span></li>`).join('')}
          </ol>
        </div>
        <div class="${UI.card} p-5">
          <h2 class="text-sm font-semibold text-slate-900">Recipient groups</h2>
          <ul class="mt-3 space-y-3">${state.groups.map((g) => `<li class="text-sm"><p class="font-medium text-slate-800">${esc(g.name)}</p><p class="text-xs text-slate-500">${esc(g.description || '')}</p></li>`).join('')}</ul>
        </div>
      </aside>
    </div>`;
  $$('[data-counter]', el).forEach(updateCounter);
}

function updateRoutingPreview() {
  const box = $('#routingPreview');
  if (!box) return;
  const group = getGroup($('#req-group').value);
  if (!group) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="flex items-start gap-3 rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-900 ring-1 ring-indigo-100">
    <i data-lucide="route" class="mt-0.5 size-4 shrink-0 text-indigo-500"></i>
    <p>Will be routed to <strong>${esc(userName(group.approverIds[0]))}</strong> (primary approver).
    ${group.approverIds.length > 1 ? `Also notified: ${group.approverIds.slice(1).map((id) => esc(userName(id))).join(', ')}.` : ''}</p></div>`;
  refreshIcons();
}

function handleAttachmentFile(file) {
  const form = $('#createForm');
  if (!form) return;
  if (!file) return;
  const ext = fileExt(file.name);
  let error = '';
  if (!ACCEPTED_EXTENSIONS.includes(ext)) error = `“.${ext}” files aren’t supported. Use ${ACCEPTED_EXTENSIONS.slice(0, 6).join(', ')}…`;
  else if (file.size > MAX_ATTACHMENT_BYTES) error = `File is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.`;
  $('[data-dropzone]').classList.toggle('field-invalid', Boolean(error));
  setFieldError(form, 'attachment', error);
  if (error) { pendingAttachment = null; $('#req-attachment').value = ''; }
  else pendingAttachment = { name: file.name, size: file.size, type: file.type || mimeFor(file.name) };
  renderAttachmentChip();
}

function renderAttachmentChip() {
  const box = $('#attachmentChip');
  if (!box) return;
  box.innerHTML = pendingAttachment ? `<div class="flex items-center gap-3 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <i data-lucide="${fileIcon(pendingAttachment.name)}" class="size-5 text-indigo-500"></i>
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-800">${esc(pendingAttachment.name)}</span><span class="text-xs text-slate-500">${formatBytes(pendingAttachment.size)} · ready to attach</span></span>
      <button type="button" class="${UI.iconBtn}" data-action="remove-attachment" aria-label="Remove attachment ${esc(pendingAttachment.name)}"><i data-lucide="trash-2" class="size-4"></i></button>
    </div>` : '';
  refreshIcons();
}

function isCreateFormDirty() {
  const form = $('#createForm');
  if (!form) return false;
  return Boolean(form.elements.title.value.trim() || form.elements.description.value.trim() || form.elements.groupId.value || pendingAttachment);
}

function handleCreateSubmit(form) {
  const errors = validateForm(form, {
    title: [rules.required('Title'), rules.minLength(5, 'Title'), rules.maxLength(120, 'Title')],
    description: [rules.required('Description'), rules.minLength(10, 'Description')],
    groupId: [rules.required('Recipient group')],
  });
  const status = $('#createFormStatus');
  if (Object.keys(errors).length) {
    status.innerHTML = alertHTML('error', `Please fix ${pluralize(Object.keys(errors).length, 'field')} before submitting.`, Object.values(errors).map(esc).join('<br>'), { dismissible: false });
    refreshIcons();
    return;
  }
  status.innerHTML = '';
  const req = runAction(() => createRequest({
    title: form.elements.title.value,
    description: form.elements.description.value,
    groupId: form.elements.groupId.value,
    attachment: pendingAttachment,
  }), (r) => `${r.id} submitted to ${groupName(r.groupId)}.`);
  if (!req) return;
  pendingAttachment = null;
  setFlash('request', 'success', 'Request submitted successfully', `${esc(req.id)} has been routed to ${esc(userName(req.approverId))} in the ${esc(groupName(req.groupId))} group.`);
  navigate(`request/${req.id}`);
}

/* ---------- C. Approval List ---------- */
function renderApprovals(el) {
  const awaiting = actionableRequests().length;
  el.innerHTML = `
    ${flashHTML('approvals')}
    ${state.role === 'Approver' ? alertHTML('info', `${pluralize(awaiting, 'request')} awaiting your decision`, 'You can see every request routed to your groups. Actions are enabled only on requests currently assigned to you.', { dismissible: true }) : ''}
    ${state.role === 'Admin' ? alertHTML('info', 'Admin view: all requests', 'Admins can act on any open request (recorded as an admin action). This is a demo convenience, not real authorisation.', { dismissible: true }) : ''}
    ${statusChipsHTML('approvals', TABLES.approvals.source())}
    <section class="${UI.card} overflow-hidden" aria-label="Approval list">
      ${tableToolbarHTML('approvals')}
      <div id="table-approvals"></div>
    </section>`;
  renderTableArea('approvals');
}

/* ---------- H. My Requests ---------- */
function renderMyRequests(el) {
  const mine = myRequests();
  el.innerHTML = `
    ${flashHTML('my-requests')}
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-slate-600">You have submitted <strong>${pluralize(mine.length, 'request')}</strong>.</p>
      <a href="#/create" class="${btnClass('primary')}"><i data-lucide="plus" class="size-4"></i> New request</a>
    </div>
    ${statusChipsHTML('mine', mine)}
    <section class="${UI.card} overflow-hidden" aria-label="My requests">
      ${tableToolbarHTML('mine')}
      <div id="table-mine"></div>
    </section>`;
  renderTableArea('mine');
}

/* ---------- D. Request Details ---------- */
function renderRequestDetails(el, route) {
  const req = getRequest(route.param);
  if (!req || !isVisible(req)) {
    el.innerHTML = `<div class="${UI.card}">${emptyStateHTML({
      icon: 'file-question',
      title: req ? 'You can’t view this request in the current role' : 'Request not found',
      text: req ? 'Switch to a role that is involved with this request to see it.' : `There is no request with ID “${route.param || ''}”.`,
      action: `<a href="#/${primaryListRoute()}" class="${btnClass('secondary')}"><i data-lucide="arrow-left" class="size-4"></i> Back to list</a>`,
    })}</div>`;
    return;
  }
  if (markViewed(req)) saveState();

  const requester = getUser(req.requesterId);
  const group = getGroup(req.groupId);
  const lastDelegation = state.delegations.filter((d) => d.requestId === req.id).sort(byDesc('at'))[0];

  el.innerHTML = `
    ${flashHTML('request')}
    <a href="#/${primaryListRoute()}" class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600"><i data-lucide="arrow-left" class="size-4"></i> Back to ${state.role === 'Requester' ? 'My Requests' : 'Approval List'}</a>

    <div class="${UI.card} p-5 sm:p-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm font-medium text-slate-500">${esc(req.id)}</span>${statusBadge(req.status)}
          </div>
          <h2 class="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl">${esc(req.title)}</h2>
          <p class="mt-1 text-sm text-slate-500">Submitted ${fmtDateTime(req.submittedAt)} to <strong class="font-medium text-slate-700">${esc(groupName(req.groupId))}</strong> · last updated ${timeAgo(req.updatedAt)}</p>
        </div>
        <div class="flex flex-wrap gap-2">${requestActionsHTML(req)}</div>
      </div>
      ${decisionBannerHTML(req)}
    </div>

    <div class="mt-6 grid gap-6 lg:grid-cols-3">
      <div class="space-y-6 lg:col-span-2">
        <section class="${UI.card}" aria-labelledby="det-desc">
          ${cardHeader('Description', { id: 'det-desc', icon: 'file-text' })}
          <p class="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-slate-700">${esc(req.description)}</p>
          <div class="border-t border-slate-100 px-5 py-4">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Attachment</p>
            ${req.attachment ? `<button type="button" data-action="attachment-preview" data-id="${esc(req.id)}" class="mt-2 flex w-full max-w-md items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ring-slate-200 hover:bg-slate-50">
                <i data-lucide="${fileIcon(req.attachment.name)}" class="size-5 text-indigo-500"></i>
                <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-800">${esc(req.attachment.name)}</span><span class="text-xs text-slate-500">${formatBytes(req.attachment.size)}</span></span>
                <i data-lucide="eye" class="size-4 text-slate-400"></i></button>`
              : '<p class="mt-1 text-sm text-slate-500">No attachment was provided.</p>'}
          </div>
        </section>

        <section class="${UI.card}" aria-labelledby="det-clar" id="clarification">
          ${cardHeader('Clarification', { id: 'det-clar', icon: 'messages-square', subtitle: req.clarifications.length ? `${pluralize(req.clarifications.length, 'message')}` : 'No questions have been asked' })}
          <div class="p-5">${threadHTML(req)}</div>
        </section>

        <section class="${UI.card}" aria-labelledby="det-comments">
          ${cardHeader('Comments', { id: 'det-comments', icon: 'message-square', subtitle: pluralize(req.comments.length, 'comment') })}
          <div class="p-5">
            ${req.comments.length ? `<ul class="space-y-4">${req.comments.map((c) => `<li class="flex gap-3">${avatarHTML(getUser(c.authorId), 'sm')}
              <div class="min-w-0 flex-1"><p class="text-sm"><span class="font-medium text-slate-900">${esc(userName(c.authorId))}</span> <span class="text-xs text-slate-500">· ${fmtDateTime(c.at)}</span></p>
              <p class="mt-0.5 whitespace-pre-wrap text-sm text-slate-700">${esc(c.text)}</p></div></li>`).join('')}</ul>` : '<p class="text-sm text-slate-500">No comments yet.</p>'}
            <form data-form="comment" data-id="${esc(req.id)}" novalidate class="mt-5 flex items-start gap-3 border-t border-slate-100 pt-5">
              ${avatarHTML(currentUser(), 'sm')}
              <div class="flex-1">
                <label for="comment-${esc(req.id)}" class="sr-only">Add a comment</label>
                <textarea id="comment-${esc(req.id)}" name="text" rows="2" placeholder="Add a comment…" class="${UI.input}" aria-describedby="comment-${esc(req.id)}-error"></textarea>
                <p id="comment-${esc(req.id)}-error" class="field-error" data-error-for="text" hidden></p>
                <div class="mt-2 flex justify-end"><button type="submit" class="${btnClass('secondary', 'sm')}"><i data-lucide="send" class="size-3.5"></i> Post comment</button></div>
              </div>
            </form>
          </div>
        </section>
      </div>

      <div class="space-y-6">
        <section class="${UI.card}" aria-labelledby="det-requester">
          ${cardHeader('Requester', { id: 'det-requester', icon: 'user-round' })}
          <div class="flex items-center gap-3 px-5 pt-4">${avatarHTML(requester, 'lg')}
            <div class="min-w-0"><p class="truncate font-medium text-slate-900">${esc(requester?.name)}</p><p class="truncate text-sm text-slate-500">${esc(requester?.department)}</p></div></div>
          <dl class="space-y-2 px-5 py-4 text-sm">
            <div class="flex gap-2"><dt class="flex items-center gap-1.5 text-slate-500"><i data-lucide="mail" class="size-3.5"></i><span class="sr-only">Email</span></dt><dd class="truncate text-slate-700">${esc(requester?.email)}</dd></div>
          </dl>
        </section>

        <section class="${UI.card}" aria-labelledby="det-routing">
          ${cardHeader('Routing', { id: 'det-routing', icon: 'route' })}
          <dl class="divide-y divide-slate-100 text-sm">
            <div class="flex items-center justify-between gap-3 px-5 py-3"><dt class="text-slate-500">Recipient group</dt><dd class="font-medium text-slate-800">${esc(group?.name)}</dd></div>
            <div class="flex items-center justify-between gap-3 px-5 py-3"><dt class="text-slate-500">Current approver</dt><dd class="min-w-0">${personHTML(req.approverId)}</dd></div>
            ${lastDelegation ? `<div class="px-5 py-3"><dt class="text-slate-500">Delegation</dt><dd class="mt-1 text-slate-700">${esc(userName(lastDelegation.fromId))} → ${esc(userName(lastDelegation.toId))}<br><span class="text-xs text-slate-500">${fmtDate(lastDelegation.startDate)} – ${fmtDate(lastDelegation.endDate)}</span></dd></div>` : ''}
            <div class="flex items-center justify-between gap-3 px-5 py-3"><dt class="text-slate-500">Group approvers</dt><dd class="text-right text-slate-700">${(group?.approverIds || []).map((id) => esc(userName(id))).join(', ') || '—'}</dd></div>
          </dl>
        </section>

        <section class="${UI.card}" aria-labelledby="det-history">
          ${cardHeader('Approval History', { id: 'det-history', icon: 'history' })}
          <ol class="timeline space-y-5 p-5">${[...req.history].reverse().map(historyItemHTML).join('')}</ol>
        </section>
      </div>
    </div>`;
  $$('[data-counter]', el).forEach(updateCounter);
  if (route.query.get('focus') === 'respond') {
    requestAnimationFrame(() => {
      const box = document.getElementById(`reply-${req.id}`);
      if (box) { box.scrollIntoView({ block: 'center' }); box.focus({ preventScroll: true }); }
    });
  }
}

function requestActionsHTML(req) {
  const id = esc(req.id);
  if (canActOn(req)) {
    return `<button type="button" class="${btnClass('success')}" data-action="approve" data-id="${id}"><i data-lucide="check" class="size-4"></i> Approve</button>
      <button type="button" class="${btnClass('danger')}" data-action="reject" data-id="${id}"><i data-lucide="x" class="size-4"></i> Reject</button>
      <button type="button" class="${btnClass('secondary')}" data-action="clarify" data-id="${id}"><i data-lucide="message-circle-question" class="size-4"></i> Request clarification</button>
      <button type="button" class="${btnClass('secondary')}" data-action="delegate" data-id="${id}"><i data-lucide="forward" class="size-4"></i> Delegate</button>`;
  }
  if (canRespond(req)) {
    return `<button type="button" class="${btnClass('primary')}" data-action="respond" data-id="${id}"><i data-lucide="reply" class="size-4"></i> Respond to clarification</button>`;
  }
  if (state.role !== 'Requester' && ACTIONABLE_STATUSES.includes(req.status)) {
    return `<p class="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200"><i data-lucide="eye" class="size-4"></i> Read-only · assigned to ${esc(userName(req.approverId))}</p>`;
  }
  return '';
}

function decisionBannerHTML(req) {
  if (req.status === STATUS.APPROVED) {
    const note = [...req.history].reverse().find((h) => h.action === 'Approved');
    return `<div class="mt-5 flex gap-3 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-200"><i data-lucide="circle-check" class="size-5 shrink-0 text-emerald-600"></i>
      <p><strong>Approved</strong> by ${esc(userName(req.decidedBy))} on ${fmtDateTime(req.decidedAt)}.${note && note.note ? ` “${esc(note.note)}”` : ''}</p></div>`;
  }
  if (req.status === STATUS.REJECTED) {
    return `<div class="mt-5 flex gap-3 rounded-lg bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200"><i data-lucide="circle-x" class="size-5 shrink-0 text-rose-600"></i>
      <p><strong>Rejected</strong> by ${esc(userName(req.decidedBy))} on ${fmtDateTime(req.decidedAt)}. Reason: “${esc(req.rejectionReason)}”</p></div>`;
  }
  if (req.status === STATUS.CLARIFICATION) {
    return `<div class="mt-5 flex gap-3 rounded-lg bg-sky-50 p-4 text-sm text-sky-900 ring-1 ring-sky-200"><i data-lucide="message-circle-question" class="size-5 shrink-0 text-sky-600"></i>
      <p><strong>Waiting for ${esc(userName(req.requesterId))}</strong> to answer a clarification question. The approval resumes once they respond.</p></div>`;
  }
  return '';
}

function historyItemHTML(h) {
  const style = HISTORY_STYLE[h.action] || HISTORY_STYLE.Submitted;
  return `<li class="flex gap-3">
    <span class="relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-white ${style.tone}"><i data-lucide="${style.icon}" class="size-4"></i></span>
    <div class="min-w-0 flex-1 pt-1">
      <p class="text-sm"><span class="font-medium text-slate-900">${esc(h.action)}</span> <span class="text-slate-500">by ${esc(userName(h.actorId))}</span></p>
      <p class="text-xs text-slate-500"><time datetime="${esc(h.at)}">${fmtDateTime(h.at)}</time></p>
      ${h.note ? `<p class="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 px-2.5 py-1.5 text-sm text-slate-600">${esc(h.note)}</p>` : ''}
    </div></li>`;
}

/** Clarification conversation with inline ask/respond forms. */
function threadHTML(req) {
  const me = currentUser();
  const msgs = req.clarifications.map((m) => {
    const mine = m.authorId === me.id;
    const isQuestion = m.role === 'approver';
    return `<li class="flex gap-3 ${mine ? 'flex-row-reverse' : ''}">
      ${avatarHTML(getUser(m.authorId), 'sm')}
      <div class="flex max-w-[85%] flex-col ${mine ? 'items-end' : 'items-start'}">
        <p class="mb-1 text-xs text-slate-500"><span class="font-medium text-slate-700">${esc(userName(m.authorId))}</span> · ${isQuestion ? 'Question' : 'Response'} · <time datetime="${esc(m.at)}">${fmtDateTime(m.at)}</time></p>
        <div class="bubble ${isQuestion ? 'bubble-q' : 'bubble-a'} ${mine ? 'bubble-mine' : ''}">${esc(m.text)}</div>
      </div></li>`;
  }).join('');
  const rid = esc(req.id);
  let form = '';
  if (canRespond(req)) {
    form = `<form data-form="clarify-reply" data-id="${rid}" novalidate class="mt-5 rounded-xl bg-sky-50/60 p-4 ring-1 ring-sky-100">
      <label for="reply-${rid}" class="${UI.label}">Your response <span class="text-rose-600" aria-hidden="true">*</span></label>
      <textarea id="reply-${rid}" name="text" rows="3" required aria-required="true" aria-describedby="reply-${rid}-error" placeholder="Answer the approver’s question…" class="${UI.input}"></textarea>
      <p id="reply-${rid}-error" class="field-error" data-error-for="text" hidden></p>
      <div class="mt-3 flex justify-end"><button type="submit" class="${btnClass('primary')}"><i data-lucide="reply" class="size-4"></i> Send response</button></div>
    </form>`;
  } else if (canActOn(req)) {
    form = `<form data-form="clarify-ask" data-id="${rid}" novalidate class="mt-5">
      <label for="ask-${rid}" class="${UI.label}">${req.clarifications.length ? 'Ask a follow-up question' : 'Ask the requester a question'}</label>
      <textarea id="ask-${rid}" name="text" rows="2" aria-describedby="ask-${rid}-error" placeholder="What do you need to know before deciding?" class="${UI.input}"></textarea>
      <p id="ask-${rid}-error" class="field-error" data-error-for="text" hidden></p>
      <div class="mt-3 flex justify-end"><button type="submit" class="${btnClass('secondary')}"><i data-lucide="message-circle-question" class="size-4"></i> Request clarification</button></div>
    </form>`;
  }
  const empty = !req.clarifications.length && !form ? '<p class="text-sm text-slate-500">No clarification has been requested on this item.</p>' : '';
  return `${msgs ? `<ul class="space-y-4">${msgs}</ul>` : ''}${empty}${form}`;
}

/* ---------- Approver action modals ---------- */
function guardAction(id) {
  const req = getRequest(id);
  if (!req) { toast('Request not found.', 'error'); return null; }
  if (!canActOn(req)) { toast(`You can’t act on ${req.id} in the ${state.role} view.`, 'warning'); return null; }
  return req;
}

function requestSummaryHTML(req) {
  return `<div class="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
    <p class="font-medium text-slate-900">${esc(req.title)}</p>
    <p class="mt-0.5 text-xs text-slate-500">${esc(req.id)} · ${esc(userName(req.requesterId))} · ${esc(groupName(req.groupId))} · ${fmtDate(req.submittedAt)}</p></div>`;
}

function openApproveModal(id) {
  const req = guardAction(id);
  if (!req) return;
  openModal({
    title: `Approve ${req.id}?`,
    description: `${esc(userName(req.requesterId))} will be notified that the request was approved.`,
    icon: 'circle-check',
    iconTone: 'emerald',
    body: requestSummaryHTML(req) + textareaField({ id: 'approve-comment', name: 'comment', label: 'Comment (optional)', rows: 3, placeholder: 'Add a note for the requester' }),
    confirmLabel: 'Approve request',
    confirmTone: 'success',
    onConfirm: (form) => { runAction(() => approveRequest(req.id, form.elements.comment.value.trim()), `${req.id} approved.`); },
  });
}

function openRejectModal(id) {
  const req = guardAction(id);
  if (!req) return;
  openModal({
    title: `Reject ${req.id}?`,
    description: 'A reason is required and will be shared with the requester.',
    icon: 'circle-x',
    iconTone: 'rose',
    body: requestSummaryHTML(req) + textareaField({ id: 'reject-reason', name: 'reason', label: 'Reason for rejection', required: true, rows: 4, placeholder: 'Explain why this request can’t be approved and what would change your decision.' }),
    confirmLabel: 'Reject request',
    confirmTone: 'danger',
    onConfirm: (form) => {
      const errors = validateForm(form, { reason: [rules.required('A rejection reason'), rules.minLength(10, 'The reason')] });
      if (Object.keys(errors).length) return false;
      runAction(() => rejectRequest(req.id, form.elements.reason.value), `${req.id} rejected.`);
      return true;
    },
  });
}

function openClarifyModal(id) {
  const req = guardAction(id);
  if (!req) return;
  openModal({
    title: `Request clarification on ${req.id}`,
    description: `${esc(userName(req.requesterId))} will be asked to respond. The status changes to “Clarification Requested”.`,
    icon: 'message-circle-question',
    iconTone: 'sky',
    body: requestSummaryHTML(req) + textareaField({ id: 'clarify-question', name: 'question', label: 'Your question', required: true, rows: 4, placeholder: 'What do you need to know before deciding?' }),
    confirmLabel: 'Send question',
    onConfirm: (form) => {
      const errors = validateForm(form, { question: [rules.required('Your question'), rules.minLength(5, 'Your question')] });
      if (Object.keys(errors).length) return false;
      runAction(() => requestClarification(req.id, form.elements.question.value), `Clarification requested on ${req.id}.`);
      return true;
    },
  });
}

function openAttachmentPreview(id) {
  const req = getRequest(id);
  if (!req || !req.attachment) return;
  openModal({
    title: req.attachment.name,
    description: 'File preview',
    icon: fileIcon(req.attachment.name),
    body: `<div class="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
      <p>${formatBytes(req.attachment.size)} · ${esc(req.attachment.type || 'file')}</p>
      <p class="mt-2">This prototype stores only the file name and size. In the production system the document would open here.</p></div>`,
    confirmLabel: 'Close',
    confirmTone: 'secondary',
    cancelLabel: 'Back',
  });
}

/* ---------- G. Clarifications ---------- */
function renderClarifications(el) {
  const needing = clarificationsNeedingMe();
  const all = visibleRequests().filter((r) => r.clarifications.length || r.status === STATUS.CLARIFICATION).sort(byDesc('updatedAt'));
  const awaitingRequester = visibleRequests().filter((r) => r.status === STATUS.CLARIFICATION);
  const tabs = [
    { key: 'action', label: state.role === 'Requester' ? 'Awaiting my response' : 'Responses to review', items: needing },
    ...(state.role !== 'Requester' ? [{ key: 'waiting', label: 'Waiting on requester', items: awaitingRequester }] : []),
    { key: 'all', label: 'All conversations', items: all },
  ];
  if (!tabs.some((t) => t.key === ui.clarTab)) ui.clarTab = 'action';
  const current = tabs.find((t) => t.key === ui.clarTab);

  el.innerHTML = `
    ${flashHTML('clarifications')}
    <div class="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Clarification views">
      ${tabs.map((t) => `<button type="button" role="tab" aria-selected="${t.key === ui.clarTab}" data-action="clar-tab" data-tab="${t.key}"
        class="flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${t.key === ui.clarTab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
        ${esc(t.label)}<span class="rounded-full bg-slate-200/80 px-1.5 text-xs text-slate-700">${t.items.length}</span></button>`).join('')}
    </div>
    <div class="space-y-4" role="tabpanel">
      ${current.items.length ? current.items.map((r) => `
        <article class="${UI.card}" aria-labelledby="clar-${esc(r.id)}">
          <div class="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="min-w-0">
              <h2 id="clar-${esc(r.id)}" class="truncate text-base font-semibold text-slate-900"><a href="#/request/${esc(r.id)}" class="hover:text-indigo-600">${esc(r.title)}</a></h2>
              <p class="text-xs text-slate-500">${esc(r.id)} · requested by ${esc(userName(r.requesterId))} · approver ${esc(userName(r.approverId))}</p>
            </div>
            ${statusBadge(r.status)}
          </div>
          <div class="p-5">${threadHTML(r)}</div>
        </article>`).join('')
      : `<div class="${UI.card}">${emptyStateHTML({ icon: 'messages-square', title: 'No conversations here', text: ui.clarTab === 'action' ? 'You’re all caught up on clarifications.' : 'Clarification questions will appear here once asked.' })}</div>`}
    </div>`;
}

/* ---------- F. Approval Delegation ---------- */
function delegatableRequests() {
  return actionableRequests().sort(byAsc('submittedAt'));
}

function delegationStatus(d) {
  const today = toDateInput(new Date());
  if (d.startDate > today) return ['Scheduled', 'bg-sky-50 text-sky-700 ring-sky-600/25'];
  if (d.endDate < today) return ['Expired', 'bg-slate-100 text-slate-600 ring-slate-500/20'];
  return ['Active', 'bg-emerald-50 text-emerald-700 ring-emerald-600/25'];
}

function renderDelegation(el, route) {
  const options = delegatableRequests();
  const preselect = route.query.get('req') || '';
  const selected = options.find((r) => r.id === preselect) || null;
  if (preselect && !selected) toast(`${preselect} can’t be delegated in the current role.`, 'warning');
  const today = toDateInput(new Date());
  const visibleLog = state.delegations.filter((d) => {
    const r = getRequest(d.requestId);
    return r && isVisible(r);
  }).sort(byDesc('at'));

  el.innerHTML = `
    ${flashHTML('delegation')}
    <div class="grid gap-6 xl:grid-cols-5">
      <form id="delegationForm" data-form="delegation" novalidate class="${UI.card} xl:col-span-2">
        ${cardHeader('Delegate an approval', { icon: 'forward', subtitle: 'The delegate becomes the current approver and is notified immediately.' })}
        ${options.length ? `
        <div class="space-y-5 p-5">
          ${selectField({ id: 'del-request', name: 'requestId', label: 'Request ID', required: true, value: selected ? selected.id : '', placeholder: 'Select a request', options: options.map((r) => ({ value: r.id, label: `${r.id} – ${r.title}` })) })}
          ${inputField({ id: 'del-current', name: 'currentApprover', label: 'Current Approver', value: selected ? userName(selected.approverId) : '', readonly: true, placeholder: 'Select a request first' })}
          <div id="del-to-wrap">${delegateToFieldHTML(selected)}</div>
          <div class="grid gap-5 sm:grid-cols-2">
            ${inputField({ id: 'del-start', name: 'startDate', label: 'Start Date', type: 'date', required: true, value: today, min: today })}
            ${inputField({ id: 'del-end', name: 'endDate', label: 'End Date', type: 'date', required: true, value: toDateInput(addDays(new Date(), 7)), min: today })}
          </div>
          ${textareaField({ id: 'del-reason', name: 'reason', label: 'Reason', required: true, rows: 3, maxlength: 500, placeholder: 'e.g. On leave next week; Meena owns this vendor relationship.' })}
        </div>
        <div class="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
          <button type="reset" class="${btnClass('secondary')}">Clear</button>
          <button type="submit" class="${btnClass('primary')}"><i data-lucide="forward" class="size-4"></i> Delegate approval</button>
        </div>` : emptyStateHTML({ icon: 'forward', title: 'Nothing to delegate', text: 'Only open requests currently assigned to you can be delegated.' })}
      </form>

      <section class="${UI.card} overflow-hidden xl:col-span-3" aria-labelledby="del-log">
        ${cardHeader('Delegation log', { id: 'del-log', icon: 'history', subtitle: pluralize(visibleLog.length, 'delegation') })}
        ${visibleLog.length ? `<div class="overflow-x-auto"><table class="min-w-[640px] w-full divide-y divide-slate-200 text-sm">
          <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>
            <th scope="col" class="px-4 py-3">Request</th><th scope="col" class="px-4 py-3">From → To</th><th scope="col" class="px-4 py-3">Period</th><th scope="col" class="px-4 py-3">Status</th></tr></thead>
          <tbody class="divide-y divide-slate-100">${visibleLog.map((d) => {
            const [label, cls] = delegationStatus(d);
            return `<tr class="align-top">
              <td class="px-4 py-3"><a href="#/request/${esc(d.requestId)}" class="font-mono text-xs font-medium text-indigo-600 hover:underline">${esc(d.requestId)}</a>
                <p class="mt-1 line-clamp-2 max-w-[16rem] text-xs text-slate-500" title="${esc(d.reason)}">${esc(d.reason)}</p></td>
              <td class="px-4 py-3"><span class="text-slate-800">${esc(userName(d.fromId))}</span> <i data-lucide="arrow-right" class="inline size-3.5 text-slate-400"></i> <span class="font-medium text-slate-900">${esc(userName(d.toId))}</span>
                <p class="text-xs text-slate-500">by ${esc(userName(d.byId))}, ${fmtDate(d.at)}</p></td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-600">${fmtDate(d.startDate)} – ${fmtDate(d.endDate)}</td>
              <td class="px-4 py-3"><span class="inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${cls}">${label}</span></td></tr>`;
          }).join('')}</tbody></table></div>` : emptyStateHTML({ icon: 'history', title: 'No delegations yet' })}
      </section>
    </div>`;
  $$('[data-counter]', el).forEach(updateCounter);
}

function delegateToFieldHTML(req) {
  const candidates = approverUsers().filter((u) => !req || u.id !== req.approverId);
  return selectField({
    id: 'del-to', name: 'toId', label: 'Delegate To', required: true,
    placeholder: req ? 'Select an approver' : 'Select a request first',
    options: candidates.map((u) => ({ value: u.id, label: `${u.name} – ${u.department}` })),
    hint: 'Only users with the Approver role are listed.',
  });
}

function updateDelegationCurrent() {
  const req = getRequest($('#del-request').value);
  $('#del-current').value = req ? userName(req.approverId) : '';
  $('#del-to-wrap').innerHTML = delegateToFieldHTML(req);
}

function handleDelegationSubmit(form) {
  const errors = validateForm(form, {
    requestId: [rules.required('Request')],
    toId: [rules.required('Delegate')],
    startDate: [rules.required('Start date')],
    endDate: [rules.required('End date')],
    reason: [rules.required('Reason'), rules.minLength(10, 'Reason')],
  }, (f) => {
    const start = f.elements.startDate.value;
    const end = f.elements.endDate.value;
    const today = toDateInput(new Date());
    const req = getRequest(f.elements.requestId.value);
    return {
      startDate: start && start < today ? 'Start date can’t be in the past.' : '',
      endDate: start && end && end < start ? 'End date must be on or after the start date.' : '',
      toId: req && f.elements.toId.value === req.approverId ? 'Choose someone other than the current approver.' : '',
    };
  });
  if (Object.keys(errors).length) return;
  const data = {
    requestId: form.elements.requestId.value,
    toId: form.elements.toId.value,
    startDate: form.elements.startDate.value,
    endDate: form.elements.endDate.value,
    reason: form.elements.reason.value,
  };
  confirmDialog({
    title: `Delegate ${data.requestId}?`,
    message: `${esc(userName(data.toId))} will become the approver from ${fmtDate(data.startDate)} to ${fmtDate(data.endDate)}.`,
    confirmLabel: 'Delegate',
    icon: 'forward',
    iconTone: 'violet',
    onConfirm: () => {
      // Drop any ?req= preselection first: once delegated it is no longer selectable.
      history.replaceState(null, '', '#/delegation');
      const req = runAction(() => delegateRequest(data), `${data.requestId} delegated to ${userName(data.toId)}.`);
      if (req) {
        setFlash('delegation', 'success', 'Approval delegated', `${esc(req.id)} is now assigned to ${esc(userName(req.approverId))}. The requester and delegate were notified.`);
        renderApp();
      }
    },
  });
}

/* ---------- E. Notifications ---------- */
function notificationItemHTML(n, { compact = false } = {}) {
  const t = NOTIF_TYPES[n.type] || NOTIF_TYPES.system;
  return `<li class="relative flex gap-3 px-4 py-3 ${n.read ? '' : 'notif-unread'} ${compact ? '' : 'sm:px-5 sm:py-4'}">
    <span class="grid size-9 shrink-0 place-items-center rounded-full ${t.tone}"><i data-lucide="${t.icon}" class="size-4"></i></span>
    <div class="min-w-0 flex-1">
      <button type="button" data-action="open-notification" data-id="${esc(n.id)}" class="block w-full text-left focus-visible:outline-2 focus-visible:outline-indigo-600">
        <span class="flex items-center gap-2"><span class="truncate text-sm ${n.read ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'}">${esc(n.title)}</span>
          ${n.read ? '' : '<span class="size-2 shrink-0 rounded-full bg-indigo-600" aria-label="Unread"></span>'}</span>
        <span class="mt-0.5 block text-sm text-slate-600 ${compact ? 'line-clamp-2' : ''}">${esc(n.message)}</span>
      </button>
      <p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <time datetime="${esc(n.at)}" title="${fmtDateTime(n.at)}">${timeAgo(n.at)}</time>
        ${compact ? '' : `<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">${esc(t.label)}</span>`}
        ${!compact && !n.read ? `<button type="button" class="font-medium text-indigo-600 hover:underline" data-action="mark-read" data-id="${esc(n.id)}">Mark as read</button>` : ''}
      </p>
    </div></li>`;
}

function renderNotifications(el) {
  const all = myNotifications();
  const unread = all.filter((n) => !n.read).length;
  let list = ui.notifFilter === 'unread' ? all.filter((n) => !n.read) : all;
  if (ui.notifType) list = list.filter((n) => n.type === ui.notifType);
  const types = Object.entries(NOTIF_TYPES).filter(([k]) => all.some((n) => n.type === k));

  el.innerHTML = `
    ${flashHTML('notifications')}
    <section class="${UI.card} mx-auto max-w-4xl overflow-hidden" aria-label="Notifications">
      <div class="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Notification filter">
          ${[['all', 'All', all.length], ['unread', 'Unread', unread]].map(([k, label, n]) => `<button type="button" role="tab" aria-selected="${ui.notifFilter === k}" data-action="notif-filter" data-filter-value="${k}"
            class="rounded-md px-3 py-1.5 text-sm font-medium ${ui.notifFilter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">${label} <span class="ml-1 text-xs text-slate-500">${n}</span></button>`).join('')}
        </div>
        <div class="flex items-center gap-2">
          <label for="notif-type" class="sr-only">Filter by type</label>
          <select id="notif-type" data-notif-type class="${UI.select} sm:w-44"><option value="">All types</option>${types.map(([k, t]) => `<option value="${k}" ${ui.notifType === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          <button type="button" class="${btnClass('secondary')} shrink-0" data-action="mark-all-read" ${unread ? '' : 'disabled'}><i data-lucide="check-check" class="size-4"></i> Mark all as read</button>
        </div>
      </div>
      <ul class="divide-y divide-slate-100">${list.map((n) => notificationItemHTML(n)).join('')
        || `<li>${emptyStateHTML({ icon: 'bell-off', title: ui.notifFilter === 'unread' ? 'No unread notifications' : 'No notifications', text: ui.notifFilter === 'unread' ? 'You’re all caught up.' : 'Activity on your requests will appear here.' })}</li>`}</ul>
    </section>`;
}

/* ---------- I. Group / User Management ---------- */
function renderAdmin(el) {
  const tabs = [['users', 'Users', state.users.length, 'users'], ['groups', 'Recipient Groups', state.groups.length, 'building-2']];
  el.innerHTML = `
    ${flashHTML('admin')}
    ${alertHTML('info', 'Demo administration', 'Changes are stored in this browser only. Role assignments here drive the demo UI; they are not a security mechanism.')}
    <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Administration sections">
        ${tabs.map(([k, label, n, icon]) => `<button type="button" role="tab" aria-selected="${ui.adminTab === k}" data-action="admin-tab" data-tab="${k}"
          class="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium ${ui.adminTab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"><i data-lucide="${icon}" class="size-4"></i>${label}<span class="rounded-full bg-slate-200/80 px-1.5 text-xs text-slate-700">${n}</span></button>`).join('')}
      </div>
      ${ui.adminTab === 'users'
        ? `<button type="button" class="${btnClass('primary')}" data-action="add-user"><i data-lucide="user-plus" class="size-4"></i> Add user</button>`
        : `<button type="button" class="${btnClass('primary')}" data-action="create-group"><i data-lucide="folder-plus" class="size-4"></i> Create group</button>`}
    </div>
    <div role="tabpanel">${ui.adminTab === 'users' ? usersPanelHTML() : groupsPanelHTML()}</div>`;
  if (ui.adminTab === 'users') renderUsersTable();
}

function usersPanelHTML() {
  return `<section class="${UI.card} overflow-hidden" aria-label="Users">
    <div class="border-b border-slate-200 p-4"><div class="relative max-w-md">
      <label for="user-search" class="sr-only">Search users</label>
      <i data-lucide="search" class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"></i>
      <input id="user-search" type="search" data-user-search value="${esc(ui.userSearch)}" placeholder="Search name, email, role, department…" class="${UI.input} pl-9"></div></div>
    <div class="overflow-x-auto"><table class="min-w-[720px] w-full divide-y divide-slate-200 text-sm">
      <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>
        <th scope="col" class="px-4 py-3">User</th><th scope="col" class="px-4 py-3">Role</th><th scope="col" class="px-4 py-3">Department</th><th scope="col" class="px-4 py-3">Approver for</th><th scope="col" class="px-4 py-3 text-right">Requests</th></tr></thead>
      <tbody id="usersTableBody" class="divide-y divide-slate-100"></tbody></table></div>
  </section>`;
}

function renderUsersTable() {
  const body = $('#usersTableBody');
  if (!body) return;
  const q = ui.userSearch.trim().toLowerCase();
  const roleTone = { Requester: 'bg-slate-100 text-slate-700', Approver: 'bg-indigo-50 text-indigo-700', Admin: 'bg-amber-50 text-amber-800' };
  const personaIds = Object.values(ROLES).map((r) => r.personaId);
  const rows = state.users.filter((u) => !q || [u.name, u.email, u.role, u.department].some((v) => String(v).toLowerCase().includes(q)));
  body.innerHTML = rows.length ? rows.map((u) => {
    const groups = state.groups.filter((g) => g.approverIds.includes(u.id));
    return `<tr>
      <td class="px-4 py-3"><div class="flex items-center gap-3">${avatarHTML(u, 'sm')}<div class="min-w-0"><p class="flex items-center gap-2 font-medium text-slate-900">${esc(u.name)}${personaIds.includes(u.id) ? '<span class="rounded bg-indigo-600/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">Demo persona</span>' : ''}</p><p class="truncate text-xs text-slate-500">${esc(u.email)}</p></div></div></td>
      <td class="px-4 py-3"><span class="rounded-full px-2.5 py-1 text-xs font-medium ${roleTone[u.role]}">${esc(u.role)}</span></td>
      <td class="px-4 py-3 text-slate-600">${esc(u.department || '—')}</td>
      <td class="px-4 py-3 text-slate-600">${groups.length ? groups.map((g) => `<span class="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs">${esc(g.name)}${g.approverIds[0] === u.id ? ' ★' : ''}</span>`).join('') : '<span class="text-slate-400">—</span>'}</td>
      <td class="px-4 py-3 text-right font-medium text-slate-700">${state.requests.filter((r) => r.requesterId === u.id).length}</td></tr>`;
  }).join('') : `<tr><td colspan="5">${emptyStateHTML({ icon: 'search', title: 'No users match your search' })}</td></tr>`;
  refreshIcons();
}

function groupsPanelHTML() {
  if (!state.groups.length) return `<div class="${UI.card}">${emptyStateHTML({ icon: 'building-2', title: 'No recipient groups yet' })}</div>`;
  return `<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${state.groups.map((g) => {
    const reqs = state.requests.filter((r) => r.groupId === g.id);
    const open = reqs.filter((r) => ACTIONABLE_STATUSES.includes(r.status)).length;
    return `<article class="${UI.card} flex flex-col p-5" aria-labelledby="grp-${esc(g.id)}">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-3"><span class="grid size-10 place-items-center rounded-lg bg-indigo-50 text-indigo-600"><i data-lucide="building-2" class="size-5"></i></span>
          <div><h2 id="grp-${esc(g.id)}" class="font-semibold text-slate-900">${esc(g.name)}</h2><p class="text-xs text-slate-500">${pluralize(reqs.length, 'request')} · ${open} open</p></div></div>
      </div>
      <p class="mt-3 flex-1 text-sm text-slate-600">${esc(g.description || 'No description.')}</p>
      <div class="mt-4">
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Approvers</p>
        <ul class="mt-2 space-y-1.5">${g.approverIds.length ? g.approverIds.map((id, i) => `<li class="flex items-center justify-between text-sm">${personHTML(id)}${i === 0 ? '<span class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">Primary</span>' : ''}</li>`).join('') : '<li class="text-sm text-rose-600">No approvers assigned – requests can’t be routed.</li>'}</ul>
      </div>
      <button type="button" class="${btnClass('secondary')} mt-5 w-full" data-action="assign-approvers" data-id="${esc(g.id)}"><i data-lucide="user-round-cog" class="size-4"></i> Assign approvers</button>
    </article>`;
  }).join('')}</div>`;
}

function approverPickerHTML(selectedIds = [], primaryId = '') {
  const candidates = approverUsers();
  if (!candidates.length) return '<p class="text-sm text-slate-500">Add a user with the Approver role first.</p>';
  return `<fieldset aria-describedby="approvers-hint approvers-error">
    <legend class="${UI.label}">Approvers <span class="text-rose-600" aria-hidden="true">*</span></legend>
    <p id="approvers-hint" class="mb-2 text-xs text-slate-500">Tick everyone who can approve for this group and choose the primary approver, who receives new requests first.</p>
    <ul class="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">${candidates.map((u) => `
      <li class="flex items-center gap-3 px-3 py-2.5">
        <input type="checkbox" id="ap-${esc(u.id)}" name="approvers" value="${esc(u.id)}" ${selectedIds.includes(u.id) ? 'checked' : ''} class="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600">
        <label for="ap-${esc(u.id)}" class="min-w-0 flex-1 cursor-pointer">${personHTML(u.id, u.department)}</label>
        <label class="flex items-center gap-1.5 text-xs text-slate-600"><input type="radio" name="primary" value="${esc(u.id)}" ${primaryId === u.id ? 'checked' : ''} class="size-3.5 border-slate-300 text-indigo-600 focus:ring-indigo-600"> Primary</label>
      </li>`).join('')}</ul>
    <p id="approvers-error" class="field-error" data-error-for="approvers" hidden></p>
  </fieldset>`;
}

/** Read and validate the approver picker. Returns ordered ids (primary first) or null. */
function readApproverPicker(form) {
  const ids = $$('input[name="approvers"]:checked', form).map((i) => i.value);
  const primaryEl = $('input[name="primary"]:checked', form);
  let primary = primaryEl ? primaryEl.value : '';
  let error = '';
  if (!ids.length) error = 'Select at least one approver.';
  else if (!primary && ids.length === 1) primary = ids[0];
  else if (!primary) error = 'Choose which approver is primary.';
  else if (!ids.includes(primary)) error = 'The primary approver must also be ticked as an approver.';
  setFieldError(form, 'approvers', error);
  refreshIcons();
  if (error) return null;
  return [primary, ...ids.filter((id) => id !== primary)];
}

function openAddUserModal() {
  openModal({
    title: 'Add user',
    description: 'New users are available immediately for groups and delegation.',
    icon: 'user-plus',
    body: `${inputField({ id: 'nu-name', name: 'name', label: 'Full name', required: true, placeholder: 'e.g. Lakshmi Narayan', autocomplete: 'name' })}
      ${inputField({ id: 'nu-email', name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'name@easyapprove.demo', autocomplete: 'email' })}
      <div class="grid gap-4 sm:grid-cols-2">
        ${selectField({ id: 'nu-role', name: 'role', label: 'Role', required: true, options: ALL_ROLES.map((r) => ({ value: r, label: r })), value: 'Requester', placeholder: '' })}
        ${inputField({ id: 'nu-dept', name: 'department', label: 'Department', placeholder: 'e.g. Pharmacy' })}
      </div>`,
    confirmLabel: 'Add user',
    onConfirm: (form) => {
      const errors = validateForm(form, {
        name: [rules.required('Full name'), rules.minLength(3, 'Full name')],
        email: [rules.required('Email'), rules.email()],
        role: [rules.required('Role')],
      }, (f) => ({ email: state.users.some((u) => u.email === f.elements.email.value.trim().toLowerCase()) ? 'A user with this email already exists.' : '' }));
      if (Object.keys(errors).length) return false;
      runAction(() => addUser({ name: form.elements.name.value, email: form.elements.email.value, role: form.elements.role.value, department: form.elements.department.value }), (u) => `${u.name} added as ${u.role}.`);
      return true;
    },
  });
}

function openCreateGroupModal() {
  openModal({
    title: 'Create recipient group',
    description: 'Groups appear in the Recipient Group dropdown when creating a request.',
    icon: 'folder-plus',
    size: 'lg',
    body: `${inputField({ id: 'ng-name', name: 'name', label: 'Group name', required: true, placeholder: 'e.g. Pharmacy & Therapeutics' })}
      ${textareaField({ id: 'ng-desc', name: 'description', label: 'Description', rows: 2, placeholder: 'What kinds of requests should go to this group?' })}
      ${approverPickerHTML()}`,
    confirmLabel: 'Create group',
    onConfirm: (form) => {
      const errors = validateForm(form, { name: [rules.required('Group name'), rules.minLength(2, 'Group name')] },
        (f) => ({ name: state.groups.some((g) => g.name.toLowerCase() === f.elements.name.value.trim().toLowerCase()) ? 'A group with this name already exists.' : '' }));
      const approvers = readApproverPicker(form);
      if (Object.keys(errors).length || !approvers) return false;
      ui.adminTab = 'groups';
      runAction(() => createGroup({ name: form.elements.name.value, description: form.elements.description.value, approverIds: approvers }), (g) => `Group “${g.name}” created.`);
      return true;
    },
  });
}

function openAssignApproversModal(groupId) {
  const group = getGroup(groupId);
  if (!group) return;
  openModal({
    title: `Assign approvers – ${group.name}`,
    description: 'Open requests stay with their current approver; new requests go to the primary approver.',
    icon: 'user-round-cog',
    size: 'lg',
    body: approverPickerHTML(group.approverIds, group.approverIds[0]),
    confirmLabel: 'Save approvers',
    onConfirm: (form) => {
      const approvers = readApproverPicker(form);
      if (!approvers) return false;
      runAction(() => setGroupApprovers(group.id, approvers), `Approvers updated for ${group.name}.`);
      return true;
    },
  });
}

/* =============================================================
   8. EVENT WIRING
   ============================================================= */
function gotoListWithStatus(status) {
  const key = state.role === 'Requester' ? 'mine' : 'approvals';
  Object.assign(getTableState(key), { status, search: '', group: '', mine: false, page: 1 });
  navigate(primaryListRoute());
}

/** Click handlers keyed by data-action. */
const ACTIONS = {
  'open-sidebar': () => openSidebar(),
  'close-sidebar': () => closeSidebar(),
  'reset-demo': () => resetDemo(),
  'toggle-notif-panel': () => toggleNotifPanel(),
  'search-all': () => searchAll(),
  'dismiss-alert': (el) => el.closest('[role="status"], [role="alert"]')?.remove(),

  'open-menu': (el) => openActionMenu(el),
  'view-request': (el) => navigate(`request/${el.dataset.id}`),
  approve: (el) => openApproveModal(el.dataset.id),
  reject: (el) => openRejectModal(el.dataset.id),
  clarify: (el) => openClarifyModal(el.dataset.id),
  delegate: (el) => { if (guardAction(el.dataset.id)) navigate(`delegation?req=${encodeURIComponent(el.dataset.id)}`); },
  respond: (el) => {
    const id = el.dataset.id;
    const box = document.getElementById(`reply-${id}`);
    if (box && ui.route.page === 'request') { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); box.focus({ preventScroll: true }); }
    else navigate(`request/${id}?focus=respond`);
  },
  'attachment-preview': (el) => openAttachmentPreview(el.dataset.id),
  'goto-list': (el) => gotoListWithStatus(el.dataset.status),

  sort: (el) => {
    const ts = getTableState(el.dataset.table);
    if (ts.sortKey === el.dataset.sort) ts.sortDir = ts.sortDir === 'asc' ? 'desc' : 'asc';
    else { ts.sortKey = el.dataset.sort; ts.sortDir = el.dataset.sort === 'submittedAt' ? 'desc' : 'asc'; }
    ts.page = 1;
    renderTableArea(el.dataset.table, `[data-action="sort"][data-sort="${el.dataset.sort}"]`);
  },
  page: (el) => {
    const ts = getTableState(el.dataset.table);
    ts.page = Number(el.dataset.page);
    renderTableArea(el.dataset.table, `[data-action="page"][data-page="${ts.page}"]`);
  },
  'clear-filters': (el) => {
    Object.assign(getTableState(el.dataset.table), { search: '', status: '', group: '', mine: false, page: 1 });
    renderApp();
  },
  'quick-status': (el) => {
    Object.assign(getTableState(el.dataset.table), { status: el.dataset.status, page: 1 });
    renderApp();
  },

  'open-notification': (el) => {
    const n = state.notifications.find((x) => x.id === el.dataset.id);
    if (!n) return;
    n.read = true;
    saveState();
    closeNotifPanel();
    if (n.requestId && getRequest(n.requestId)) navigate(`request/${n.requestId}`);
    else renderApp();
  },
  'mark-read': (el) => { markNotificationRead(el.dataset.id); commit('Notification marked as read.'); },
  'mark-all-read': () => { const n = unreadCount(); markAllNotificationsRead(); commit(`${pluralize(n, 'notification')} marked as read.`); },
  'notif-filter': (el) => { ui.notifFilter = el.dataset.filterValue; renderApp(); },

  'clar-tab': (el) => { ui.clarTab = el.dataset.tab; renderApp(); },
  'admin-tab': (el) => { ui.adminTab = el.dataset.tab; renderApp(); },
  'add-user': () => openAddUserModal(),
  'create-group': () => openCreateGroupModal(),
  'assign-approvers': (el) => openAssignApproversModal(el.dataset.id),

  'remove-attachment': () => {
    pendingAttachment = null;
    const input = $('#req-attachment');
    if (input) input.value = '';
    renderAttachmentChip();
    $('#req-attachment')?.focus();
  },
  'cancel-create': () => {
    if (!isCreateFormDirty()) { navigate('dashboard'); return; }
    confirmDialog({
      title: 'Discard this request?',
      message: 'The information you entered will be lost.',
      confirmLabel: 'Discard',
      tone: 'danger',
      icon: 'trash-2',
      iconTone: 'rose',
      onConfirm: () => { pendingAttachment = null; navigate('dashboard'); toast('Draft discarded.', 'info'); },
    });
  },
};

/** Submit handlers keyed by data-form. */
const FORMS = {
  'create-request': handleCreateSubmit,
  delegation: handleDelegationSubmit,
  comment: (form) => {
    const errors = validateForm(form, { text: [rules.required('Comment')] });
    if (Object.keys(errors).length) return;
    runAction(() => addComment(form.dataset.id, form.elements.text.value), 'Comment posted.');
  },
  'clarify-reply': (form) => {
    const errors = validateForm(form, { text: [rules.required('Your response'), rules.minLength(3, 'Your response')] });
    if (Object.keys(errors).length) return;
    runAction(() => respondClarification(form.dataset.id, form.elements.text.value), (r) => `Response sent. ${r.id} is back with ${userName(r.approverId)}.`);
  },
  'clarify-ask': (form) => {
    const errors = validateForm(form, { text: [rules.required('Your question'), rules.minLength(5, 'Your question')] });
    if (Object.keys(errors).length) return;
    if (!guardAction(form.dataset.id)) return;
    runAction(() => requestClarification(form.dataset.id, form.elements.text.value), (r) => `Clarification requested on ${r.id}.`);
  },
};

function onDocumentClick(e) {
  const target = e.target;
  // Close floating UI when clicking outside of it.
  if (!target.closest('#actionMenu') && !target.closest('[data-action="open-menu"]')) closeActionMenu();
  if (!target.closest('#notifPanel') && !target.closest('#notifBell')) closeNotifPanel();
  if (!target.closest('#globalSearchWrap')) closeGlobalSearch();
  if (target.closest('#globalSearchResults a')) { closeGlobalSearch(); $('#globalSearch').value = ''; }
  if (target.closest('#sidebarNav a')) closeSidebar();

  const el = target.closest('[data-action]');
  if (!el || el.disabled || el.closest('#modalRoot')) return;
  const handler = ACTIONS[el.dataset.action];
  if (!handler) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
  if (el.closest('#actionMenu')) closeActionMenu();
  handler(el, e);
}

function onDocumentInput(e) {
  const t = e.target;
  if (t.matches('[data-filter]')) {
    const ts = getTableState(t.dataset.table);
    ts[t.dataset.filter] = t.type === 'checkbox' ? t.checked : t.value;
    ts.page = 1;
    if (t.dataset.filter === 'search') renderTableArea(t.dataset.table);
    else {
      const id = t.id;
      const selector = id ? `#${id}` : `[data-filter="${t.dataset.filter}"][data-table="${t.dataset.table}"]`;
      renderApp();
      $(selector)?.focus();
    }
    return;
  }
  if (t.id === 'globalSearch') { renderGlobalSearch(t.value); return; }
  if (t.matches('[data-user-search]')) { ui.userSearch = t.value; renderUsersTable(); return; }
  if (t.matches('[data-counter]')) updateCounter(t);
  if (t.id === 'req-group') updateRoutingPreview();
  if (t.id === 'del-request') updateDelegationCurrent();
  // Clear a field's error as soon as the user edits it.
  if (t.form && t.getAttribute('aria-invalid') === 'true') { setFieldError(t.form, t.name, ''); }
}

function onDocumentChange(e) {
  const t = e.target;
  if (t.id === 'roleSwitcher') switchRole(t.value);
  else if (t.id === 'req-attachment') handleAttachmentFile(t.files && t.files[0]);
  else if (t.matches('[data-notif-type]')) { ui.notifType = t.value; renderApp(); }
  else if (t.name === 'approvers' || t.name === 'primary') {
    // Ticking "primary" also ticks the approver checkbox.
    if (t.name === 'primary') { const cb = document.getElementById(`ap-${t.value}`); if (cb) cb.checked = true; }
    if (t.form) setFieldError(t.form, 'approvers', '');
  }
}

function onDocumentSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const handler = FORMS[form.dataset.form];
  if (handler) handler(form);
}

function onDocumentReset(e) {
  const form = e.target;
  if (form.id === 'delegationForm') {
    setTimeout(() => { clearErrors(form); updateDelegationCurrent(); $$('[data-counter]', form).forEach(updateCounter); history.replaceState(null, '', '#/delegation'); }, 0);
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    if ($('#modalRoot').innerHTML) { closeModal(); return; }
    if (!$('#actionMenu').hidden) { closeActionMenu(true); return; }
    if (!$('#notifPanel').hidden) { closeNotifPanel(); $('#notifBell').focus(); return; }
    if (!$('#globalSearchResults').hidden) { closeGlobalSearch(); return; }
    closeSidebar();
    return;
  }
  if (e.key === 'Tab' && $('#modalRoot').innerHTML) trapModalFocus(e);
  if (e.target.closest && e.target.closest('#actionMenu')) onMenuKeydown(e);
  if (e.target.id === 'globalSearch') {
    if (e.key === 'Enter') { e.preventDefault(); if (e.target.value.trim()) searchAll(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('#globalSearchResults .search-hit')?.focus(); }
  } else if (e.target.closest && e.target.closest('#globalSearchResults') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const hits = $$('#globalSearchResults .search-hit');
    const i = hits.indexOf(e.target);
    if (e.key === 'ArrowDown') hits[Math.min(i + 1, hits.length - 1)]?.focus();
    else if (i <= 0) $('#globalSearch').focus();
    else hits[i - 1].focus();
  }
}

function wireDropzone() {
  document.addEventListener('dragover', (e) => {
    const zone = e.target.closest && e.target.closest('[data-dropzone]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('is-dragover');
  });
  document.addEventListener('dragleave', (e) => {
    const zone = e.target.closest && e.target.closest('[data-dropzone]');
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-dragover');
  });
  document.addEventListener('drop', (e) => {
    const zone = e.target.closest && e.target.closest('[data-dropzone]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('is-dragover');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) handleAttachmentFile(file);
  });
}

function wireEvents() {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('input', onDocumentInput);
  document.addEventListener('change', onDocumentChange);
  document.addEventListener('submit', onDocumentSubmit);
  document.addEventListener('reset', onDocumentReset);
  document.addEventListener('keydown', onKeydown);
  wireDropzone();
  window.addEventListener('hashchange', () => { closeSidebar(); closeNotifPanel(); closeModal({ restoreFocus: false }); renderApp({ focusMain: true }); });
  window.addEventListener('resize', () => { closeActionMenu(); if (window.innerWidth >= 1024) closeSidebar(); });
  window.addEventListener('scroll', () => closeActionMenu(), { passive: true });
  // Keep the UI in sync if the demo is open in two tabs.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue);
      if (isValidState(next)) { state = next; renderApp(); }
    } catch (err) { /* ignore */ }
  });
}

function init() {
  loadState();
  wireEvents();
  if (!location.hash) history.replaceState(null, '', '#/dashboard');
  renderApp();
  if (!storageAvailable) toast('Browser storage is unavailable – changes won’t survive a refresh.', 'warning', 8000);
}

document.addEventListener('DOMContentLoaded', init);

'use strict';

/* =============================================================================
   Easy Approve – Approval Management System (front-end prototype)
   Vanilla JS, no backend. Data lives in localStorage; the demo user lives in
   sessionStorage so two browser tabs can act as different roles at once.

   Sections
     1. Constants and utilities
     2. Domain workflow (state transitions + notifications)
     3. Seed data
     4. Persistence and session
     5. Selectors and permissions
     6. UI primitives (icons, toast, modal, menu, form fields)
     7. Views
     8. Router and page chrome
     9. Actions and event wiring
    10. Init
   ============================================================================= */

/* =============================================================================
   1. CONSTANTS AND UTILITIES
   ============================================================================= */

const STORAGE_KEY = 'easyApprove.prototype.v1';
const SESSION_KEY = 'easyApprove.session.userId';
const STATE_VERSION = 1;
const DEFAULT_USER_ID = 'u-arun';

const ROLES = Object.freeze({ requester: 'Requester', approver: 'Approver', admin: 'Admin' });

const STATUS = Object.freeze({
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CLARIFICATION: 'Clarification Requested',
  DELEGATED: 'Delegated',
});
const STATUS_LIST = Object.values(STATUS);
const ACTIONABLE = [STATUS.PENDING, STATUS.DELEGATED];
const OPEN_STATUSES = [STATUS.PENDING, STATUS.DELEGATED, STATUS.CLARIFICATION];

const STATUS_META = {
  [STATUS.PENDING]: { icon: 'clock', badge: 'bg-amber-50 text-amber-800 ring-amber-600/25', bar: 'bg-amber-400' },
  [STATUS.APPROVED]: { icon: 'circle-check', badge: 'bg-emerald-50 text-emerald-800 ring-emerald-600/25', bar: 'bg-emerald-500' },
  [STATUS.REJECTED]: { icon: 'circle-x', badge: 'bg-rose-50 text-rose-800 ring-rose-600/25', bar: 'bg-rose-500' },
  [STATUS.CLARIFICATION]: { icon: 'message-circle-question', badge: 'bg-sky-50 text-sky-800 ring-sky-600/25', bar: 'bg-sky-500' },
  [STATUS.DELEGATED]: { icon: 'users', badge: 'bg-violet-50 text-violet-800 ring-violet-600/25', bar: 'bg-violet-500' },
};

const NOTIF_META = {
  'new-request': { icon: 'inbox', tone: 'bg-brand-50 text-brand-700', label: 'New request' },
  approved: { icon: 'circle-check', tone: 'bg-emerald-50 text-emerald-700', label: 'Approved' },
  rejected: { icon: 'circle-x', tone: 'bg-rose-50 text-rose-700', label: 'Rejected' },
  'clarification-requested': { icon: 'message-circle-question', tone: 'bg-sky-50 text-sky-700', label: 'Clarification requested' },
  'clarification-response': { icon: 'message-square', tone: 'bg-sky-50 text-sky-700', label: 'Clarification response' },
  delegated: { icon: 'users', tone: 'bg-violet-50 text-violet-700', label: 'Delegated approval' },
};

const HISTORY_META = {
  submitted: { label: 'Request submitted', icon: 'send', tone: 'bg-brand-100 text-brand-700' },
  approved: { label: 'Approved', icon: 'circle-check', tone: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Rejected', icon: 'circle-x', tone: 'bg-rose-100 text-rose-700' },
  'clarification-requested': { label: 'Clarification requested', icon: 'message-circle-question', tone: 'bg-sky-100 text-sky-700' },
  'clarification-response': { label: 'Requester responded', icon: 'message-square', tone: 'bg-sky-100 text-sky-700' },
  delegated: { label: 'Approval delegated', icon: 'users', tone: 'bg-violet-100 text-violet-700' },
};

const ALL_ROLES = ['requester', 'approver', 'admin'];
const ROUTES = {
  dashboard: { title: 'Dashboard', icon: 'layout-dashboard', roles: ALL_ROLES },
  create: { title: 'Create Request', icon: 'file-plus-2', roles: ['requester'] },
  'my-requests': { title: 'My Requests', icon: 'files', roles: ['requester'] },
  approvals: { title: 'Approval List', icon: 'list-checks', roles: ['approver', 'admin'] },
  clarifications: { title: 'Clarifications', icon: 'message-circle-question', roles: ALL_ROLES },
  delegation: { title: 'Approval Delegation', icon: 'users', roles: ['approver'] },
  notifications: { title: 'Notifications', icon: 'bell', roles: ALL_ROLES },
  admin: { title: 'Groups & Users', icon: 'settings', roles: ['admin'] },
  details: { title: 'Request Details', icon: 'file-text', roles: ALL_ROLES },
};
const NAV_ORDER = ['dashboard', 'create', 'my-requests', 'approvals', 'clarifications', 'delegation', 'notifications', 'admin'];

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'txt'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const COLUMNS = [
  { key: 'id', label: 'Request ID', cls: '' },
  { key: 'title', label: 'Title', cls: '' },
  { key: 'requester', label: 'Requested By', cls: 'hidden lg:table-cell' },
  { key: 'group', label: 'Recipient Group', cls: 'hidden lg:table-cell' },
  { key: 'submittedAt', label: 'Submitted Date', cls: 'hidden lg:table-cell' },
  { key: 'status', label: 'Status', cls: '' },
];

const CLS = {
  btn: 'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:ring-brand-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
  input: 'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 read-only:bg-slate-50 read-only:text-slate-600',
  card: 'rounded-xl bg-white shadow-sm ring-1 ring-slate-200',
};
const btn = (variant = 'secondary', extra = '') => `${CLS.btn} ${CLS[variant]} ${extra}`.trim();

const AVATAR_TONES = [
  'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800',
  'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700',
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

let idCounter = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const nowISO = () => new Date().toISOString();
const pad2 = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const addDaysISO = (days) => isoDate(new Date(Date.now() + days * 86400000));

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatDate = (iso) => dateFmt.format(new Date(iso));
const formatDateTime = (iso) => dateTimeFmt.format(new Date(iso));
const formatDateOnly = (value) => {
  const [y, m, d] = String(value).split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
};

function timeAgo(iso) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const hashString = (str) => Array.from(String(str)).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const compareText = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
const idNumber = (id) => Number(String(id).replace(/\D/g, ''));

/* =============================================================================
   2. DOMAIN WORKFLOW
   Every function takes the state object, changes it and returns { ok, data|error }.
   An explicit `at` timestamp lets the seed data replay a realistic history.
   ============================================================================= */

const ok = (data) => ({ ok: true, data });
const fail = (error) => ({ ok: false, error });

const findRequest = (s, id) => s.requests.find((r) => r.id === id);

function addHistory(req, type, userId, note, at) {
  req.history.push({ id: uid('h'), type, userId, note: note || '', at });
  req.updatedAt = at;
}

function notify(s, recipientIds, type, req, actorId, at, meta = {}) {
  [...new Set(recipientIds)]
    .filter((userId) => userId && userId !== actorId)
    .forEach((userId) => {
      s.notifications.push({ id: uid('n'), userId, type, requestId: req.id, actorId, at, read: false, meta });
    });
}

function domainCreate(s, { title, description, groupId, requesterId, attachment = null }, at = nowISO()) {
  const group = s.groups.find((g) => g.id === groupId);
  if (!group) return fail('Choose a valid recipient group.');
  if (!group.approverIds.length) return fail(`${group.name} has no approvers yet. Ask an admin to assign one.`);
  const req = {
    id: `REQ-${s.nextRequestNumber++}`,
    title, description, groupId, requesterId, attachment,
    status: STATUS.PENDING,
    submittedAt: at, updatedAt: at,
    delegatedTo: null, delegations: [], clarifications: [], comments: [], history: [],
  };
  s.requests.push(req);
  addHistory(req, 'submitted', requesterId, `Sent to ${group.name}`, at);
  notify(s, group.approverIds, 'new-request', req, requesterId, at);
  return ok(req);
}

function domainApprove(s, id, actorId, note, at = nowISO()) {
  const req = findRequest(s, id);
  if (!req || !ACTIONABLE.includes(req.status)) return fail('This request can no longer be approved.');
  req.status = STATUS.APPROVED;
  addHistory(req, 'approved', actorId, note, at);
  notify(s, [req.requesterId], 'approved', req, actorId, at);
  return ok(req);
}

function domainReject(s, id, actorId, reason, at = nowISO()) {
  const req = findRequest(s, id);
  if (!req || !ACTIONABLE.includes(req.status)) return fail('This request can no longer be rejected.');
  if (!String(reason || '').trim()) return fail('A reason is required to reject a request.');
  req.status = STATUS.REJECTED;
  addHistory(req, 'rejected', actorId, reason, at);
  notify(s, [req.requesterId], 'rejected', req, actorId, at);
  return ok(req);
}

function domainClarify(s, id, actorId, question, at = nowISO()) {
  const req = findRequest(s, id);
  if (!req || !ACTIONABLE.includes(req.status)) return fail('Clarification can only be requested on an open request.');
  req.status = STATUS.CLARIFICATION;
  req.clarifications.push({ id: uid('c'), userId: actorId, kind: 'question', text: question, at });
  addHistory(req, 'clarification-requested', actorId, question, at);
  notify(s, [req.requesterId], 'clarification-requested', req, actorId, at);
  return ok(req);
}

function domainRespond(s, id, actorId, text, at = nowISO()) {
  const req = findRequest(s, id);
  if (!req || req.status !== STATUS.CLARIFICATION) return fail('There is no open clarification question to answer.');
  const lastQuestion = [...req.clarifications].reverse().find((m) => m.kind === 'question');
  req.clarifications.push({ id: uid('c'), userId: actorId, kind: 'response', text, at });
  req.status = req.delegatedTo ? STATUS.DELEGATED : STATUS.PENDING;
  addHistory(req, 'clarification-response', actorId, text, at);
  notify(s, [lastQuestion && lastQuestion.userId], 'clarification-response', req, actorId, at);
  return ok(req);
}

function domainDelegate(s, id, actorId, { toId, start, end, reason }, at = nowISO()) {
  const req = findRequest(s, id);
  if (!req || !ACTIONABLE.includes(req.status)) return fail('Only open requests can be delegated.');
  const delegate = s.users.find((u) => u.id === toId);
  if (!delegate || delegate.role !== 'approver') return fail('Choose a valid approver to delegate to.');
  if (toId === actorId) return fail('You cannot delegate a request to yourself.');
  req.delegatedTo = toId;
  req.status = STATUS.DELEGATED;
  req.delegations.push({ id: uid('d'), fromId: actorId, toId, start, end, reason, at });
  addHistory(req, 'delegated', actorId, `Delegated to ${delegate.name} (${formatDateOnly(start)} – ${formatDateOnly(end)}). ${reason}`, at);
  notify(s, [toId, req.requesterId], 'delegated', req, actorId, at, { toId });
  return ok(req);
}

function domainComment(s, id, userId, text, at = nowISO()) {
  const req = findRequest(s, id);
  if (!req) return fail('Request not found.');
  req.comments.push({ id: uid('cm'), userId, text, at });
  req.updatedAt = at;
  return ok(req);
}

function domainAddUser(s, { name, email, role, title }) {
  const user = { id: uid('u'), name, email, role, title: title || '' };
  s.users.push(user);
  return ok(user);
}

function domainAddGroup(s, { name, approverId }) {
  const group = { id: uid('g'), name, approverIds: approverId ? [approverId] : [] };
  s.groups.push(group);
  return ok(group);
}

function domainAssignApprover(s, groupId, userId) {
  const group = s.groups.find((g) => g.id === groupId);
  const user = s.users.find((u) => u.id === userId);
  if (!group || !user || user.role !== 'approver') return fail('Only users with the Approver role can be assigned.');
  if (!group.approverIds.includes(userId)) group.approverIds.push(userId);
  return ok(group);
}

function domainRemoveApprover(s, groupId, userId) {
  const group = s.groups.find((g) => g.id === groupId);
  if (!group) return fail('Group not found.');
  group.approverIds = group.approverIds.filter((id) => id !== userId);
  return ok(group);
}

/* =============================================================================
   3. SEED DATA
   Built by replaying the real workflow functions with past timestamps, so the
   history and notifications always match what the app itself would create.
   ============================================================================= */

function createSeedState() {
  const now = Date.now();
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
  const day = (hoursAgo, plusDays = 0) => isoDate(new Date(now - hoursAgo * 3600000 + plusDays * 86400000));

  const s = {
    version: STATE_VERSION,
    nextRequestNumber: 1001,
    users: [
      { id: 'u-arun', name: 'Arun Kumar', email: 'arun.kumar@easyapprove.demo', role: 'requester', title: 'Project Coordinator' },
      { id: 'u-divya', name: 'Divya Lakshmi', email: 'divya.lakshmi@easyapprove.demo', role: 'requester', title: 'Hospital Administrator' },
      { id: 'u-prasath', name: 'Prasath R', email: 'prasath.r@easyapprove.demo', role: 'approver', title: 'Senior Manager' },
      { id: 'u-kavitha', name: 'Kavitha S', email: 'kavitha.s@easyapprove.demo', role: 'approver', title: 'Hospital Director' },
      { id: 'u-rajesh', name: 'Rajesh Menon', email: 'rajesh.menon@easyapprove.demo', role: 'approver', title: 'Chief of Staff' },
      { id: 'u-meena', name: 'Meena Iyer', email: 'meena.iyer@easyapprove.demo', role: 'admin', title: 'System Administrator' },
    ],
    groups: [
      { id: 'g-srmt', name: 'SRMT', approverIds: ['u-prasath'] },
      { id: 'g-federal', name: 'Federal', approverIds: ['u-prasath', 'u-rajesh'] },
      { id: 'g-hospital', name: 'Hospital', approverIds: ['u-kavitha'] },
      { id: 'g-president', name: 'President Office', approverIds: ['u-rajesh'] },
    ],
    requests: [],
    notifications: [],
  };

  const create = (hoursAgo, data) => domainCreate(s, data, at(hoursAgo)).data.id;

  const r1 = create(3, {
    title: 'Q4 Budget Revision for Campus Expansion', groupId: 'g-srmt', requesterId: 'u-arun',
    description: 'Requesting approval to reallocate ₹18.5 lakh from the facilities reserve to the campus expansion project for Q4. The supporting cost breakdown is attached.',
    attachment: { name: 'Q4_Budget_Revision.xlsx', size: 184320 },
  });
  domainComment(s, r1, 'u-prasath', 'Reviewing the cost breakdown today.', at(2));

  const r2 = create(100, {
    title: 'Vendor Contract Renewal – Facility Management', groupId: 'g-srmt', requesterId: 'u-arun',
    description: 'The current facility management contract expires next month. Please approve the 12-month renewal at the negotiated rate.',
    attachment: { name: 'FM_Contract_2027.pdf', size: 912384 },
  });
  domainApprove(s, r2, 'u-prasath', 'Terms are in line with the previous year. Approved.', at(76));

  const r3 = create(8, {
    title: 'MRI Service Kit Purchase', groupId: 'g-hospital', requesterId: 'u-divya',
    description: 'Purchase of the annual MRI service kit from the authorised vendor. The quotation is attached for reference.',
    attachment: { name: 'MRI_Quote_Siemens.pdf', size: 402600 },
  });
  domainComment(s, r3, 'u-divya', 'The vendor quote is valid until 31 October.', at(7));

  const r4 = create(70, {
    title: 'Visiting Faculty Travel Authorization', groupId: 'g-federal', requesterId: 'u-arun',
    description: 'Travel authorization for two visiting faculty members attending the joint research workshop next quarter.',
  });
  domainReject(s, r4, 'u-rajesh', 'Overseas travel is on hold until the Q1 budget review. Please resubmit in January.', at(40));

  const r5 = create(30, {
    title: 'Remote Work Policy Update', groupId: 'g-president', requesterId: 'u-arun',
    description: 'Proposed update to the remote work guidelines, adding a two-day hybrid option for administrative staff.',
    attachment: { name: 'Remote_Work_Policy_v3.docx', size: 96256 },
  });
  domainClarify(s, r5, 'u-rajesh', 'Which departments does the revised policy apply to, and from what date?', at(20));

  const r6 = create(140, {
    title: 'Emergency Generator Maintenance', groupId: 'g-hospital', requesterId: 'u-divya',
    description: 'Unscheduled maintenance for the backup generator serving the ICU wing. Technician visit is booked for this week.',
  });
  domainApprove(s, r6, 'u-kavitha', 'Approved – safety critical.', at(120));

  const r7 = create(52, {
    title: 'New Lab Access Cards', groupId: 'g-srmt', requesterId: 'u-arun',
    description: 'Issue 25 new access cards for the research lab. The list of staff and access levels is attached.',
    attachment: { name: 'Lab_Access_List.xlsx', size: 51200 },
  });
  domainDelegate(s, r7, 'u-prasath', {
    toId: 'u-rajesh', start: day(26), end: day(26, 7), reason: 'I am on leave this week, please review on my behalf.',
  }, at(26));

  create(6, {
    title: 'Annual Audit Engagement Letter', groupId: 'g-federal', requesterId: 'u-divya',
    description: 'Engagement letter from the external auditors for the coming financial year. Needs sign-off before the end of the month.',
    attachment: { name: 'Audit_Engagement_Letter.docx', size: 143360 },
  });

  create(15, {
    title: 'Scholarship Fund Disbursement – Batch 3', groupId: 'g-president', requesterId: 'u-divya',
    description: 'Disbursement of the third scholarship batch to 42 verified students, totalling ₹21 lakh.',
  });

  create(22, {
    title: 'Pharmacy Inventory Software License', groupId: 'g-hospital', requesterId: 'u-arun',
    description: 'Annual license renewal for the pharmacy inventory system, covering 12 workstations.',
  });

  const r11 = create(200, {
    title: 'Healthcare Summit Sponsorship', groupId: 'g-federal', requesterId: 'u-arun',
    description: 'Silver sponsorship package for the regional healthcare summit, including two delegate passes.',
  });
  domainApprove(s, r11, 'u-prasath', 'Good visibility for the institution. Approved.', at(180));

  const r12 = create(160, {
    title: 'Campus Wi-Fi Upgrade – Phase 2', groupId: 'g-srmt', requesterId: 'u-divya',
    description: 'Second phase of the campus Wi-Fi upgrade covering the hostel blocks.',
    attachment: { name: 'WiFi_Phase2_Proposal.pdf', size: 735232 },
  });
  domainReject(s, r12, 'u-prasath', 'The Phase 1 audit is still open. Please include the audit closure report.', at(130));

  create(4, {
    title: 'December Staff Overtime Approval', groupId: 'g-hospital', requesterId: 'u-divya',
    description: 'Overtime budget for nursing and support staff during the December peak admission period.',
  });

  const r14 = create(60, {
    title: 'Library Digital Subscription Renewal', groupId: 'g-srmt', requesterId: 'u-arun',
    description: 'Renewal of the digital journal subscriptions for the central library.',
    attachment: { name: 'Library_Subscriptions.pdf', size: 288768 },
  });
  domainClarify(s, r14, 'u-prasath', 'Is the renewal price inclusive of GST?', at(50));
  domainRespond(s, r14, 'u-arun', 'Yes, the quoted amount of ₹2.4 lakh is inclusive of GST.', at(46));

  // Older notifications are already read; the recent ones stay unread for the demo.
  s.notifications.forEach((n) => { n.read = now - Date.parse(n.at) > 36 * 3600000; });
  return s;
}

/* =============================================================================
   4. PERSISTENCE AND SESSION
   ============================================================================= */

let state = null;
let session = { userId: DEFAULT_USER_ID };

function isValidState(s) {
  return Boolean(s) && s.version === STATE_VERSION
    && Array.isArray(s.users) && Array.isArray(s.groups)
    && Array.isArray(s.requests) && Array.isArray(s.notifications)
    && typeof s.nextRequestNumber === 'number';
}

function saveState(s = state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch (error) {
    if (!ui.storageWarned) {
      ui.storageWarned = true;
      toast('Browser storage is unavailable, so changes will not survive a refresh.', { type: 'error' });
    }
    return false;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidState(parsed)) return parsed;
    }
  } catch (error) {
    console.warn('Easy Approve: stored data could not be read, loading demo data.', error);
  }
  const seeded = createSeedState();
  saveState(seeded);
  return seeded;
}

function loadSession() {
  let userId = DEFAULT_USER_ID;
  try { userId = sessionStorage.getItem(SESSION_KEY) || DEFAULT_USER_ID; } catch (error) { /* ignore */ }
  session = { userId };
  ensureSessionUser();
}

function setSessionUser(userId) {
  session.userId = userId;
  try { sessionStorage.setItem(SESSION_KEY, userId); } catch (error) { /* ignore */ }
}

function ensureSessionUser() {
  if (!state.users.some((u) => u.id === session.userId)) {
    const fallback = state.users.find((u) => u.id === DEFAULT_USER_ID) || state.users[0];
    setSessionUser(fallback.id);
  }
}

function commit() {
  saveState();
  renderAll();
}

/* =============================================================================
   5. SELECTORS AND PERMISSIONS
   Role checks are a demo simulation only – they are NOT security.
   ============================================================================= */

const currentUser = () => state.users.find((u) => u.id === session.userId);
const userById = (id) => state.users.find((u) => u.id === id);
const groupById = (id) => state.groups.find((g) => g.id === id);
const userName = (id) => (userById(id) ? userById(id).name : 'Unknown user');
const groupName = (id) => (groupById(id) ? groupById(id).name : 'Unknown group');

const isGroupApprover = (user, req) => {
  const group = groupById(req.groupId);
  return Boolean(group) && group.approverIds.includes(user.id);
};
const inDelegationChain = (user, req) => req.delegations.some((d) => d.fromId === user.id || d.toId === user.id);

function canView(user, req) {
  if (user.role === 'admin') return true;
  if (user.role === 'requester') return req.requesterId === user.id;
  return isGroupApprover(user, req) || inDelegationChain(user, req);
}

function canAct(user, req) {
  if (user.role !== 'approver' || !ACTIONABLE.includes(req.status)) return false;
  return req.delegatedTo ? req.delegatedTo === user.id : isGroupApprover(user, req);
}

const canRespond = (user, req) => user.id === req.requesterId && req.status === STATUS.CLARIFICATION;

function whyCannotAct(user, req) {
  if (user.role === 'admin') return 'Admins can view requests; approvers take the actions (demo rule).';
  if (!ACTIONABLE.includes(req.status)) return `Not available while the request is ${req.status}.`;
  return 'This request is not currently assigned to you.';
}

const visibleRequests = (user) => state.requests.filter((r) => canView(user, r));
const userNotifications = (userId) => state.notifications
  .filter((n) => n.userId === userId)
  .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
const unreadCount = (userId) => state.notifications.filter((n) => n.userId === userId && !n.read).length;

function countByStatus(requests) {
  const counts = Object.fromEntries(STATUS_LIST.map((s) => [s, 0]));
  requests.forEach((r) => { counts[r.status] += 1; });
  return counts;
}

function notificationMessage(n) {
  const req = findRequest(state, n.requestId);
  const title = req ? `“${req.title}”` : 'a request';
  const who = userName(n.actorId);
  switch (n.type) {
    case 'new-request': return `${who} submitted ${title} to ${req ? groupName(req.groupId) : 'your group'}.`;
    case 'approved': return `${who} approved your request ${title}.`;
    case 'rejected': return `${who} rejected your request ${title}.`;
    case 'clarification-requested': return `${who} asked for clarification on ${title}.`;
    case 'clarification-response': return `${who} responded to your clarification question on ${title}.`;
    case 'delegated':
      return n.meta && n.meta.toId === n.userId
        ? `${who} delegated approval of ${title} to you.`
        : `${who} delegated approval of your request ${title} to ${userName(n.meta && n.meta.toId)}.`;
    default: return `Update on ${title}.`;
  }
}

/* =============================================================================
   6. UI PRIMITIVES
   ============================================================================= */

const ui = {
  route: 'dashboard',
  param: null,
  lists: { approvals: defaultList(), mine: defaultList() },
  notifFilter: 'all',
  draftFile: null,
  modal: null,
  menu: null,
  storageWarned: false,
};

function defaultList() {
  return { q: '', status: '', group: '', sortKey: 'submittedAt', sortDir: 'desc', page: 1, pageSize: 5 };
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
}

const icon = (name, cls = 'h-4 w-4') => `<i data-lucide="${name}" class="${cls}" aria-hidden="true"></i>`;

function avatar(user, size = 'h-8 w-8 text-xs') {
  if (!user) return `<span class="inline-flex ${size} shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-500" aria-hidden="true">?</span>`;
  const tone = AVATAR_TONES[hashString(user.id) % AVATAR_TONES.length];
  return `<span class="inline-flex ${size} shrink-0 items-center justify-center rounded-full font-semibold ${tone}" aria-hidden="true">${esc(initials(user.name))}</span>`;
}

function statusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META[STATUS.PENDING];
  return `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.badge}">${icon(meta.icon, 'h-3.5 w-3.5')}${esc(status)}</span>`;
}

function emptyState({ iconName = 'inbox', title, text = '', actionHTML = '' }) {
  return `<div class="flex flex-col items-center justify-center px-6 py-14 text-center">
    <span class="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">${icon(iconName, 'h-6 w-6')}</span>
    <h3 class="mt-4 text-sm font-semibold text-slate-900">${esc(title)}</h3>
    ${text ? `<p class="mt-1 max-w-sm text-sm text-slate-500">${esc(text)}</p>` : ''}
    ${actionHTML ? `<div class="mt-5">${actionHTML}</div>` : ''}
  </div>`;
}

function card({ title, subtitle = '', actionsHTML = '', body, flush = false, className = '' }) {
  const header = title
    ? `<div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
        <div><h2 class="text-base font-semibold text-slate-900">${esc(title)}</h2>${subtitle ? `<p class="mt-0.5 text-sm text-slate-500">${esc(subtitle)}</p>` : ''}</div>
        ${actionsHTML}
      </div>`
    : '';
  return `<section class="${CLS.card} ${className}">${header}<div class="${flush ? '' : 'p-5'}">${body}</div></section>`;
}

const pageIntro = (text, actionsHTML = '') => `<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
  <p class="max-w-2xl text-sm text-slate-600">${esc(text)}</p>
  ${actionsHTML ? `<div class="flex flex-wrap gap-2">${actionsHTML}</div>` : ''}
</div>`;

/* ---------- Toasts ---------- */

function toast(message, { type = 'success', timeout = 4500 } = {}) {
  const root = $('#toast-root');
  if (!root) return;
  const tones = { success: ['circle-check', 'text-emerald-600'], error: ['circle-alert', 'text-rose-600'], info: ['info', 'text-brand-600'] };
  const [iconName, tone] = tones[type] || tones.info;
  const el = document.createElement('div');
  el.className = 'toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200';
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(iconName, `mt-0.5 h-5 w-5 shrink-0 ${tone}`)}
    <p class="flex-1 text-sm text-slate-700">${esc(message)}</p>
    <button type="button" data-action="dismiss-toast" class="rounded p-0.5 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Dismiss notification">${icon('x', 'h-4 w-4')}</button>`;
  root.appendChild(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  refreshIcons();
  if (timeout) setTimeout(() => el.remove(), timeout);
}

/* ---------- Form fields and validation ---------- */

function renderField(def, prefix) {
  const id = `${prefix}-${def.name}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [def.help ? hintId : '', def.counter ? `${id}-counter` : '', errorId].filter(Boolean).join(' ');
  const common = `id="${id}" name="${def.name}" aria-describedby="${describedBy}"${def.required ? ' required aria-required="true"' : ''}${def.readonly ? ' readonly' : ''}${def.max ? ` maxlength="${def.max}"` : ''}`;
  const value = def.value ?? '';
  let control;
  if (def.type === 'textarea') {
    control = `<textarea ${common} rows="${def.rows || 4}" class="${CLS.input}" placeholder="${esc(def.placeholder || '')}"${def.counter ? ` data-counter="${def.max}"` : ''}>${esc(value)}</textarea>`;
  } else if (def.type === 'select') {
    const options = (def.options || []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    control = `<select ${common} class="${CLS.input}"><option value="">${esc(def.placeholder || 'Select…')}</option>${options}</select>`;
  } else {
    const extra = def.type === 'date' && def.min ? ` min="${esc(def.min)}"` : '';
    control = `<input type="${def.type || 'text'}" ${common}${extra} value="${esc(value)}" class="${CLS.input}" placeholder="${esc(def.placeholder || '')}" autocomplete="off">`;
  }
  return `<div>
    <label for="${id}" class="block text-sm font-medium text-slate-700">${esc(def.label)}${def.required ? ' <span class="text-rose-600" aria-hidden="true">*</span>' : ''}</label>
    <div class="mt-1">${control}</div>
    ${def.help ? `<p id="${hintId}" class="mt-1 text-xs text-slate-500">${esc(def.help)}</p>` : ''}
    ${def.counter ? `<p id="${id}-counter" class="mt-1 text-right text-xs text-slate-400" data-counter-for="${id}">${String(value).length} / ${def.max}</p>` : ''}
    <p id="${errorId}" class="mt-1 text-sm text-rose-600" role="alert"></p>
  </div>`;
}

const renderFields = (defs, prefix) => defs.map((d) => renderField(d, prefix)).join('');

function validateField(def, raw) {
  const value = String(raw ?? '').trim();
  if (def.required && !value) return def.requiredMessage || `${def.label} is required.`;
  if (!value) return '';
  if (def.min && value.length < def.min) return `${def.label} must be at least ${def.min} characters.`;
  if (def.max && value.length > def.max) return `${def.label} must be ${def.max} characters or fewer.`;
  if (def.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address, for example name@company.com.';
  return '';
}

function validateForm(defs, form) {
  const values = {};
  const errors = {};
  defs.forEach((def) => {
    const el = form.elements[def.name];
    const raw = el ? el.value : '';
    values[def.name] = String(raw).trim();
    const message = validateField(def, raw);
    if (message) errors[def.name] = message;
  });
  return { values, errors };
}

function setFieldError(form, prefix, name, message) {
  const input = form.querySelector(`#${prefix}-${name}`);
  const err = form.querySelector(`#${prefix}-${name}-error`);
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (err) err.textContent = message || '';
}

function showErrors(form, prefix, names, errors) {
  names.forEach((name) => setFieldError(form, prefix, name, errors[name] || ''));
  const first = names.find((name) => errors[name]);
  if (first) {
    const el = form.querySelector(`#${prefix}-${first}`);
    if (el && typeof el.focus === 'function') el.focus();
  }
}

function setFormSummary(form, message) {
  const el = form.querySelector('[data-form-summary]');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function clearFieldError(el) {
  el.removeAttribute('aria-invalid');
  const err = document.getElementById(`${el.id}-error`);
  if (err) err.textContent = '';
}

const formSummaryHTML = () => '<div data-form-summary role="alert" class="hidden rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 ring-1 ring-rose-200"></div>';

/* ---------- Modal dialog ---------- */

function openModal(cfg) {
  closeModal(true);
  const fields = cfg.fields || [];
  const confirmVariant = cfg.tone || 'primary';
  $('#modal-root').innerHTML = `
    <div class="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto p-4 sm:items-center">
      <div class="fixed inset-0 bg-slate-900/50" data-action="close-modal" aria-hidden="true"></div>
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" ${cfg.description ? 'aria-describedby="modal-desc"' : ''} class="modal-panel relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <form id="modal-form" data-form="modal" novalidate>
          <div class="p-6">
            <h2 id="modal-title" class="text-lg font-semibold text-slate-900">${esc(cfg.title)}</h2>
            ${cfg.description ? `<p id="modal-desc" class="mt-2 text-sm text-slate-600">${esc(cfg.description)}</p>` : ''}
            ${fields.length ? `<div class="mt-5 space-y-4">${renderFields(fields, 'm')}</div>` : ''}
          </div>
          <div class="flex flex-col-reverse gap-2 rounded-b-2xl bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
            <button type="button" data-action="close-modal" class="${btn('secondary')}">${esc(cfg.cancelLabel || 'Cancel')}</button>
            <button type="submit" class="${btn(confirmVariant)}">${esc(cfg.confirmLabel || 'Confirm')}</button>
          </div>
        </form>
      </div>
    </div>`;
  ui.modal = { cfg, fields, returnFocus: document.activeElement };
  const shell = $('#app-shell');
  if (shell) shell.setAttribute('inert', '');
  document.body.classList.add('overflow-hidden');
  refreshIcons();
  const first = $('#modal-form [name]') || $('#modal-form button[type="submit"]');
  if (first) first.focus();
}

function closeModal(skipFocus = false) {
  if (!ui.modal) return;
  const { returnFocus } = ui.modal;
  ui.modal = null;
  $('#modal-root').innerHTML = '';
  const shell = $('#app-shell');
  if (shell) shell.removeAttribute('inert');
  document.body.classList.remove('overflow-hidden');
  if (!skipFocus && returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
}

function submitModal(form) {
  const { cfg, fields } = ui.modal;
  const { values, errors } = validateForm(fields, form);
  if (cfg.validate) {
    const extra = cfg.validate(values) || {};
    Object.keys(extra).forEach((k) => { if (!errors[k]) errors[k] = extra[k]; });
  }
  if (Object.keys(errors).length) {
    showErrors(form, 'm', fields.map((f) => f.name), errors);
    return;
  }
  closeModal();
  if (cfg.onSubmit) cfg.onSubmit(values);
}

function trapFocus(e) {
  const panel = $('.modal-panel');
  if (!panel) return;
  const focusable = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', panel);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/* ---------- Floating action menu ---------- */

function menuItemHTML(item) {
  if (item.type === 'sep') return '<div class="my-1 h-px bg-slate-100" role="separator"></div>';
  if (item.type === 'label') {
    return `<div class="px-3 py-2" role="presentation"><p class="truncate text-sm font-semibold text-slate-900">${esc(item.label)}</p>${item.sub ? `<p class="truncate text-xs text-slate-500">${esc(item.sub)}</p>` : ''}</div>`;
  }
  if (item.type === 'heading') {
    return `<p class="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400" role="presentation">${esc(item.label)}</p>`;
  }
  const data = Object.entries(item.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  const tone = item.tone === 'danger' ? 'text-rose-700 hover:bg-rose-50 focus:bg-rose-50' : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-50';
  return `<button type="button" role="menuitem" data-action="${item.action}" ${data}${item.disabled ? ' disabled aria-disabled="true"' : ''}${item.hint ? ` title="${esc(item.hint)}"` : ''} class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${tone}">
    ${item.icon ? icon(item.icon, 'h-4 w-4 shrink-0') : ''}<span class="flex-1">${esc(item.label)}</span>${item.checked ? icon('check', 'h-4 w-4 text-brand-600') : ''}
  </button>`;
}

function openMenu(anchor, items) {
  closeMenu(false);
  const root = $('#menu-root');
  root.innerHTML = `<div id="floating-menu" role="menu" tabindex="-1" class="floating-menu fixed z-[70] min-w-[14rem] max-w-[18rem] rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/5" style="top:0;left:0;visibility:hidden">${items.map(menuItemHTML).join('')}</div>`;
  const menu = $('#floating-menu');
  refreshIcons();
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = 'visible';
  anchor.setAttribute('aria-expanded', 'true');
  ui.menu = { anchor };
  const first = $('[role="menuitem"]:not([disabled])', menu);
  (first || menu).focus({ preventScroll: true });
}

function closeMenu(returnFocus = true) {
  if (!ui.menu) return;
  const { anchor } = ui.menu;
  ui.menu = null;
  $('#menu-root').innerHTML = '';
  if (anchor && anchor.isConnected) {
    anchor.setAttribute('aria-expanded', 'false');
    if (returnFocus) anchor.focus({ preventScroll: true });
  }
}

function onMenuKeydown(e) {
  const items = $$('#floating-menu [role="menuitem"]:not([disabled])');
  const index = items.indexOf(document.activeElement);
  const focusAt = (i) => { if (items.length) items[(i + items.length) % items.length].focus({ preventScroll: true }); };
  if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(index + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(index < 0 ? -1 : index - 1); }
  else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
  else if (e.key === 'End') { e.preventDefault(); focusAt(items.length - 1); }
  else if (e.key === 'Tab') closeMenu(false);
}

/* =============================================================================
   7. VIEWS
   ============================================================================= */

const VIEW_RENDERERS = {
  dashboard: renderDashboard,
  create: renderCreate,
  'my-requests': () => renderListScreen('mine'),
  approvals: () => renderListScreen('approvals'),
  details: renderDetails,
  clarifications: renderClarifications,
  delegation: renderDelegation,
  notifications: renderNotifications,
  admin: renderAdmin,
};

function renderView() {
  $$('.view').forEach((v) => { v.hidden = true; });
  const el = $(`#view-${ui.route}`);
  const renderer = VIEW_RENDERERS[ui.route];
  if (!el || !renderer) return;
  el.hidden = false;
  el.innerHTML = renderer();
}

/* ---------- A. Dashboard ---------- */

function statCard({ label, value, iconName, tone, hint }) {
  return `<div class="${CLS.card} p-5">
    <div class="flex items-center justify-between">
      <p class="text-sm font-medium text-slate-500">${esc(label)}</p>
      <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg ${tone}">${icon(iconName, 'h-5 w-5')}</span>
    </div>
    <p class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">${value}</p>
    ${hint ? `<p class="mt-1 text-xs text-slate-500">${esc(hint)}</p>` : ''}
  </div>`;
}

function requestRow(req) {
  return `<li><a href="#/details/${encodeURIComponent(req.id)}" class="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-slate-900">${esc(req.title)}</p>
      <p class="mt-0.5 truncate text-xs text-slate-500">${esc(req.id)} · ${esc(groupName(req.groupId))} · ${esc(formatDate(req.submittedAt))}</p>
    </div>
    ${statusBadge(req.status)}
  </a></li>`;
}

function dashboardScope(user) {
  if (user.role === 'requester') return 'Showing the requests you submitted.';
  if (user.role === 'approver') return 'Showing requests routed or delegated to you.';
  return 'Showing every request across all recipient groups.';
}

function renderDashboard() {
  const user = currentUser();
  const reqs = visibleRequests(user);
  const counts = countByStatus(reqs);
  const open = OPEN_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const listRoute = user.role === 'requester' ? 'my-requests' : 'approvals';

  const recent = [...reqs].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)).slice(0, 5);
  const pending = reqs
    .filter((r) => (user.role === 'approver' ? canAct(user, r) : OPEN_STATUSES.includes(r.status)))
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .slice(0, 5);
  const notifs = userNotifications(user.id).slice(0, 5);

  const total = reqs.length || 1;
  const bar = STATUS_LIST.filter((s) => counts[s]).map((s) => `<div class="${STATUS_META[s].bar} h-full" style="width:${(counts[s] / total) * 100}%" title="${esc(s)}: ${counts[s]}"></div>`).join('');
  const legend = STATUS_LIST.map((s) => `<li class="flex items-center justify-between text-sm"><span class="flex items-center gap-2 text-slate-600"><span class="h-2.5 w-2.5 rounded-full ${STATUS_META[s].bar}"></span>${esc(s)}</span><span class="font-medium text-slate-900">${counts[s]}</span></li>`).join('');

  const viewAll = `<a href="#/${listRoute}" class="text-sm font-medium text-brand-700 hover:underline">View all</a>`;

  return `${pageIntro(dashboardScope(user))}
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    ${statCard({ label: 'Total Requests', value: reqs.length, iconName: 'files', tone: 'bg-brand-50 text-brand-700', hint: 'All statuses' })}
    ${statCard({ label: 'Pending Approvals', value: open, iconName: 'clock', tone: 'bg-amber-50 text-amber-700', hint: 'Includes delegated and clarification requests' })}
    ${statCard({ label: 'Approved Requests', value: counts[STATUS.APPROVED], iconName: 'circle-check', tone: 'bg-emerald-50 text-emerald-700', hint: 'Completed with approval' })}
    ${statCard({ label: 'Rejected Requests', value: counts[STATUS.REJECTED], iconName: 'circle-x', tone: 'bg-rose-50 text-rose-700', hint: 'Completed with rejection' })}
  </div>

  <div class="mt-6 grid gap-6 lg:grid-cols-3">
    <div class="lg:col-span-2">${card({
      title: 'Recent Requests', actionsHTML: viewAll, flush: true,
      body: recent.length ? `<ul class="divide-y divide-slate-100">${recent.map(requestRow).join('')}</ul>` : emptyState({ iconName: 'files', title: 'No requests yet', text: 'Requests will appear here as soon as they are submitted.' }),
    })}</div>
    <div>${card({
      title: 'Pending Approvals', subtitle: user.role === 'approver' ? 'Waiting for your decision' : 'Still in progress', flush: true,
      body: pending.length ? `<ul class="divide-y divide-slate-100">${pending.map(requestRow).join('')}</ul>` : emptyState({ iconName: 'circle-check', title: 'Nothing pending', text: 'You are all caught up.' }),
    })}</div>
    <div class="lg:col-span-2">${card({
      title: 'Recent Notifications',
      actionsHTML: '<a href="#/notifications" class="text-sm font-medium text-brand-700 hover:underline">View all</a>', flush: true,
      body: notifs.length ? `<ul class="divide-y divide-slate-100">${notifs.map(notificationListItem).join('')}</ul>` : emptyState({ iconName: 'bell', title: 'No notifications', text: 'Updates about your requests will show up here.' }),
    })}</div>
    <div>${card({
      title: 'Status Overview',
      body: `<div class="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Share of requests by status">${bar}</div><ul class="mt-4 space-y-2">${legend}</ul>`,
    })}</div>
  </div>`;
}

function notificationListItem(n) {
  const meta = NOTIF_META[n.type] || NOTIF_META['new-request'];
  return `<li><a href="#/details/${encodeURIComponent(n.requestId)}" data-action="open-notification" data-id="${esc(n.id)}" class="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500">
    <span class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}">${icon(meta.icon, 'h-4 w-4')}</span>
    <div class="min-w-0 flex-1">
      <p class="text-sm ${n.read ? 'text-slate-600' : 'font-medium text-slate-900'}">${esc(notificationMessage(n))}</p>
      <p class="mt-0.5 text-xs text-slate-500">${esc(timeAgo(n.at))}</p>
    </div>
    ${n.read ? '' : '<span class="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600"><span class="sr-only">Unread</span></span>'}
  </a></li>`;
}

/* ---------- B. Create approval request ---------- */

function createFieldDefs() {
  return [
    { name: 'title', label: 'Title / Subject', type: 'text', required: true, min: 5, max: 120, placeholder: 'e.g. Q4 budget revision for campus expansion' },
    { name: 'description', label: 'Description', type: 'textarea', required: true, min: 10, max: 1000, rows: 6, counter: true, placeholder: 'Explain what you need approved and why.' },
    { name: 'groupId', label: 'Recipient Group', type: 'select', required: true, requiredMessage: 'Select a recipient group.', placeholder: 'Select a group', options: state.groups.map((g) => ({ value: g.id, label: g.name })), help: 'Any approver in the chosen group can act on the request.' },
  ];
}

function attachmentChipHTML(file) {
  if (!file) return '';
  return `<div class="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
    ${icon('paperclip', 'h-4 w-4 shrink-0 text-slate-500')}
    <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">${esc(file.name)}</span>
    <span class="text-xs text-slate-500">${esc(formatBytes(file.size))}</span>
    <button type="button" data-action="remove-attachment" class="rounded p-1 text-slate-400 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Remove attachment ${esc(file.name)}">${icon('x', 'h-4 w-4')}</button>
  </div>`;
}

function renderCreate() {
  const defs = createFieldDefs();
  const [titleDef, descDef, groupDef] = defs;
  return `${pageIntro('Describe what you need approved and choose the group that should review it.')}
  <div class="${CLS.card} max-w-3xl">
    <form id="create-form" data-form="create-request" novalidate class="space-y-5 p-5 sm:p-6">
      ${formSummaryHTML()}
      ${renderField(titleDef, 'create')}
      ${renderField(descDef, 'create')}
      <div>
        ${renderField(groupDef, 'create')}
        <p id="recipient-hint" class="mt-1 text-xs text-slate-500"></p>
      </div>
      <div>
        <span class="block text-sm font-medium text-slate-700">Attachment <span class="font-normal text-slate-400">(optional)</span></span>
        <div class="mt-1">
          <input id="create-attachment" name="attachment" type="file" class="peer sr-only" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt" aria-describedby="create-attachment-hint create-attachment-error">
          <label for="create-attachment" id="dropzone" class="dropzone flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 peer-focus-visible:ring-offset-2">
            ${icon('upload', 'h-6 w-6 text-slate-400')}
            <span class="text-sm font-medium text-brand-700">Click to upload or drag a file here</span>
            <span id="create-attachment-hint" class="text-xs text-slate-500">PDF, Word, Excel, image or text · up to ${formatBytes(MAX_FILE_BYTES)}</span>
          </label>
        </div>
        <div id="attachment-chip" class="mt-2">${attachmentChipHTML(ui.draftFile)}</div>
        <p id="create-attachment-error" class="mt-1 text-sm text-rose-600" role="alert"></p>
      </div>
      <div class="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
        <button type="button" data-action="cancel-create" class="${btn('secondary')}">Cancel</button>
        <button type="submit" class="${btn('primary')}">${icon('send')} Submit Request</button>
      </div>
    </form>
  </div>`;
}

function updateRecipientHint() {
  const select = $('#create-groupId');
  const hint = $('#recipient-hint');
  if (!select || !hint) return;
  const group = groupById(select.value);
  if (!group) { hint.textContent = ''; hint.className = 'mt-1 text-xs text-slate-500'; return; }
  if (!group.approverIds.length) {
    hint.textContent = `${group.name} has no approvers yet. Ask an admin to assign one before submitting.`;
    hint.className = 'mt-1 text-xs font-medium text-amber-700';
    return;
  }
  hint.textContent = `Will be sent to: ${group.approverIds.map(userName).join(', ')}.`;
  hint.className = 'mt-1 text-xs text-slate-500';
}

function validateAttachment(file) {
  if (!file) return '';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) return `“${file.name}” is not a supported file type. Use PDF, Word, Excel, image or text files.`;
  if (file.size > MAX_FILE_BYTES) return `“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`;
  return '';
}

function setDraftFile(file) {
  const form = $('#create-form');
  const message = validateAttachment(file);
  const errorEl = $('#create-attachment-error');
  if (message) {
    ui.draftFile = null;
    if (errorEl) errorEl.textContent = message;
    const input = $('#create-attachment');
    if (input) input.value = '';
  } else {
    ui.draftFile = file ? { name: file.name, size: file.size } : null;
    if (errorEl) errorEl.textContent = '';
  }
  const chip = $('#attachment-chip');
  if (chip) { chip.innerHTML = attachmentChipHTML(ui.draftFile); refreshIcons(); }
  if (form && message) setFormSummary(form, '');
}

function submitCreateRequest(form) {
  const defs = createFieldDefs();
  const { values, errors } = validateForm(defs, form);
  const names = defs.map((d) => d.name);
  const attachmentError = ($('#create-attachment-error') || {}).textContent || '';
  if (Object.keys(errors).length || attachmentError) {
    showErrors(form, 'create', names, errors);
    const count = Object.keys(errors).length + (attachmentError ? 1 : 0);
    setFormSummary(form, `Please fix ${plural(count, 'problem')} below before submitting.`);
    toast('The request could not be submitted. Check the highlighted fields.', { type: 'error' });
    return;
  }
  const res = domainCreate(state, {
    title: values.title, description: values.description, groupId: values.groupId,
    requesterId: currentUser().id, attachment: ui.draftFile,
  });
  if (!res.ok) {
    setFormSummary(form, res.error);
    toast(res.error, { type: 'error' });
    return;
  }
  ui.draftFile = null;
  saveState();
  toast(`${res.data.id} submitted to ${groupName(res.data.groupId)}.`);
  navigate('details', res.data.id);
}

/* ---------- C / H. Request tables (Approval List, My Requests) ---------- */

function listSource(key) {
  const user = currentUser();
  return key === 'mine' ? state.requests.filter((r) => r.requesterId === user.id) : visibleRequests(user);
}

const SORTERS = {
  id: (a, b) => idNumber(a.id) - idNumber(b.id),
  title: (a, b) => compareText(a.title, b.title),
  requester: (a, b) => compareText(userName(a.requesterId), userName(b.requesterId)),
  group: (a, b) => compareText(groupName(a.groupId), groupName(b.groupId)),
  submittedAt: (a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt),
  status: (a, b) => compareText(a.status, b.status),
};

function queryList(key) {
  const l = ui.lists[key];
  const source = listSource(key);
  const q = l.q.trim().toLowerCase();
  let rows = source.filter((r) => {
    if (l.status && r.status !== l.status) return false;
    if (l.group && r.groupId !== l.group) return false;
    if (!q) return true;
    const haystack = [r.id, r.title, r.description, userName(r.requesterId), groupName(r.groupId), r.status].join(' ').toLowerCase();
    return haystack.includes(q);
  });
  const sorter = SORTERS[l.sortKey] || SORTERS.submittedAt;
  rows = rows.sort((a, b) => (l.sortDir === 'asc' ? sorter(a, b) : sorter(b, a)));
  const pages = Math.max(1, Math.ceil(rows.length / l.pageSize));
  l.page = Math.min(Math.max(1, l.page), pages);
  const start = (l.page - 1) * l.pageSize;
  return { sourceCount: source.length, total: rows.length, pages, page: l.page, start, rows: rows.slice(start, start + l.pageSize) };
}

function renderListScreen(key) {
  const user = currentUser();
  let intro = 'Requests routed to you or delegated to you.';
  if (key === 'mine') intro = 'Track every request you have submitted.';
  else if (user.role === 'admin') intro = 'Every request across all recipient groups (view-only for admins).';
  const createBtn = key === 'mine' ? `<a href="#/create" class="${btn('primary')}">${icon('plus')} New Request</a>` : '';
  return `${pageIntro(intro, createBtn)}
  <div class="${CLS.card} overflow-hidden">
    ${renderListToolbar(key)}
    <div id="list-region-${key}" tabindex="-1" data-focus-target>${renderListRegion(key)}</div>
  </div>`;
}

function renderListToolbar(key) {
  const l = ui.lists[key];
  const statusOptions = STATUS_LIST.map((s) => `<option value="${esc(s)}"${l.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('');
  const groupOptions = state.groups.map((g) => `<option value="${esc(g.id)}"${l.group === g.id ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  return `<div class="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:flex-wrap sm:items-end">
    <div class="flex-1 sm:min-w-[16rem]">
      <label for="${key}-q" class="mb-1 block text-xs font-medium text-slate-500">Search</label>
      <div class="relative">
        ${icon('search', 'pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400')}
        <input id="${key}-q" type="search" data-list="${key}" data-list-field="q" value="${esc(l.q)}" autocomplete="off" placeholder="ID, title, requester or group" class="${CLS.input} pl-9">
      </div>
    </div>
    <div class="sm:w-48">
      <label for="${key}-status" class="mb-1 block text-xs font-medium text-slate-500">Status</label>
      <select id="${key}-status" data-list="${key}" data-list-field="status" class="${CLS.input}"><option value="">All statuses</option>${statusOptions}</select>
    </div>
    <div class="sm:w-44">
      <label for="${key}-group" class="mb-1 block text-xs font-medium text-slate-500">Recipient group</label>
      <select id="${key}-group" data-list="${key}" data-list-field="group" class="${CLS.input}"><option value="">All groups</option>${groupOptions}</select>
    </div>
    <button type="button" data-action="clear-filters" data-list="${key}" class="${btn('secondary')}">${icon('rotate-ccw')} Clear</button>
  </div>`;
}

function sortHeader(key, col, l) {
  const active = l.sortKey === col.key;
  const ariaSort = active ? (l.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const sortIcon = active ? (l.sortDir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down';
  return `<th scope="col" aria-sort="${ariaSort}" class="${col.cls} px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
    <button type="button" data-action="sort" data-list="${key}" data-key="${col.key}" class="inline-flex items-center gap-1 rounded uppercase tracking-wide hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? 'text-slate-900' : ''}">
      ${esc(col.label)}${icon(sortIcon, `h-3.5 w-3.5 ${active ? '' : 'text-slate-300'}`)}
    </button>
  </th>`;
}

function requestTableRow(req, key) {
  const requester = userById(req.requesterId);
  const href = `#/details/${encodeURIComponent(req.id)}`;
  return `<tr class="border-b border-slate-100 hover:bg-slate-50">
    <td class="whitespace-nowrap px-4 py-3 text-sm font-medium"><a href="${href}" class="text-brand-700 hover:underline">${esc(req.id)}</a></td>
    <td class="px-4 py-3 text-sm">
      <a href="${href}" class="break-anywhere font-medium text-slate-900 hover:text-brand-700">${esc(req.title)}</a>
      ${req.attachment ? `<span class="ml-1 inline-block align-middle text-slate-400" title="Has attachment">${icon('paperclip', 'h-3.5 w-3.5')}<span class="sr-only">Has attachment</span></span>` : ''}
      <div class="mt-0.5 text-xs text-slate-500 lg:hidden">${key === 'mine' ? '' : `${esc(requester ? requester.name : 'Unknown')} · `}${esc(groupName(req.groupId))} · ${esc(formatDate(req.submittedAt))}</div>
    </td>
    <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-700 lg:table-cell"><span class="inline-flex items-center gap-2">${avatar(requester, 'h-6 w-6 text-[0.65rem]')}${esc(requester ? requester.name : 'Unknown')}</span></td>
    <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-700 lg:table-cell">${esc(groupName(req.groupId))}</td>
    <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-700 lg:table-cell">${esc(formatDate(req.submittedAt))}</td>
    <td class="whitespace-nowrap px-4 py-3 text-sm">${statusBadge(req.status)}</td>
    <td class="whitespace-nowrap px-4 py-3 text-right">
      <button type="button" data-action="open-row-menu" data-id="${esc(req.id)}" data-menu-anchor aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${esc(req.id)}" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">${icon('ellipsis-vertical', 'h-5 w-5')}</button>
    </td>
  </tr>`;
}

function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

function renderPagination(key, res) {
  const l = ui.lists[key];
  const from = res.total ? res.start + 1 : 0;
  const to = res.start + res.rows.length;
  const pageButtons = pageWindow(res.page, res.pages).map((p) => (p === '…'
    ? '<span class="px-2 text-slate-400" aria-hidden="true">…</span>'
    : `<button type="button" data-action="page" data-list="${key}" data-page="${p}" ${p === res.page ? 'aria-current="page"' : ''} aria-label="Page ${p}" class="min-w-[2.25rem] rounded-lg px-2.5 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${p === res.page ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}">${p}</button>`)).join('');
  const sizeOptions = [5, 10, 20].map((n) => `<option value="${n}"${l.pageSize === n ? ' selected' : ''}>${n}</option>`).join('');
  return `<nav aria-label="Pagination" class="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex flex-wrap items-center gap-3 text-sm text-slate-600">
      <p>Showing <span class="font-medium text-slate-900">${from}–${to}</span> of <span class="font-medium text-slate-900">${res.total}</span></p>
      <label class="flex items-center gap-2 text-xs text-slate-500" for="${key}-pagesize">Rows per page
        <select id="${key}-pagesize" data-list="${key}" data-list-field="pageSize" class="rounded-lg border-0 py-1 pl-2 pr-7 text-sm text-slate-700 ring-1 ring-inset ring-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500">${sizeOptions}</select>
      </label>
    </div>
    <div class="flex items-center gap-1">
      <button type="button" data-action="page" data-list="${key}" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''} class="${btn('secondary', 'px-2.5 py-1.5')}" aria-label="Previous page">${icon('chevron-left')}</button>
      ${pageButtons}
      <button type="button" data-action="page" data-list="${key}" data-page="${res.page + 1}" ${res.page >= res.pages ? 'disabled' : ''} class="${btn('secondary', 'px-2.5 py-1.5')}" aria-label="Next page">${icon('chevron-right')}</button>
    </div>
  </nav>`;
}

function renderListRegion(key) {
  const l = ui.lists[key];
  const res = queryList(key);
  if (!res.sourceCount) {
    return emptyState({
      iconName: 'files',
      title: key === 'mine' ? 'You have not submitted any requests' : 'No requests to show',
      text: key === 'mine' ? 'Create your first approval request to get started.' : 'Requests routed to you will appear here.',
      actionHTML: key === 'mine' ? `<a href="#/create" class="${btn('primary')}">${icon('plus')} New Request</a>` : '',
    });
  }
  if (!res.total) {
    return emptyState({
      iconName: 'search', title: 'No matching requests', text: 'Try a different search or clear the filters.',
      actionHTML: `<button type="button" data-action="clear-filters" data-list="${key}" class="${btn('secondary')}">Clear filters</button>`,
    });
  }
  const columns = COLUMNS.filter((c) => !(key === 'mine' && c.key === 'requester'));
  return `<p class="sr-only" role="status">${plural(res.total, 'request')} found</p>
  <div class="thin-scroll overflow-x-auto">
    <table class="data-table min-w-full">
      <caption class="sr-only">${key === 'mine' ? 'My requests' : 'Approval requests'}, sorted by ${esc(l.sortKey)} ${l.sortDir === 'asc' ? 'ascending' : 'descending'}</caption>
      <thead class="bg-slate-50"><tr>${columns.map((c) => sortHeader(key, c, l)).join('')}<th scope="col" class="px-4 py-3 text-right"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${res.rows.map((r) => requestTableRow(r, key)).join('')}</tbody>
    </table>
  </div>
  ${renderPagination(key, res)}`;
}

function updateListRegion(key, focusSelector) {
  const el = $(`#list-region-${key}`);
  if (!el) return;
  el.innerHTML = renderListRegion(key);
  refreshIcons();
  if (focusSelector) {
    const target = $(focusSelector);
    if (target) target.focus({ preventScroll: true });
  }
}

function rowMenuItems(req) {
  const user = currentUser();
  const items = [{ label: 'View Details', icon: 'eye', action: 'view', data: { id: req.id } }];
  if (user.role === 'requester') {
    if (canRespond(user, req)) items.push({ label: 'Respond to Clarification', icon: 'message-square', action: 'respond', data: { id: req.id } });
    return items;
  }
  const allowed = canAct(user, req);
  const hint = allowed ? '' : whyCannotAct(user, req);
  const data = { id: req.id };
  items.push({ type: 'sep' });
  items.push({ label: 'Approve', icon: 'circle-check', action: 'approve', data, disabled: !allowed, hint });
  items.push({ label: 'Reject', icon: 'circle-x', action: 'reject', data, disabled: !allowed, hint, tone: 'danger' });
  items.push({ label: 'Request Clarification', icon: 'message-circle-question', action: 'clarify', data, disabled: !allowed, hint });
  items.push({ label: 'Delegate Approval', icon: 'users', action: 'delegate', data, disabled: !allowed, hint });
  return items;
}

/* ---------- D. Request details ---------- */

function actionButtons(req) {
  const user = currentUser();
  const data = `data-id="${esc(req.id)}"`;
  if (canAct(user, req)) {
    return `<button type="button" data-action="approve" ${data} class="${btn('success')}">${icon('circle-check')} Approve</button>
      <button type="button" data-action="reject" ${data} class="${btn('danger')}">${icon('circle-x')} Reject</button>
      <button type="button" data-action="clarify" ${data} class="${btn('secondary')}">${icon('message-circle-question')} Request Clarification</button>
      <button type="button" data-action="delegate" ${data} class="${btn('secondary')}">${icon('users')} Delegate</button>`;
  }
  if (canRespond(user, req)) {
    return `<button type="button" data-action="focus-composer" class="${btn('primary')}">${icon('message-square')} Respond to clarification</button>`;
  }
  return '';
}

function renderConversation(req) {
  const user = currentUser();
  const messages = req.clarifications.map((m) => {
    const author = userById(m.userId);
    const mine = m.userId === user.id;
    const bubble = m.kind === 'question' ? 'bg-sky-50 text-sky-900 ring-1 ring-sky-200' : 'bg-slate-100 text-slate-800';
    return `<li class="flex gap-3 ${mine ? 'flex-row-reverse' : ''}">
      ${avatar(author)}
      <div class="max-w-[85%]">
        <div class="rounded-2xl px-4 py-2.5 text-sm ${bubble} ${mine ? 'rounded-tr-sm' : 'rounded-tl-sm'}"><p class="break-anywhere whitespace-pre-wrap">${esc(m.text)}</p></div>
        <p class="mt-1 text-xs text-slate-500 ${mine ? 'text-right' : ''}">${esc(author ? author.name : 'Unknown')} · ${m.kind === 'question' ? 'Question' : 'Response'} · ${esc(formatDateTime(m.at))}</p>
      </div>
    </li>`;
  }).join('');

  let composer;
  if (canAct(user, req)) {
    composer = `<form data-form="clarify-compose" data-id="${esc(req.id)}" novalidate class="space-y-3">
      ${renderField({ name: 'text', label: 'Ask the requester a question', type: 'textarea', required: true, min: 5, max: 500, rows: 3, placeholder: 'What do you need clarified?' }, 'conv')}
      <button type="submit" class="${btn('primary')}">${icon('send')} Send question &amp; request clarification</button>
    </form>`;
  } else if (canRespond(user, req)) {
    composer = `<form data-form="respond-compose" data-id="${esc(req.id)}" novalidate class="space-y-3">
      ${renderField({ name: 'text', label: 'Your response', type: 'textarea', required: true, min: 2, max: 500, rows: 3, placeholder: 'Answer the approver’s question.' }, 'conv')}
      <button type="submit" class="${btn('primary')}">${icon('send')} Send response</button>
    </form>`;
  } else {
    let note = 'No further questions can be asked on this request.';
    if (req.status === STATUS.CLARIFICATION) note = `Waiting for ${userName(req.requesterId)} to respond.`;
    else if (user.role === 'admin') note = 'Admins can read conversations but not take part (demo rule).';
    else if (user.role === 'requester') note = 'You can respond here when an approver asks for clarification.';
    composer = `<p class="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">${esc(note)}</p>`;
  }

  return `${messages ? `<ul class="mb-5 space-y-4" aria-label="Clarification conversation">${messages}</ul>` : '<p class="mb-5 text-sm text-slate-500">No clarification questions have been asked yet.</p>'}${composer}`;
}

function renderHistory(req) {
  return `<ol class="space-y-4">${req.history.map((h) => {
    const meta = HISTORY_META[h.type] || HISTORY_META.submitted;
    return `<li class="timeline-item flex gap-3">
      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}">${icon(meta.icon, 'h-4 w-4')}</span>
      <div class="min-w-0 flex-1 pb-1">
        <p class="text-sm font-medium text-slate-900">${esc(meta.label)}</p>
        <p class="text-xs text-slate-500">${esc(userName(h.userId))} · ${esc(formatDateTime(h.at))}</p>
        ${h.note ? `<p class="break-anywhere mt-1 text-sm text-slate-600">${esc(h.note)}</p>` : ''}
      </div>
    </li>`;
  }).join('')}</ol>`;
}

function renderComments(req) {
  const list = req.comments.length
    ? `<ul class="mb-5 space-y-4">${req.comments.map((c) => `<li class="flex gap-3">${avatar(userById(c.userId))}<div class="min-w-0 flex-1"><p class="text-sm"><span class="font-medium text-slate-900">${esc(userName(c.userId))}</span> <span class="text-xs text-slate-500">· ${esc(formatDateTime(c.at))}</span></p><p class="break-anywhere mt-0.5 whitespace-pre-wrap text-sm text-slate-700">${esc(c.text)}</p></div></li>`).join('')}</ul>`
    : '<p class="mb-5 text-sm text-slate-500">No comments yet.</p>';
  return `${list}<form data-form="comment" data-id="${esc(req.id)}" novalidate class="space-y-3">
    ${renderField({ name: 'text', label: 'Add a comment', type: 'textarea', required: true, min: 2, max: 500, rows: 2, placeholder: 'Write a comment…' }, 'cmt')}
    <button type="submit" class="${btn('secondary')}">${icon('message-square')} Post comment</button>
  </form>`;
}

function routingCardBody(req) {
  const group = groupById(req.groupId);
  const approvers = group ? group.approverIds.map(userById).filter(Boolean) : [];
  const lastDelegation = req.delegations[req.delegations.length - 1];
  const approverList = approvers.length
    ? approvers.map((u) => `<li class="flex items-center gap-2 text-sm text-slate-700">${avatar(u, 'h-6 w-6 text-[0.65rem]')}${esc(u.name)}</li>`).join('')
    : '<li class="text-sm text-slate-500">No approvers assigned.</li>';
  const delegation = lastDelegation
    ? `<div class="mt-4 rounded-lg bg-violet-50 p-3 text-sm text-violet-900 ring-1 ring-violet-200">
        <p class="font-medium">Delegated to ${esc(userName(lastDelegation.toId))}</p>
        <p class="mt-0.5 text-xs">By ${esc(userName(lastDelegation.fromId))} · ${esc(formatDateOnly(lastDelegation.start))} – ${esc(formatDateOnly(lastDelegation.end))}</p>
        <p class="break-anywhere mt-1 text-xs">${esc(lastDelegation.reason)}</p>
      </div>`
    : '';
  return `<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">${esc(group ? group.name : 'Group')} approvers</p>
    <ul class="mt-2 space-y-2">${approverList}</ul>${delegation}`;
}

function renderDetails() {
  const req = findRequest(state, ui.param);
  const user = currentUser();
  if (!req) return emptyState({ iconName: 'file-text', title: 'Request not found' });
  const requester = userById(req.requesterId);
  const backRoute = user.role === 'requester' ? 'my-requests' : 'approvals';
  const actions = actionButtons(req);
  const attachment = req.attachment
    ? `<div class="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">${icon('paperclip', 'h-4 w-4 text-slate-500')}
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">${esc(req.attachment.name)}</span>
        <span class="text-xs text-slate-500">${esc(formatBytes(req.attachment.size))}</span>
        <button type="button" data-action="download-attachment" class="text-xs font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">Download</button>
      </div>`
    : '<p class="text-sm text-slate-500">No attachment.</p>';

  const info = `<dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
    <div class="sm:col-span-2"><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</dt><dd class="break-anywhere mt-1 whitespace-pre-wrap text-sm text-slate-700">${esc(req.description)}</dd></div>
    <div><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Recipient group</dt><dd class="mt-1 text-sm text-slate-800">${esc(groupName(req.groupId))}</dd></div>
    <div><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Submitted</dt><dd class="mt-1 text-sm text-slate-800">${esc(formatDateTime(req.submittedAt))}</dd></div>
    <div><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</dt><dd class="mt-1">${statusBadge(req.status)}</dd></div>
    <div><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Last updated</dt><dd class="mt-1 text-sm text-slate-800">${esc(formatDateTime(req.updatedAt))}</dd></div>
    <div class="sm:col-span-2"><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Attachment</dt><dd class="mt-1">${attachment}</dd></div>
  </dl>`;

  const requesterCard = requester
    ? `<div class="flex items-center gap-3">${avatar(requester, 'h-11 w-11 text-sm')}<div class="min-w-0"><p class="truncate text-sm font-semibold text-slate-900">${esc(requester.name)}</p><p class="truncate text-xs text-slate-500">${esc(requester.title)}</p><p class="truncate text-xs text-slate-500">${esc(requester.email)}</p></div></div>`
    : '<p class="text-sm text-slate-500">Unknown requester.</p>';

  return `<div class="mb-4"><a href="#/${backRoute}" class="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-brand-700">${icon('arrow-left')} Back to ${esc(ROUTES[backRoute].title)}</a></div>
  <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="text-sm font-medium text-brand-700">${esc(req.id)}</p>
      <h2 class="break-anywhere text-2xl font-semibold tracking-tight text-slate-900">${esc(req.title)}</h2>
      <div class="mt-2 flex flex-wrap items-center gap-2">${statusBadge(req.status)}<span class="text-sm text-slate-500">Requested by ${esc(userName(req.requesterId))} on ${esc(formatDate(req.submittedAt))}</span></div>
    </div>
    ${actions ? `<div class="flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>
  <div class="grid gap-6 lg:grid-cols-3">
    <div class="space-y-6 lg:col-span-2">
      ${card({ title: 'Request Information', body: info })}
      <div id="conversation-card">${card({ title: 'Clarification Conversation', body: renderConversation(req) })}</div>
      ${card({ title: 'Comments', body: renderComments(req) })}
    </div>
    <div class="space-y-6">
      ${card({ title: 'Requester', body: requesterCard })}
      ${card({ title: 'Approvers', body: routingCardBody(req) })}
      ${card({ title: 'Approval History', body: renderHistory(req) })}
    </div>
  </div>`;
}

/* ---------- E. Notifications ---------- */

function renderNotifications() {
  const user = currentUser();
  const all = userNotifications(user.id);
  const unread = all.filter((n) => !n.read).length;
  const rows = ui.notifFilter === 'unread' ? all.filter((n) => !n.read) : all;
  const tab = (value, label, count) => `<button type="button" data-action="notif-filter" data-value="${value}" aria-pressed="${ui.notifFilter === value}" class="rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${ui.notifFilter === value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">${label} <span class="${ui.notifFilter === value ? 'text-brand-100' : 'text-slate-400'}">${count}</span></button>`;

  const body = rows.length
    ? `<div class="thin-scroll overflow-x-auto"><table class="data-table min-w-full">
        <thead class="bg-slate-50"><tr>
          <th scope="col" class="w-10 px-4 py-3"><span class="sr-only">Read status</span></th>
          <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notification</th>
          <th scope="col" class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Request</th>
          <th scope="col" class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:table-cell">Received</th>
          <th scope="col" class="px-4 py-3 text-right"><span class="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>${rows.map(notificationRow).join('')}</tbody></table></div>`
    : emptyState({ iconName: 'bell', title: ui.notifFilter === 'unread' ? 'No unread notifications' : 'No notifications yet', text: ui.notifFilter === 'unread' ? 'You are all caught up.' : 'Updates about requests will appear here.' });

  return `${pageIntro('New requests, decisions, clarification questions and delegated approvals.',
    `<button type="button" data-action="mark-all-read" ${unread ? '' : 'disabled'} class="${btn('secondary')}">${icon('check-check')} Mark all as read</button>`)}
  <div class="${CLS.card} overflow-hidden">
    <div class="flex flex-wrap gap-2 border-b border-slate-200 p-3" role="group" aria-label="Filter notifications">${tab('all', 'All', all.length)}${tab('unread', 'Unread', unread)}</div>
    ${body}
  </div>`;
}

function notificationRow(n) {
  const meta = NOTIF_META[n.type] || NOTIF_META['new-request'];
  const href = `#/details/${encodeURIComponent(n.requestId)}`;
  return `<tr class="border-b border-slate-100 ${n.read ? '' : 'bg-brand-50/40'}">
    <td class="px-4 py-3">${n.read ? '<span class="sr-only">Read</span>' : '<span class="block h-2.5 w-2.5 rounded-full bg-brand-600"><span class="sr-only">Unread</span></span>'}</td>
    <td class="px-4 py-3">
      <div class="flex items-start gap-3">
        <span class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.tone}">${icon(meta.icon, 'h-4 w-4')}</span>
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">${esc(meta.label)}</p>
          <a href="${href}" data-action="open-notification" data-id="${esc(n.id)}" class="break-anywhere text-sm ${n.read ? 'text-slate-600' : 'font-medium text-slate-900'} hover:text-brand-700">${esc(notificationMessage(n))}</a>
          <p class="mt-0.5 text-xs text-slate-500 sm:hidden">${esc(timeAgo(n.at))}</p>
        </div>
      </div>
    </td>
    <td class="hidden whitespace-nowrap px-4 py-3 text-sm md:table-cell"><a href="${href}" data-action="open-notification" data-id="${esc(n.id)}" class="font-medium text-brand-700 hover:underline">${esc(n.requestId)}</a></td>
    <td class="hidden whitespace-nowrap px-4 py-3 text-sm text-slate-500 sm:table-cell" title="${esc(formatDateTime(n.at))}">${esc(timeAgo(n.at))}</td>
    <td class="whitespace-nowrap px-4 py-3 text-right">${n.read
    ? '<span class="text-xs text-slate-400">Read</span>'
    : `<button type="button" data-action="mark-read" data-id="${esc(n.id)}" class="${btn('secondary', 'px-2.5 py-1.5 text-xs')}">Mark as read</button>`}</td>
  </tr>`;
}

/* ---------- F. Approval delegation ---------- */

function delegationFieldDefs(user, preselect) {
  const eligible = state.requests.filter((r) => canAct(user, r));
  const delegates = state.users.filter((u) => u.role === 'approver' && u.id !== user.id);
  return [
    { name: 'requestId', label: 'Request ID', type: 'select', required: true, requiredMessage: 'Select the request you want to delegate.', placeholder: 'Select a request', value: preselect, options: eligible.map((r) => ({ value: r.id, label: `${r.id} — ${r.title}` })) },
    { name: 'currentApprover', label: 'Current Approver', type: 'text', value: user.name, readonly: true },
    { name: 'delegateTo', label: 'Delegate To', type: 'select', required: true, requiredMessage: 'Choose who should take over.', placeholder: 'Select a delegate', options: delegates.map((u) => ({ value: u.id, label: `${u.name} — ${u.title}` })) },
    { name: 'startDate', label: 'Start Date', type: 'date', required: true, value: todayISO(), min: todayISO() },
    { name: 'endDate', label: 'End Date', type: 'date', required: true, value: addDaysISO(7), min: todayISO() },
    { name: 'reason', label: 'Reason', type: 'textarea', required: true, min: 5, max: 500, rows: 3, placeholder: 'Why is this being delegated?' },
  ];
}

function renderDelegation() {
  const user = currentUser();
  const eligible = state.requests.filter((r) => canAct(user, r));
  const preselect = eligible.some((r) => r.id === ui.param) ? ui.param : '';
  const defs = delegationFieldDefs(user, preselect);
  const byName = Object.fromEntries(defs.map((d) => [d.name, d]));

  const activity = state.requests
    .flatMap((r) => r.delegations.filter((d) => d.fromId === user.id || d.toId === user.id).map((d) => ({ req: r, d })))
    .sort((a, b) => Date.parse(b.d.at) - Date.parse(a.d.at));

  const form = eligible.length
    ? `<form id="delegation-form" data-form="delegation" novalidate class="space-y-5 p-5 sm:p-6">
        ${formSummaryHTML()}
        <div>${renderField(byName.requestId, 'dlg')}<p id="dlg-request-hint" class="mt-1 text-xs text-slate-500"></p></div>
        ${renderField(byName.currentApprover, 'dlg')}
        ${renderField(byName.delegateTo, 'dlg')}
        <div class="grid gap-5 sm:grid-cols-2">${renderField(byName.startDate, 'dlg')}${renderField(byName.endDate, 'dlg')}</div>
        ${renderField(byName.reason, 'dlg')}
        <div class="flex flex-col-reverse gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          <button type="button" data-action="cancel-delegation" class="${btn('secondary')}">Cancel</button>
          <button type="submit" class="${btn('primary')}">${icon('users')} Delegate Approval</button>
        </div>
      </form>`
    : emptyState({ iconName: 'circle-check', title: 'Nothing to delegate', text: 'Requests that are waiting for your decision can be delegated from here.' });

  const activityBody = activity.length
    ? `<ul class="divide-y divide-slate-100">${activity.map(({ req, d }) => `<li class="px-5 py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><a href="#/details/${encodeURIComponent(req.id)}" class="text-sm font-medium text-brand-700 hover:underline">${esc(req.id)}</a><p class="truncate text-sm text-slate-700">${esc(req.title)}</p></div>
          ${statusBadge(req.status)}
        </div>
        <p class="mt-1 text-xs text-slate-500">${esc(userName(d.fromId))} → ${esc(userName(d.toId))} · ${esc(formatDateOnly(d.start))} – ${esc(formatDateOnly(d.end))}</p>
        <p class="break-anywhere mt-0.5 text-xs text-slate-500">${esc(d.reason)}</p>
      </li>`).join('')}</ul>`
    : emptyState({ iconName: 'users', title: 'No delegations yet', text: 'Delegations you make or receive will be listed here.' });

  return `${pageIntro('Hand a request to another approver while you are unavailable.')}
  <div class="grid gap-6 lg:grid-cols-5">
    <div class="${CLS.card} lg:col-span-3">${form}</div>
    <div class="lg:col-span-2">${card({ title: 'Delegation Activity', flush: true, body: activityBody })}</div>
  </div>`;
}

function updateDelegationHint() {
  const select = $('#dlg-requestId');
  const hint = $('#dlg-request-hint');
  if (!select || !hint) return;
  const req = findRequest(state, select.value);
  hint.textContent = req ? `${groupName(req.groupId)} · requested by ${userName(req.requesterId)} · currently ${req.status}` : '';
}

function submitDelegation(form) {
  const user = currentUser();
  const defs = delegationFieldDefs(user, '');
  const { values, errors } = validateForm(defs, form);
  if (!errors.startDate && values.startDate < todayISO()) errors.startDate = 'Start date cannot be in the past.';
  if (!errors.endDate && !errors.startDate && values.endDate < values.startDate) errors.endDate = 'End date must be on or after the start date.';
  const names = defs.filter((d) => !d.readonly).map((d) => d.name);
  if (Object.keys(errors).length) {
    showErrors(form, 'dlg', names, errors);
    setFormSummary(form, `Please fix ${plural(Object.keys(errors).length, 'problem')} below.`);
    return;
  }
  const req = findRequest(state, values.requestId);
  if (!req || !canAct(user, req)) {
    setFormSummary(form, 'That request is no longer available for delegation.');
    return;
  }
  const res = domainDelegate(state, req.id, user.id, { toId: values.delegateTo, start: values.startDate, end: values.endDate, reason: values.reason });
  if (!res.ok) { setFormSummary(form, res.error); toast(res.error, { type: 'error' }); return; }
  saveState();
  toast(`${req.id} delegated to ${userName(values.delegateTo)}.`);
  navigate('details', req.id);
}

/* ---------- G. Clarifications ---------- */

function lastActivity(req) {
  const last = req.clarifications[req.clarifications.length - 1];
  return last ? Date.parse(last.at) : Date.parse(req.updatedAt);
}

function renderClarifications() {
  const user = currentUser();
  const visible = visibleRequests(user);
  const threads = visible.filter((r) => r.clarifications.length).sort((a, b) => lastActivity(b) - lastActivity(a));
  const requested = visible.find((r) => r.id === ui.param);
  if (requested && !threads.includes(requested)) threads.unshift(requested);
  const selected = requested || threads[0];

  if (!threads.length) {
    return `${pageIntro('Approvers ask questions here and requesters respond.')}
    <div class="${CLS.card}">${emptyState({ iconName: 'message-circle-question', title: 'No clarification conversations', text: 'When an approver asks a question about a request, the conversation appears here.' })}</div>`;
  }

  const list = threads.map((r) => {
    const last = r.clarifications[r.clarifications.length - 1];
    const active = selected && selected.id === r.id;
    return `<li><a href="#/clarifications/${encodeURIComponent(r.id)}" ${active ? 'aria-current="true"' : ''} class="block px-4 py-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${active ? 'bg-brand-50' : ''}">
      <div class="flex items-center justify-between gap-2"><p class="truncate text-sm font-medium text-slate-900">${esc(r.title)}</p>${canRespond(user, r) ? '<span class="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Needs reply</span>' : ''}</div>
      <p class="mt-0.5 text-xs text-slate-500">${esc(r.id)} · ${esc(r.status)}</p>
      ${last ? `<p class="mt-1 truncate text-xs text-slate-500">${esc(userName(last.userId))}: ${esc(last.text)}</p>` : ''}
    </a></li>`;
  }).join('');

  const pane = selected
    ? card({
      title: selected.title, subtitle: `${selected.id} · ${groupName(selected.groupId)}`,
      actionsHTML: `<div class="flex items-center gap-3">${statusBadge(selected.status)}<a href="#/details/${encodeURIComponent(selected.id)}" class="text-sm font-medium text-brand-700 hover:underline">Open request</a></div>`,
      body: renderConversation(selected),
    })
    : '';

  return `${pageIntro('Approvers ask questions here and requesters respond. Answering returns the request to the approver.')}
  <div class="grid gap-6 lg:grid-cols-3">
    <div class="${CLS.card} overflow-hidden"><h2 class="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Conversations</h2><ul class="divide-y divide-slate-100">${list}</ul></div>
    <div class="lg:col-span-2" id="conversation-card">${pane}</div>
  </div>`;
}

/* ---------- I. Groups and users (admin) ---------- */

function renderAdmin() {
  const roleTone = { requester: 'bg-slate-100 text-slate-700', approver: 'bg-brand-50 text-brand-700', admin: 'bg-violet-50 text-violet-700' };
  const users = [...state.users].sort((a, b) => ALL_ROLES.indexOf(a.role) - ALL_ROLES.indexOf(b.role) || compareText(a.name, b.name));
  const approvers = state.users.filter((u) => u.role === 'approver');

  const userRows = users.map((u) => {
    const groups = state.groups.filter((g) => g.approverIds.includes(u.id)).map((g) => g.name);
    return `<tr class="border-b border-slate-100">
      <td class="px-4 py-3"><div class="flex items-center gap-3">${avatar(u)}<div class="min-w-0"><p class="truncate text-sm font-medium text-slate-900">${esc(u.name)}</p><p class="truncate text-xs text-slate-500">${esc(u.title || '—')}</p></div></div></td>
      <td class="hidden px-4 py-3 text-sm text-slate-600 md:table-cell">${esc(u.email)}</td>
      <td class="px-4 py-3"><span class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${roleTone[u.role]}">${esc(ROLES[u.role])}</span></td>
      <td class="hidden px-4 py-3 text-sm text-slate-600 sm:table-cell">${u.role === 'approver' ? esc(groups.join(', ') || 'No groups') : '—'}</td>
    </tr>`;
  }).join('');

  const groupCards = state.groups.map((g) => {
    const members = g.approverIds.map(userById).filter(Boolean);
    const candidates = approvers.filter((u) => !g.approverIds.includes(u.id));
    const count = state.requests.filter((r) => r.groupId === g.id).length;
    const chips = members.length
      ? members.map((u) => `<li class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-1 pr-2 text-sm text-slate-700">${avatar(u, 'h-6 w-6 text-[0.65rem]')}${esc(u.name)}
          <button type="button" data-action="remove-approver" data-group="${esc(g.id)}" data-user="${esc(u.id)}" class="rounded-full p-0.5 text-slate-400 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Remove ${esc(u.name)} from ${esc(g.name)}">${icon('x', 'h-3.5 w-3.5')}</button></li>`).join('')
      : '<li class="text-sm font-medium text-amber-700">No approvers assigned. Requests to this group cannot be submitted.</li>';
    return `<div class="rounded-xl p-4 ring-1 ring-slate-200">
      <div class="flex items-center justify-between gap-2"><h3 class="text-sm font-semibold text-slate-900">${esc(g.name)}</h3><span class="text-xs text-slate-500">${plural(count, 'request')}</span></div>
      <ul class="mt-3 flex flex-wrap gap-2" aria-label="Approvers of ${esc(g.name)}">${chips}</ul>
      <form data-form="add-approver" data-group="${esc(g.id)}" class="mt-4 flex gap-2">
        <label for="appr-${esc(g.id)}" class="sr-only">Assign an approver to ${esc(g.name)}</label>
        <select id="appr-${esc(g.id)}" name="userId" class="${CLS.input}" ${candidates.length ? '' : 'disabled'}>
          <option value="">${candidates.length ? 'Assign approver…' : 'All approvers assigned'}</option>
          ${candidates.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
        </select>
        <button type="submit" class="${btn('secondary')}" ${candidates.length ? '' : 'disabled'}>Add</button>
      </form>
    </div>`;
  }).join('');

  const groupForm = `<form data-form="add-group" novalidate class="grid gap-4 border-b border-slate-200 p-5 sm:grid-cols-3 sm:items-start">
    ${renderField({ name: 'name', label: 'New group name', type: 'text', required: true, min: 2, max: 40, placeholder: 'e.g. Finance' }, 'grp')}
    ${renderField({ name: 'approverId', label: 'First approver (optional)', type: 'select', placeholder: 'None yet', options: approvers.map((u) => ({ value: u.id, label: u.name })) }, 'grp')}
    <div class="sm:pt-6"><button type="submit" class="${btn('primary', 'w-full sm:w-auto')}">${icon('plus')} Create group</button></div>
  </form>`;

  return `${pageIntro('Manage who can use the system and which approvers receive each recipient group’s requests.')}
  <div class="space-y-6">
    ${card({
    title: 'Recipient Groups', subtitle: 'Requests go to the approvers assigned to the chosen group.', flush: true,
    body: `${groupForm}<div class="grid gap-4 p-5 md:grid-cols-2">${groupCards}</div>`,
  })}
    ${card({
    title: 'Users', flush: true,
    actionsHTML: `<button type="button" data-action="open-add-user" class="${btn('primary')}">${icon('user-plus')} Add user</button>`,
    body: `<div class="thin-scroll overflow-x-auto"><table class="data-table min-w-full"><thead class="bg-slate-50"><tr>
      <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
      <th scope="col" class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">Email</th>
      <th scope="col" class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
      <th scope="col" class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 sm:table-cell">Approver for</th>
    </tr></thead><tbody>${userRows}</tbody></table></div>`,
  })}
  </div>`;
}

/* =============================================================================
   8. ROUTER AND PAGE CHROME
   ============================================================================= */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, ...rest] = raw.split('/');
  return { route: path || 'dashboard', param: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

function navigate(route, param) {
  const hash = `#/${route}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (location.hash === hash) handleRoute();
  else location.hash = hash;
}

const defaultListRoute = (user) => (user.role === 'requester' ? 'my-requests' : 'approvals');

function handleRoute(opts = {}) {
  const user = currentUser();
  const parsed = parseHash();
  let { route, param } = parsed;
  let notice = '';

  if (!ROUTES[route]) {
    route = 'dashboard'; param = null;
  } else if (!ROUTES[route].roles.includes(user.role)) {
    notice = `${ROUTES[route].title} is not available for the ${ROLES[user.role]} role.`;
    route = 'dashboard'; param = null;
  } else if (route === 'details') {
    const req = findRequest(state, param);
    if (!req) { notice = 'That request could not be found.'; route = defaultListRoute(user); param = null; }
    else if (!canView(user, req)) { notice = 'You do not have access to that request in this role.'; route = 'dashboard'; param = null; }
  }

  const wanted = `#/${route}${param ? `/${encodeURIComponent(param)}` : ''}`;
  if (notice || !location.hash || !ROUTES[parsed.route]) history.replaceState(null, '', wanted);

  const changed = ui.route !== route || ui.param !== param;
  if (ui.route === 'create' && route !== 'create') ui.draftFile = null;
  ui.route = route;
  ui.param = param;
  closeNav();
  closeMenu(false);
  renderAll();

  if (changed || opts.forceFocus) {
    const title = $('#page-title');
    if (title) title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  if (notice && !opts.silent) toast(notice, { type: 'info' });
}

function navKeyFor(route, user) {
  if (route === 'details') return defaultListRoute(user);
  return route;
}

function renderNav() {
  const user = currentUser();
  const unread = unreadCount(user.id);
  const waiting = user.role === 'approver' ? state.requests.filter((r) => canAct(user, r)).length : 0;
  const activeKey = navKeyFor(ui.route, user);
  $('#nav-list').innerHTML = NAV_ORDER.filter((k) => ROUTES[k].roles.includes(user.role)).map((k) => {
    const active = activeKey === k;
    const count = k === 'notifications' ? unread : k === 'approvals' ? waiting : 0;
    const badge = count ? `<span class="ml-auto inline-flex min-w-[1.4rem] justify-center rounded-full ${k === 'notifications' ? 'bg-rose-600' : 'bg-brand-600'} px-1.5 text-xs font-semibold text-white" aria-label="${count} ${k === 'notifications' ? 'unread' : 'waiting'}">${count}</span>` : '';
    return `<li><a href="#/${k}" ${active ? 'aria-current="page"' : ''} class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}">${icon(ROUTES[k].icon, 'h-5 w-5 shrink-0')}<span>${esc(ROUTES[k].title)}</span>${badge}</a></li>`;
  }).join('');
}

function renderHeader() {
  const user = currentUser();
  const route = ROUTES[ui.route] || ROUTES.dashboard;
  $('#page-title').textContent = route.title;
  document.title = `${route.title} · Easy Approve`;

  const select = $('#role-switcher');
  if (!select.options.length) {
    select.innerHTML = Object.entries(ROLES).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('');
  }
  select.value = user.role;

  const unread = unreadCount(user.id);
  const badge = $('#bell-badge');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', !unread);
  $('#bell-link').setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');

  $('#profile-avatar').innerHTML = avatar(user, 'h-8 w-8 text-xs');
  $('#profile-name').textContent = user.name;
  $('#profile-role').textContent = ROLES[user.role];
  $('#profile-btn').setAttribute('aria-label', `Account menu for ${user.name}, ${ROLES[user.role]}`);
}

function renderAll() {
  renderNav();
  renderHeader();
  renderView();
  if (ui.route === 'create') updateRecipientHint();
  if (ui.route === 'delegation') updateDelegationHint();
  refreshIcons();
  if (!document.activeElement || document.activeElement === document.body) {
    const main = $('#main');
    if (main) main.focus({ preventScroll: true });
  }
}

function openNav() {
  $('#sidebar').dataset.open = 'true';
  $('#sidebar-overlay').classList.remove('hidden');
  $('#btn-open-nav').setAttribute('aria-expanded', 'true');
  const first = $('#nav-list a');
  if (first) first.focus({ preventScroll: true });
}

function closeNav() {
  const sidebar = $('#sidebar');
  if (!sidebar || sidebar.dataset.open !== 'true') return;
  sidebar.dataset.open = 'false';
  $('#sidebar-overlay').classList.add('hidden');
  $('#btn-open-nav').setAttribute('aria-expanded', 'false');
}

function switchRole(role) {
  const user = currentUser();
  if (user.role === role) return;
  const next = state.users.find((u) => u.role === role);
  if (!next) { toast(`There is no ${ROLES[role]} user yet.`, { type: 'error' }); renderHeader(); return; }
  setSessionUser(next.id);
  handleRoute({ silent: true, forceFocus: true });
  toast(`Now viewing as ${next.name} (${ROLES[role]}). Role checks in this prototype are a demo simulation, not security.`, { type: 'info' });
}

function switchUser(userId) {
  if (!userById(userId) || userId === session.userId) return;
  setSessionUser(userId);
  handleRoute({ silent: true, forceFocus: true });
  toast(`Now viewing as ${currentUser().name}.`, { type: 'info' });
}

/* =============================================================================
   9. ACTIONS AND EVENT WIRING
   ============================================================================= */

function afterAction(res, message) {
  if (!res.ok) { toast(res.error, { type: 'error' }); return false; }
  commit();
  toast(message);
  return true;
}

function guardAct(req) {
  if (req && canAct(currentUser(), req)) return true;
  toast('You cannot take that action on this request.', { type: 'error' });
  return false;
}

function startApprove(id) {
  const req = findRequest(state, id);
  if (!req || !guardAct(req)) return;
  openModal({
    title: 'Approve request',
    description: `You are about to approve “${req.title}” (${req.id}). ${userName(req.requesterId)} will be notified.`,
    confirmLabel: 'Approve', tone: 'success',
    fields: [{ name: 'note', label: 'Comment (optional)', type: 'textarea', rows: 3, max: 500, placeholder: 'Add a note for the requester' }],
    onSubmit: (v) => afterAction(domainApprove(state, id, currentUser().id, v.note), `${id} approved.`),
  });
}

function startReject(id) {
  const req = findRequest(state, id);
  if (!req || !guardAct(req)) return;
  openModal({
    title: 'Reject request',
    description: `Reject “${req.title}” (${req.id})? The requester will see your reason.`,
    confirmLabel: 'Reject', tone: 'danger',
    fields: [{ name: 'reason', label: 'Reason for rejection', type: 'textarea', required: true, min: 5, max: 500, rows: 3, placeholder: 'Explain why this request is being rejected' }],
    onSubmit: (v) => afterAction(domainReject(state, id, currentUser().id, v.reason), `${id} rejected.`),
  });
}

function startClarify(id) {
  const req = findRequest(state, id);
  if (!req || !guardAct(req)) return;
  openModal({
    title: 'Request clarification',
    description: `Ask ${userName(req.requesterId)} a question about “${req.title}”. The request will be marked Clarification Requested until they reply.`,
    confirmLabel: 'Send question', tone: 'primary',
    fields: [{ name: 'question', label: 'Your question', type: 'textarea', required: true, min: 5, max: 500, rows: 3, placeholder: 'What do you need clarified?' }],
    onSubmit: (v) => afterAction(domainClarify(state, id, currentUser().id, v.question), `Clarification requested on ${id}.`),
  });
}

function startReset() {
  openModal({
    title: 'Reset demo data?',
    description: 'This replaces all requests, users, groups and notifications with the original sample data.',
    confirmLabel: 'Reset data', tone: 'danger',
    onSubmit: () => {
      state = createSeedState();
      ui.lists = { approvals: defaultList(), mine: defaultList() };
      ui.draftFile = null;
      ui.notifFilter = 'all';
      ensureSessionUser();
      saveState();
      navigate('dashboard');
      toast('Demo data has been reset.');
    },
  });
}

function startAddUser() {
  openModal({
    title: 'Add user',
    description: 'New approvers can then be assigned to recipient groups.',
    confirmLabel: 'Add user',
    fields: [
      { name: 'name', label: 'Full name', type: 'text', required: true, min: 2, max: 60 },
      { name: 'email', label: 'Email', type: 'email', required: true, max: 80 },
      { name: 'role', label: 'Role', type: 'select', required: true, requiredMessage: 'Choose a role.', placeholder: 'Select a role', options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
      { name: 'title', label: 'Job title (optional)', type: 'text', max: 60 },
    ],
    validate: (v) => (state.users.some((u) => u.email.toLowerCase() === v.email.toLowerCase()) ? { email: 'A user with this email already exists.' } : {}),
    onSubmit: (v) => {
      const res = domainAddUser(state, v);
      afterAction(res, `${res.data.name} added as ${ROLES[res.data.role]}.`);
    },
  });
}

function profileMenuItems() {
  const user = currentUser();
  const sameRole = state.users.filter((u) => u.role === user.role);
  return [
    { type: 'label', label: user.name, sub: `${ROLES[user.role]} · ${user.title}` },
    { type: 'sep' },
    { type: 'heading', label: `Switch ${ROLES[user.role].toLowerCase()} user` },
    ...sameRole.map((u) => ({ label: u.name, icon: 'user', action: 'switch-user', data: { id: u.id }, checked: u.id === user.id })),
    { type: 'sep' },
    { label: 'Reset demo data', icon: 'rotate-ccw', action: 'reset-demo', tone: 'danger' },
  ];
}

function markRead(id, { render = true } = {}) {
  const n = state.notifications.find((x) => x.id === id);
  if (!n || n.read) return;
  n.read = true;
  saveState();
  if (render) renderAll();
}

const ACTIONS = {
  'open-nav': () => openNav(),
  'close-nav': () => closeNav(),
  'dismiss-toast': (el) => { const t = el.closest('.toast'); if (t) t.remove(); },
  'close-modal': () => closeModal(),

  'open-row-menu': (el) => {
    if (ui.menu && ui.menu.anchor === el) { closeMenu(); return; }
    const req = findRequest(state, el.dataset.id);
    if (req) openMenu(el, rowMenuItems(req));
  },
  'open-profile-menu': (el) => {
    if (ui.menu && ui.menu.anchor === el) { closeMenu(); return; }
    openMenu(el, profileMenuItems());
  },
  'switch-user': (el) => { closeMenu(false); switchUser(el.dataset.id); },
  'reset-demo': () => { closeMenu(false); startReset(); },

  view: (el) => { closeMenu(false); navigate('details', el.dataset.id); },
  approve: (el) => { closeMenu(); startApprove(el.dataset.id); },
  reject: (el) => { closeMenu(); startReject(el.dataset.id); },
  clarify: (el) => { closeMenu(); startClarify(el.dataset.id); },
  delegate: (el) => { closeMenu(false); navigate('delegation', el.dataset.id); },
  respond: (el) => { closeMenu(false); navigate('clarifications', el.dataset.id); },
  'focus-composer': () => {
    const card = $('#conversation-card');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });
    const field = $('#conv-text');
    if (field) field.focus({ preventScroll: true });
  },
  'download-attachment': () => toast('This is a prototype: attachments are not stored, only their names.', { type: 'info' }),

  sort: (el) => {
    const l = ui.lists[el.dataset.list];
    const key = el.dataset.key;
    if (l.sortKey === key) l.sortDir = l.sortDir === 'asc' ? 'desc' : 'asc';
    else { l.sortKey = key; l.sortDir = key === 'submittedAt' ? 'desc' : 'asc'; }
    l.page = 1;
    updateListRegion(el.dataset.list, `[data-action="sort"][data-list="${el.dataset.list}"][data-key="${key}"]`);
  },
  page: (el) => {
    const key = el.dataset.list;
    ui.lists[key].page = Number(el.dataset.page);
    updateListRegion(key, `#list-region-${key}`);
  },
  'clear-filters': (el) => {
    const key = el.dataset.list;
    const l = ui.lists[key];
    Object.assign(l, { q: '', status: '', group: '', page: 1 });
    const q = $(`#${key}-q`); if (q) q.value = '';
    const s = $(`#${key}-status`); if (s) s.value = '';
    const g = $(`#${key}-group`); if (g) g.value = '';
    updateListRegion(key);
  },

  'notif-filter': (el) => { ui.notifFilter = el.dataset.value; renderAll(); },
  'mark-read': (el) => markRead(el.dataset.id),
  'open-notification': (el) => markRead(el.dataset.id, { render: false }),
  'mark-all-read': () => {
    const user = currentUser();
    state.notifications.forEach((n) => { if (n.userId === user.id) n.read = true; });
    commit();
    toast('All notifications marked as read.');
  },

  'remove-attachment': () => {
    const input = $('#create-attachment'); if (input) input.value = '';
    setDraftFile(null);
  },
  'cancel-create': () => {
    const form = $('#create-form');
    const dirty = form && (form.elements.title.value.trim() || form.elements.description.value.trim() || form.elements.groupId.value || ui.draftFile);
    if (!dirty) { navigate('dashboard'); return; }
    openModal({
      title: 'Discard this request?', description: 'The details you entered will be lost.',
      confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger',
      onSubmit: () => { ui.draftFile = null; navigate('dashboard'); },
    });
  },
  'cancel-delegation': () => navigate(ui.param ? 'details' : 'approvals', ui.param || undefined),

  'open-add-user': () => startAddUser(),
  'remove-approver': (el) => {
    const group = groupById(el.dataset.group);
    const user = userById(el.dataset.user);
    if (!group || !user) return;
    openModal({
      title: `Remove ${user.name}?`,
      description: `${user.name} will no longer receive new requests for ${group.name}.`,
      confirmLabel: 'Remove', tone: 'danger',
      onSubmit: () => afterAction(domainRemoveApprover(state, group.id, user.id), `${user.name} removed from ${group.name}.`),
    });
  },
};

function onClick(e) {
  if (ui.menu && !e.target.closest('#floating-menu') && !e.target.closest('[data-menu-anchor]')) closeMenu(false);
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const handler = ACTIONS[target.dataset.action];
  if (!handler) return;
  if (target.matches('button, [role="menuitem"]')) e.preventDefault();
  handler(target, e);
}

function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  switch (form.dataset.form) {
    case 'modal': submitModal(form); break;
    case 'global-search': {
      const user = currentUser();
      const key = user.role === 'requester' ? 'mine' : 'approvals';
      ui.lists[key].q = form.elements.q.value.trim();
      ui.lists[key].page = 1;
      form.reset();
      closeNav();
      navigate(user.role === 'requester' ? 'my-requests' : 'approvals');
      break;
    }
    case 'create-request': submitCreateRequest(form); break;
    case 'delegation': submitDelegation(form); break;
    case 'clarify-compose': submitConversation(form, 'clarify'); break;
    case 'respond-compose': submitConversation(form, 'respond'); break;
    case 'comment': submitComment(form); break;
    case 'add-group': submitAddGroup(form); break;
    case 'add-approver': submitAddApprover(form); break;
    default: break;
  }
}

function submitConversation(form, kind) {
  const def = { name: 'text', label: kind === 'clarify' ? 'Question' : 'Response', type: 'textarea', required: true, min: kind === 'clarify' ? 5 : 2, max: 500 };
  const { values, errors } = validateForm([def], form);
  if (errors.text) { showErrors(form, 'conv', ['text'], errors); return; }
  const id = form.dataset.id;
  const user = currentUser();
  if (kind === 'clarify') {
    const req = findRequest(state, id);
    if (!req || !guardAct(req)) return;
    afterAction(domainClarify(state, id, user.id, values.text), `Clarification requested on ${id}.`);
  } else {
    const req = findRequest(state, id);
    if (!req || !canRespond(user, req)) { toast('You cannot respond to this request.', { type: 'error' }); return; }
    afterAction(domainRespond(state, id, user.id, values.text), 'Your response was sent to the approver.');
  }
}

function submitComment(form) {
  const def = { name: 'text', label: 'Comment', type: 'textarea', required: true, min: 2, max: 500 };
  const { values, errors } = validateForm([def], form);
  if (errors.text) { showErrors(form, 'cmt', ['text'], errors); return; }
  afterAction(domainComment(state, form.dataset.id, currentUser().id, values.text), 'Comment posted.');
}

function submitAddGroup(form) {
  const defs = [
    { name: 'name', label: 'Group name', type: 'text', required: true, min: 2, max: 40 },
    { name: 'approverId', label: 'First approver', type: 'select' },
  ];
  const { values, errors } = validateForm(defs, form);
  if (!errors.name && state.groups.some((g) => g.name.toLowerCase() === values.name.toLowerCase())) errors.name = 'A group with this name already exists.';
  if (Object.keys(errors).length) { showErrors(form, 'grp', ['name'], errors); return; }
  const res = domainAddGroup(state, values);
  afterAction(res, `Group “${res.data.name}” created.`);
}

function submitAddApprover(form) {
  const userId = form.elements.userId.value;
  if (!userId) { toast('Choose an approver to assign.', { type: 'error' }); form.elements.userId.focus(); return; }
  const group = groupById(form.dataset.group);
  afterAction(domainAssignApprover(state, form.dataset.group, userId), `${userName(userId)} assigned to ${group ? group.name : 'the group'}.`);
}

function onInput(e) {
  const el = e.target;
  if (el.matches('[aria-invalid="true"]')) clearFieldError(el);
  if (el.dataset.counter) {
    const counter = $(`[data-counter-for="${el.id}"]`);
    if (counter) counter.textContent = `${el.value.length} / ${el.dataset.counter}`;
  }
  if (el.dataset.list && el.dataset.listField === 'q') {
    const l = ui.lists[el.dataset.list];
    l.q = el.value;
    l.page = 1;
    updateListRegion(el.dataset.list);
  }
}

function onChange(e) {
  const el = e.target;
  if (el.id === 'role-switcher') { switchRole(el.value); return; }
  if (el.dataset.list && el.dataset.listField && el.dataset.listField !== 'q') {
    const key = el.dataset.list;
    const l = ui.lists[key];
    const field = el.dataset.listField;
    l[field] = field === 'pageSize' ? Number(el.value) : el.value;
    l.page = 1;
    updateListRegion(key, field === 'pageSize' ? `#${key}-pagesize` : null);
    return;
  }
  if (el.id === 'create-groupId') updateRecipientHint();
  if (el.id === 'dlg-requestId') updateDelegationHint();
  if (el.id === 'create-attachment') setDraftFile(el.files && el.files[0] ? el.files[0] : null);
  if (el.matches('[aria-invalid="true"]')) clearFieldError(el);
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    if (ui.modal) { closeModal(); return; }
    if (ui.menu) { closeMenu(); return; }
    const sidebar = $('#sidebar');
    if (sidebar && sidebar.dataset.open === 'true') { closeNav(); const b = $('#btn-open-nav'); if (b) b.focus(); }
    return;
  }
  if (ui.modal && e.key === 'Tab') { trapFocus(e); return; }
  if (ui.menu) onMenuKeydown(e);
}

function onDragEvents(e) {
  const zone = e.target.closest && e.target.closest('#dropzone');
  if (!zone) return;
  if (e.type === 'dragover' || e.type === 'dragenter') { e.preventDefault(); zone.dataset.dragging = 'true'; }
  else if (e.type === 'dragleave') { zone.dataset.dragging = 'false'; }
  else if (e.type === 'drop') {
    e.preventDefault();
    zone.dataset.dragging = 'false';
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) setDraftFile(file);
  }
}

function onStorage(e) {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  try {
    const parsed = JSON.parse(e.newValue);
    if (!isValidState(parsed)) return;
    state = parsed;
    ensureSessionUser();
    handleRoute({ silent: true });
  } catch (error) { /* ignore malformed data from another tab */ }
}

function bindEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((t) => document.addEventListener(t, onDragEvents));
  window.addEventListener('hashchange', () => handleRoute());
  window.addEventListener('storage', onStorage);
  window.addEventListener('resize', () => closeMenu(false));
  window.addEventListener('scroll', () => closeMenu(false), true);
}

/* =============================================================================
   10. INIT
   ============================================================================= */

function init() {
  state = loadState();
  loadSession();
  bindEvents();
  handleRoute({ silent: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

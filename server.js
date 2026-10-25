const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch {}

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => { const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); });

const PORT = Number(process.env.PORT || (() => { const i = process.argv.indexOf("--port"); return i > -1 ? process.argv[i + 1] : 3000; })());
const HOST = process.env.HOST || (() => { const i = process.argv.indexOf("--host"); return i > -1 ? (process.argv[i + 1] || "127.0.0.1") : "127.0.0.1"; })();
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.AMEEN_DATA_DIR || path.join(ROOT, "data"));
const STORE_PATH = path.join(DATA_DIR, "store.json");
const DATABASE_PATH = path.resolve(process.env.AMEEN_DATABASE_PATH || path.join(DATA_DIR, "ameen.sqlite"));
const SCHEMA_PATH = path.join(ROOT, "db", "schema.sql");
const UPLOAD_DIR = path.resolve(process.env.AMEEN_UPLOAD_DIR || path.join(ROOT, "uploads"));
const production = process.env.NODE_ENV === "production";
const AV_SCAN_REQUIRED = production || process.env.AV_SCAN_REQUIRED === "true";
const CLAMSCAN_PATH = process.env.CLAMSCAN_PATH || "clamscan";
const CLAMSCAN_TIMEOUT_MS = 120_000;
const SESSION_SECRET = process.env.SESSION_SECRET || (!production ? crypto.randomBytes(32).toString("hex") : "");
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@ameen.local").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (!production ? "ChangeMe123!" : "");
const ADMIN_RESET_PASSWORD = process.env.ADMIN_RESET_PASSWORD || "";
const looksLikePlaceholder = (value) => /^(replace|change|example|your|placeholder)[-_ ]/i.test(String(value || ""));
function productionConfigurationError() {
  const problems = [];
  if (SESSION_SECRET.length < 32 || looksLikePlaceholder(SESSION_SECRET)) problems.push("SESSION_SECRET must be a unique secret of at least 32 characters.");
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 14 || !/[a-z]/.test(ADMIN_PASSWORD) || !/[A-Z]/.test(ADMIN_PASSWORD) || !/\d/.test(ADMIN_PASSWORD) || !/[^A-Za-z0-9]/.test(ADMIN_PASSWORD) || looksLikePlaceholder(ADMIN_PASSWORD)) problems.push("ADMIN_PASSWORD must be unique, at least 14 characters, and include upper/lowercase letters, a number, and a symbol.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ADMIN_EMAIL) || /example\.|\.local$/i.test(ADMIN_EMAIL)) problems.push("ADMIN_EMAIL must be a real administrator email address.");
  if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) problems.push("HOST must use a loopback address so the Contabo Nginx reverse proxy is the only public entry point.");
  try {
    const site = new URL(process.env.SITE_URL || "");
    if (site.protocol !== "https:" || site.pathname !== "/" || site.search || site.hash || looksLikePlaceholder(site.hostname)) problems.push("SITE_URL must be the real public HTTPS origin of the site, without a path.");
  } catch { problems.push("SITE_URL must be set to the public HTTPS origin of the site."); }
  if (!process.env.AMEEN_DATA_DIR || !process.env.AMEEN_UPLOAD_DIR) problems.push("AMEEN_DATA_DIR and AMEEN_UPLOAD_DIR must point to persistent directories outside the release folder.");
  for (const [label, directory] of [["AMEEN_DATA_DIR", DATA_DIR], ["AMEEN_UPLOAD_DIR", UPLOAD_DIR]]) {
    const relative = path.relative(ROOT, directory);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) problems.push(`${label} must resolve outside the application release folder.`);
  }
  const databaseRelative = path.relative(ROOT, DATABASE_PATH);
  if (databaseRelative === "" || (!databaseRelative.startsWith("..") && !path.isAbsolute(databaseRelative))) problems.push("AMEEN_DATABASE_PATH must resolve outside the application release folder.");
  if (DATA_DIR.toLowerCase() === UPLOAD_DIR.toLowerCase()) problems.push("AMEEN_DATA_DIR and AMEEN_UPLOAD_DIR must be separate directories.");
  const fawryValues = [process.env.FAWRY_MERCHANT_CODE, process.env.FAWRY_SECURE_KEY, process.env.FAWRY_WEBHOOK_URL].filter(Boolean).length;
  if (fawryValues > 0 && fawryValues < 3) problems.push("Configure FAWRY_MERCHANT_CODE, FAWRY_SECURE_KEY and FAWRY_WEBHOOK_URL together, or leave all three unset.");
  if (fawryValues === 3) {
    try {
      const hook = new URL(process.env.FAWRY_WEBHOOK_URL);
      const site = new URL(process.env.SITE_URL);
      if (hook.protocol !== "https:" || hook.origin !== site.origin || hook.pathname !== "/api/payments/fawry/webhook") problems.push("FAWRY_WEBHOOK_URL must be the HTTPS /api/payments/fawry/webhook endpoint on SITE_URL.");
    } catch { problems.push("FAWRY_WEBHOOK_URL must be a valid public HTTPS URL."); }
    if (!fawryEndpointAllowed()) problems.push("FAWRY_API_URL is not an approved HTTPS Fawry endpoint for production.");
  }
  return problems;
}
if (process.env.RESET_ADMIN_PASSWORD === "true" && (ADMIN_RESET_PASSWORD.length < 14 || !/[a-z]/.test(ADMIN_RESET_PASSWORD) || !/[A-Z]/.test(ADMIN_RESET_PASSWORD) || !/\d/.test(ADMIN_RESET_PASSWORD) || !/[^A-Za-z0-9]/.test(ADMIN_RESET_PASSWORD) || looksLikePlaceholder(ADMIN_RESET_PASSWORD))) {
  console.error("ADMIN_RESET_PASSWORD must be a unique password of at least 12 characters.");
  process.exit(1);
}
if (!production && (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD)) console.warn("Development defaults are active. Set SESSION_SECRET and ADMIN_PASSWORD before exposing this server.");
if (!["127.0.0.1", "localhost", "::1"].includes(HOST) && !production && (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD)) {
  console.error("A non-local HOST requires explicit SESSION_SECRET and ADMIN_PASSWORD values.");
  process.exit(1);
}
const TEACHER_CONTACT_PHONE = process.env.TEACHER_CONTACT_PHONE || "+20 10 94747124";
const mailer = nodemailer && process.env.SMTP_HOST ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === "465", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }) : null;
const PROTECTED_PAGES = {
  "/admin.html": ["admin"],
  "/teacher-dashboard.html": ["teacher", "admin"],
  "/create-course.html": ["teacher", "admin"],
  "/student-progress.html": ["admin", "teacher"],
  "/student-dashboard.html": ["student", "teacher", "admin"],
  "/create-lesson.html": ["teacher", "admin"],
  "/profile.html": ["student", "teacher", "admin"],
  "/chat.html": ["student", "teacher", "admin"],
  "/messages.html": ["student", "teacher", "admin"],
  "/certificate.html": ["student"],
};
const PUBLIC_PAGES = new Set([
  "/index.html", "/about.html", "/contact.html", "/courses.html", "/course-details.html",
  "/lesson.html", "/lessons.html", "/exams.html", "/login.html", "/register.html",
  "/forgot-password.html", "/admin.html", "/teacher-dashboard.html", "/student-progress.html",
  "/student-dashboard.html", "/create-course.html", "/create-lesson.html", "/profile.html",
  "/chat.html", "/messages.html", "/certificate.html",
]);
const SEARCHABLE_PAGES = new Set(["/", "/index.html", "/about.html", "/contact.html", "/courses.html"]);
const SEARCH_BASE_URL = (() => {
  try {
    const url = new URL(process.env.SITE_URL || "");
    return url.protocol === "https:" ? url.origin : "";
  } catch { return ""; }
})();
const FAWRY_MERCHANT_CODE = process.env.FAWRY_MERCHANT_CODE || "";
const FAWRY_SECURE_KEY = process.env.FAWRY_SECURE_KEY || "";
const FAWRY_API_URL = process.env.FAWRY_API_URL || (production ? "https://www.atfawry.com/ECommerceWeb/Fawry/payments/charge" : "https://atfawry.fawrystaging.com/ECommerceWeb/Fawry/payments/charge");
const FAWRY_WEBHOOK_URL = process.env.FAWRY_WEBHOOK_URL || (SEARCH_BASE_URL ? `${SEARCH_BASE_URL}/api/payments/fawry/webhook` : "");
function fawryEndpointAllowed() {
  try { const url = new URL(FAWRY_API_URL); const allowedHosts = production ? ["www.atfawry.com"] : ["atfawry.fawrystaging.com", "www.atfawry.com"]; return url.protocol === "https:" && allowedHosts.includes(url.hostname) && url.pathname === "/ECommerceWeb/Fawry/payments/charge"; } catch { return false; }
}
const FAWRY_CONFIGURED = Boolean(FAWRY_MERCHANT_CODE && FAWRY_SECURE_KEY && FAWRY_WEBHOOK_URL.startsWith("https://") && fawryEndpointAllowed());
if (production) {
  const problems = productionConfigurationError();
  if (problems.length) {
    console.error("Production configuration is incomplete:");
    problems.forEach((problem) => console.error(`- ${problem}`));
    process.exit(1);
  }
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};
const verifyPassword = (password, stored) => {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
};
const sign = (payload) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
};
const verifyToken = (token) => {
  try {
    const [encoded, signature] = token.split(".");
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
};

function initialStore() {
  return { users: [{ id: id(), name: "مدير المنصة", email: ADMIN_EMAIL, role: "admin", grade: "", phone: "", avatarUrl: "", passwordHash: hashPassword(ADMIN_PASSWORD), sessionVersion: 0, createdAt: now(), active: true }], courses: [], lessons: [], enrollments: [], courseRequests: [], paymentOrders: [], chatGroups: [], passwordResetRequests: [], notifications: [], chatMessages: [], chatDeletedMessageIds: [], directMessages: [], progress: [], watchEvents: [], quizAttempts: [], exams: [], contactMessages: [], audit: [] };
}
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
if (AV_SCAN_REQUIRED) {
  const scannerCheck = spawnSync(CLAMSCAN_PATH, ["--version"], { encoding: "utf8", timeout: 5_000, windowsHide: true });
  if (scannerCheck.error || scannerCheck.status !== 0) console.warn("ClamAV is required for uploads but is not available; uploads will be rejected until CLAMSCAN_PATH is installed and working.");
}
if (production) {
  try {
    fs.accessSync(path.dirname(DATABASE_PATH), fs.constants.W_OK);
    fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
  } catch {
    console.error("Production storage directories must exist or be creatable and writable by the application user.");
    process.exit(1);
  }
}
const database = new DatabaseSync(DATABASE_PATH);
try { fs.chmodSync(DATABASE_PATH, 0o600); } catch {}
database.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
function ensureColumn(table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn("users", "avatar_url", "TEXT NOT NULL DEFAULT ''");
ensureColumn("courses", "category", "TEXT NOT NULL DEFAULT ''");
ensureColumn("courses", "price_piasters", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("courses", "is_free", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("courses", "grade_level", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("courses", "requires_approval", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("chat_messages", "group_id", "TEXT NOT NULL DEFAULT 'global'");
ensureColumn("direct_messages", "attachment_json", "TEXT");
const chatGroupsSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_groups'").get()?.sql || "";
if (!chatGroupsSql.includes("first-secondary")) {
  database.exec("BEGIN; CREATE TABLE chat_groups_next (id TEXT PRIMARY KEY, grade TEXT NOT NULL UNIQUE CHECK (grade IN ('prep', 'secondary', 'first-secondary', 'second-secondary', 'third-secondary')), created_at TEXT NOT NULL); INSERT INTO chat_groups_next SELECT id, grade, created_at FROM chat_groups; DROP TABLE chat_groups; ALTER TABLE chat_groups_next RENAME TO chat_groups; COMMIT;");
}
database.exec("UPDATE chat_messages SET group_id = 'grade:prep' WHERE group_id = 'global'; CREATE INDEX IF NOT EXISTS idx_chat_messages_group_created ON chat_messages(group_id, created_at DESC);");

function fromDatabase() {
  const all = (sql) => database.prepare(sql).all();
  const parseJson = (value, fallback = null) => value == null ? fallback : JSON.parse(value);
  const users = all("SELECT * FROM users").map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, grade: row.grade, phone: row.phone, avatarUrl: row.avatar_url || "", passwordHash: row.password_hash, active: Boolean(row.active), sessionVersion: row.session_version, createdAt: row.created_at, ...(row.updated_at ? { updatedAt: row.updated_at } : {}) }));
  const lessons = all("SELECT * FROM lessons ORDER BY course_id, position").map((row) => ({ id: row.id, courseId: row.course_id, title: row.title, videoUrl: row.video_url, pdfUrl: row.pdf_url, isFree: Boolean(row.is_free), position: row.position, maxViews: row.max_views, questions: [], createdAt: row.created_at, updatedAt: row.updated_at }));
  const lessonById = new Map(lessons.map((item) => [item.id, item]));
  for (const question of all("SELECT * FROM lesson_questions ORDER BY lesson_id, position")) {
    const lesson = lessonById.get(question.lesson_id);
    if (lesson) lesson.questions.push({ question: question.prompt, answer: question.answer, options: all("SELECT option_text FROM lesson_question_options WHERE question_id = ? ORDER BY position").map((item) => item.option_text) });
  }
  const exams = all("SELECT * FROM exams").map((row) => ({ id: row.id, courseId: row.course_id, title: row.title, description: row.description, questions: [], createdAt: row.created_at, updatedAt: row.updated_at }));
  const examById = new Map(exams.map((item) => [item.id, item]));
  for (const question of all("SELECT * FROM exam_questions ORDER BY exam_id, position")) {
    const exam = examById.get(question.exam_id);
    if (exam) exam.questions.push({ prompt: question.prompt, imageUrl: question.image_url, answerIndex: question.answer_index, options: all("SELECT option_text FROM exam_question_options WHERE question_id = ? ORDER BY position").map((item) => item.option_text) });
  }
  return {
    users,
    courses: all("SELECT * FROM courses").map((r) => ({ id:r.id, title:r.title, description:r.description, grade:Number(r.grade_level) > 0 ? SECONDARY_GRADES[Number(r.grade_level) - 1] : r.grade, category:r.category || "", cover:r.cover, pricePiasters:r.price_piasters || 0, isFree:Boolean(r.is_free), ownerId:r.owner_id, accessCode:r.access_code, published:Boolean(r.published), requiresApproval:r.requires_approval !== 0, maxViews:r.max_views, createdAt:r.created_at, updatedAt:r.updated_at })),
    lessons,
    enrollments: all("SELECT * FROM enrollments").map((r) => ({ id:r.id, courseId:r.course_id, userId:r.user_id, ...(r.request_id ? { requestId:r.request_id } : {}), source:r.source, createdAt:r.created_at })),
    courseRequests: all("SELECT * FROM course_requests").map((r) => ({ id:r.id, courseId:r.course_id, studentId:r.student_id, teacherId:r.teacher_id, phone:r.phone, requestCode:r.request_code, status:r.status, createdAt:r.created_at, ...(r.handled_at ? { handledAt:r.handled_at } : {}), ...(r.handled_by ? { handledBy:r.handled_by } : {}) })),
    passwordResetRequests: all("SELECT * FROM password_reset_requests").map((r) => ({ id:r.id, userId:r.user_id, email:r.email, status:r.status, createdAt:r.created_at, ...(r.handled_at ? { handledAt:r.handled_at } : {}) })),
    notifications: all("SELECT * FROM notifications").map((r) => ({ id:r.id, userId:r.user_id, title:r.title, message:r.message, link:r.link, read:Boolean(r.is_read), createdAt:r.created_at })),
    progress: all("SELECT p.*, l.course_id FROM progress p JOIN lessons l ON l.id=p.lesson_id").map((r) => ({ id:r.id, userId:r.user_id, lessonId:r.lesson_id, courseId:r.course_id, position:r.position, completed:Boolean(r.completed), updatedAt:r.updated_at })),
    watchEvents: all("SELECT * FROM watch_events").map((r) => ({ id:r.id, userId:r.user_id, lessonId:r.lesson_id, createdAt:r.created_at })),
    quizAttempts: all("SELECT * FROM quiz_attempts").map((r) => ({ id:r.id, userId:r.user_id, ...(r.lesson_id ? { lessonId:r.lesson_id } : {}), ...(r.exam_id ? { examId:r.exam_id } : {}), ...(r.course_id ? { courseId:r.course_id } : {}), score:r.score, total:r.total, createdAt:r.created_at })),
    exams,
    chatMessages: all("SELECT * FROM chat_messages ORDER BY created_at").map((r) => ({ id:r.id, author:{ id:r.author_id, name:r.author_name, role:r.author_role }, text:r.text, ...(parseJson(r.attachment_json) ? { attachment:parseJson(r.attachment_json) } : {}), isQuestion:Boolean(r.is_question), ...(parseJson(r.reply_to_json) ? { replyTo:parseJson(r.reply_to_json) } : {}), groupId:r.group_id || "global", createdAt:r.created_at })),
    chatDeletedMessageIds: all("SELECT message_id FROM chat_deleted_messages").map((r) => r.message_id),
    directMessages: all("SELECT * FROM direct_messages").map((r) => ({ id:r.id, senderId:r.sender_id, recipientId:r.recipient_id, text:r.text, ...(parseJson(r.attachment_json) ? { attachment:parseJson(r.attachment_json) } : {}), createdAt:r.created_at, readAt:r.read_at || null })),
    chatGroups: all("SELECT * FROM chat_groups").map((r) => ({ id:r.id, grade:r.grade, createdAt:r.created_at })),
    paymentOrders: all("SELECT * FROM payment_orders").map((r) => ({ id:r.id, userId:r.user_id, courseId:r.course_id, merchantRefNum:r.merchant_ref_num, fawryRefNumber:r.fawry_ref_number, amountPiasters:r.amount_piasters, status:r.status, paymentMethod:r.payment_method, createdAt:r.created_at, updatedAt:r.updated_at })),
    contactMessages: all("SELECT * FROM contact_messages ORDER BY created_at DESC").map((r) => ({ id:r.id, name:r.name, email:r.email, subject:r.subject, message:r.message, createdAt:r.created_at })),
    audit: all("SELECT * FROM audit_log ORDER BY created_at DESC").map((r) => ({ id:r.id, actorId:r.actor_id, action:r.action, target:r.target, meta:parseJson(r.meta_json, {}), createdAt:r.created_at })),
  };
}

function saveStore(store, tablesToSave = null) {
  const insertMany = (sql, rows, map) => { const stmt = database.prepare(sql); for (const row of rows || []) stmt.run(...map(row)); };
  const shouldSave = (tbl) => !tablesToSave || tablesToSave.includes(tbl);
  const allTables = ["chat_messages", "chat_deleted_messages", "chat_groups", "direct_messages", "payment_orders", "notifications", "course_requests", "password_reset_requests", "progress", "watch_events", "quiz_attempts", "lesson_question_options", "lesson_questions", "exam_question_options", "exam_questions", "exams", "enrollments", "lessons", "courses", "contact_messages", "audit_log", "users"];
  const targets = tablesToSave ? allTables.filter((t) => tablesToSave.includes(t)) : allTables;
  database.exec("PRAGMA defer_foreign_keys = ON; BEGIN IMMEDIATE;");
  try {
    targets.forEach((table) => database.exec(`DELETE FROM ${table}`));
    if (shouldSave("users")) insertMany("INSERT INTO users (id,name,email,role,grade,phone,password_hash,active,session_version,created_at,updated_at,avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", store.users, (r) => [r.id,r.name,r.email,r.role,r.grade || "",r.phone || "",r.passwordHash,Number(Boolean(r.active)),r.sessionVersion || 0,r.createdAt,r.updatedAt || null,r.avatarUrl || ""]);
    if (shouldSave("courses")) insertMany("INSERT INTO courses (id,owner_id,title,description,grade,cover,access_code,published,max_views,created_at,updated_at,category,price_piasters,is_free,grade_level,requires_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", store.courses, (r) => { const gradeLevel = SECONDARY_GRADES.indexOf(r.grade) + 1; return [r.id,r.ownerId,r.title,r.description,gradeLevel ? "secondary" : (r.grade === "prep" ? "prep" : "secondary"),r.cover || "",r.accessCode,Number(Boolean(r.published)),r.maxViews || 3,r.createdAt,r.updatedAt || r.createdAt,r.category || "",r.pricePiasters || 0,Number(Boolean(r.isFree)),gradeLevel,Number(r.requiresApproval !== false)]; });
    if (shouldSave("lessons")) {
      insertMany("INSERT INTO lessons VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", store.lessons, (r) => [r.id,r.courseId,r.title,r.videoUrl || "",r.pdfUrl || "",Number(Boolean(r.isFree)),r.position || 1,r.maxViews || 3,r.createdAt,r.updatedAt || r.createdAt]);
      for (const lesson of store.lessons || []) (lesson.questions || []).forEach((q, i) => { const qid = `${lesson.id}:q:${i + 1}`; database.prepare("INSERT INTO lesson_questions VALUES (?, ?, ?, ?, ?)").run(qid,lesson.id,String(q.question || q.prompt || ""),String(q.answer ?? ""),i + 1); (q.options || []).forEach((option, j) => database.prepare("INSERT INTO lesson_question_options VALUES (?, ?, ?, ?)").run(`${qid}:o:${j + 1}`,qid,String(option),j + 1)); });
    }
    if (shouldSave("exams")) {
      insertMany("INSERT INTO exams VALUES (?, ?, ?, ?, ?, ?)", store.exams, (r) => [r.id,r.courseId,r.title,r.description || "",r.createdAt,r.updatedAt || r.createdAt]);
      for (const exam of store.exams || []) (exam.questions || []).forEach((q, i) => { const qid = `${exam.id}:q:${i + 1}`; database.prepare("INSERT INTO exam_questions VALUES (?, ?, ?, ?, ?, ?)").run(qid,exam.id,q.prompt || "",q.imageUrl || "",Number(q.answerIndex || 0),i + 1); (q.options || []).forEach((option, j) => database.prepare("INSERT INTO exam_question_options VALUES (?, ?, ?, ?)").run(`${qid}:o:${j + 1}`,qid,String(option),j)); });
    }
    if (shouldSave("enrollments")) insertMany("INSERT INTO enrollments VALUES (?, ?, ?, ?, ?, ?)", store.enrollments, (r) => [r.id,r.courseId,r.userId,r.requestId || null,r.source || "course_code",r.createdAt]);
    if (shouldSave("course_requests")) insertMany("INSERT INTO course_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", store.courseRequests, (r) => [r.id,r.courseId,r.studentId,r.teacherId,r.phone || "",r.requestCode,r.status || "pending",r.createdAt,r.handledAt || null,r.handledBy || null]);
    if (shouldSave("password_reset_requests")) insertMany("INSERT INTO password_reset_requests VALUES (?, ?, ?, ?, ?, ?)", store.passwordResetRequests, (r) => [r.id,r.userId,r.email,r.status || "pending",r.createdAt,r.handledAt || null]);
    if (shouldSave("notifications")) insertMany("INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?)", store.notifications, (r) => [r.id,r.userId,r.title,r.message,r.link || "",Number(Boolean(r.read)),r.createdAt]);
    if (shouldSave("progress")) insertMany("INSERT INTO progress VALUES (?, ?, ?, ?, ?, ?)", store.progress, (r) => [r.id,r.userId,r.lessonId,r.position || 0,Number(Boolean(r.completed)),r.updatedAt]);
    if (shouldSave("watch_events")) insertMany("INSERT INTO watch_events VALUES (?, ?, ?, ?)", store.watchEvents, (r) => [r.id,r.userId,r.lessonId,r.createdAt]);
    if (shouldSave("quiz_attempts")) insertMany("INSERT INTO quiz_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", store.quizAttempts, (r) => [r.id,r.userId,r.lessonId || null,r.examId || null,r.courseId || null,r.score,r.total,null,r.createdAt]);
    if (shouldSave("chat_messages")) insertMany("INSERT INTO chat_messages (id,author_id,author_name,author_role,text,attachment_json,is_question,reply_to_id,reply_to_json,created_at,group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", store.chatMessages, (r) => [r.id,r.author.id,r.author.name,r.author.role,r.text || "",r.attachment ? JSON.stringify(r.attachment) : null,Number(Boolean(r.isQuestion)),r.replyTo?.id || null,r.replyTo ? JSON.stringify(r.replyTo) : null,r.createdAt,r.groupId || "global"]);
    if (shouldSave("chat_deleted_messages")) insertMany("INSERT INTO chat_deleted_messages VALUES (?, ?)", store.chatDeletedMessageIds, (r) => [r,now()]);
    if (shouldSave("direct_messages")) insertMany("INSERT INTO direct_messages (id,sender_id,recipient_id,text,created_at,read_at,attachment_json) VALUES (?, ?, ?, ?, ?, ?, ?)", store.directMessages, (r) => [r.id,r.senderId,r.recipientId,r.text || "",r.createdAt,r.readAt || null,r.attachment ? JSON.stringify(r.attachment) : null]);
    if (shouldSave("chat_groups")) insertMany("INSERT INTO chat_groups VALUES (?, ?, ?)", store.chatGroups, (r) => [r.id,r.grade,r.createdAt]);
    if (shouldSave("payment_orders")) insertMany("INSERT INTO payment_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", store.paymentOrders, (r) => [r.id,r.userId,r.courseId,r.merchantRefNum,r.fawryRefNumber || "",r.amountPiasters,r.status,r.paymentMethod || "PayAtFawry",r.createdAt,r.updatedAt]);
    if (shouldSave("contact_messages")) insertMany("INSERT INTO contact_messages VALUES (?, ?, ?, ?, ?, ?)", store.contactMessages, (r) => [r.id,r.name,r.email,r.subject || "استفسار",r.message,r.createdAt]);
    if (shouldSave("audit_log")) insertMany("INSERT INTO audit_log VALUES (?, ?, ?, ?, ?, ?)", store.audit, (r) => [r.id,r.actorId || null,r.action,r.target || null,JSON.stringify(r.meta || {}),r.createdAt]);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function loadStore() {
  const userCount = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount) return fromDatabase();
  if (fs.existsSync(STORE_PATH)) {
    const loaded = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    ["users", "courses", "lessons", "enrollments", "courseRequests", "paymentOrders", "chatGroups", "passwordResetRequests", "notifications", "chatMessages", "directMessages", "progress", "watchEvents", "quizAttempts", "exams", "contactMessages", "audit"].forEach((key) => { if (!Array.isArray(loaded[key])) loaded[key] = []; });
    if (!Array.isArray(loaded.chatDeletedMessageIds)) loaded.chatDeletedMessageIds = [];
    loaded.users.forEach((user) => { if (!Number.isInteger(user.sessionVersion)) user.sessionVersion = 1; if (!user.avatarUrl) user.avatarUrl = ""; });
    loaded.courses.forEach((course) => { if (!Number.isInteger(course.pricePiasters)) course.pricePiasters = 0; if (typeof course.isFree !== "boolean") course.isFree = true; if (typeof course.published !== "boolean") course.published = true; if (!course.category) course.category = ""; });
    loaded.chatMessages.forEach((message) => { if (!message.groupId || message.groupId === "global") message.groupId = "grade:prep"; });
    saveStore(loaded);
    console.log(`Imported ${loaded.users.length} users and existing platform data into SQLite.`);
    return loaded;
  }
  const fresh = initialStore();
  saveStore(fresh);
  return fresh;
}
function publicUser(user) { const { passwordHash, ...safe } = user; return safe; }
function audit(store, actor, action, target, meta = {}) { store.audit.unshift({ id: id(), actorId: actor?.id || null, action, target, meta, createdAt: now() }); store.audit = store.audit.slice(0, 500); }
function notify(userId, title, message, link = "") { if (!userId) return; store.notifications.unshift({ id: id(), userId, title, message, link, read: false, createdAt: now() }); store.notifications = store.notifications.slice(0, 1000); }
function notifyAdmins(title, message, link = "") { store.users.filter((user) => user.role === "admin" && user.active).forEach((user) => notify(user.id, title, message, link)); }
function normalizeCourseCover(value) {
  const cover = String(value ?? "").trim();
  const dataImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(cover);
  if (cover.startsWith("data:") && (!dataImage || cover.length > 2_800_000)) return null;
  if (cover.startsWith("/uploads/")) {
    if (!/^\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(cover) || !fs.existsSync(path.join(UPLOAD_DIR, path.basename(cover)))) return null;
    return cover;
  }
  if (!cover.startsWith("data:") && (cover.length > 64 || /[<>"'`\r\n]/.test(cover))) return null;
  return cover;
}
const SECONDARY_GRADES = ["first-secondary", "second-secondary", "third-secondary"];
function gradeStage(value) {
  const grade = String(value || "").trim().toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
  if (!grade) return "";
  if (/prep|اعدادي/.test(grade)) return "prep";
  if (/first-secondary|first secondary|اول|اولى/.test(grade)) return "first-secondary";
  if (/second-secondary|second secondary|ثاني|تاني/.test(grade)) return "second-secondary";
  if (/third-secondary|third secondary|ثالث/.test(grade)) return "third-secondary";
  if (/^secondary$|ثانوي/.test(grade)) return "secondary";
  return "";
}
function gradeLabel(grade) {
  return ({ "first-secondary": "الأول الثانوي", "second-secondary": "الثاني الثانوي", "third-secondary": "الثالث الثانوي", secondary: "الثانوي (صف غير محدد)", prep: "الإعدادي (بيانات قديمة)" })[grade] || "مرحلة غير محددة";
}
function matchesCourseGrade(studentGrade, courseGrade) {
  const normalizedStudentGrade = gradeStage(studentGrade);
  return normalizedStudentGrade === courseGrade || (courseGrade === "secondary" && SECONDARY_GRADES.includes(normalizedStudentGrade));
}
function chatGroupId(grade) { return `grade:${grade}`; }
function courseFor(user, course) {
  const result = { ...course, accessCode: undefined, price: (course.pricePiasters || 0) / 100 };
  const enrolled = user && (user.role !== "student" || store.enrollments?.some((item) => item.courseId === course.id && item.userId === user.id));
  result.enrolled = Boolean(enrolled);
  if (user?.role === "student") {
    const request = store.courseRequests.find((item) => item.courseId === course.id && item.studentId === user.id);
    const payment = store.paymentOrders.filter((item) => item.courseId === course.id && item.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    result.requestStatus = request?.status || "";
    result.paymentStatus = payment?.status || "";
    result.paymentId = payment?.id || "";
    result.paymentReferenceNumber = payment?.fawryRefNumber || "";
  }
  return result;
}
function sha256(value) { return crypto.createHash("sha256").update(String(value), "utf8").digest("hex"); }
function fawryMoney(value) { const amount = Number(value); return Number.isFinite(amount) ? amount.toFixed(2) : ""; }
function parsePricePiasters(value) {
  const input = String(value ?? "0").trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}
function constantTimeHexEqual(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(String(actual || "")) || !/^[a-f0-9]{64}$/i.test(String(expected || ""))) return false;
  return crypto.timingSafeEqual(Buffer.from(String(actual).toLowerCase(), "hex"), Buffer.from(String(expected).toLowerCase(), "hex"));
}
function fawryResponseSignature(body) {
  const parts = [body.referenceNumber || "", body.merchantRefNumber || body.merchantRefNum || "", fawryMoney(body.paymentAmount), fawryMoney(body.orderAmount), body.orderStatus || "", body.paymentMethod || ""];
  if (body.fawryFees !== undefined && body.fawryFees !== null && body.fawryFees !== "") parts.push(fawryMoney(body.fawryFees));
  if (body.shippingFees !== undefined && body.shippingFees !== null && body.shippingFees !== "") parts.push(fawryMoney(body.shippingFees));
  if (body.authNumber) parts.push(body.authNumber);
  if (body.customerMail) parts.push(body.customerMail);
  if (body.customerMobile) parts.push(String(body.customerMobile));
  parts.push(FAWRY_SECURE_KEY);
  return sha256(parts.join(""));
}
function fawryWebhookSignature(body) {
  return sha256([body.fawryRefNumber || "", body.merchantRefNumber || "", fawryMoney(body.paymentAmount), fawryMoney(body.orderAmount), body.orderStatus || "", body.paymentMethod || "", body.paymentRefrenceNumber || body.paymentReferenceNumber || "", FAWRY_SECURE_KEY].join(""));
}
function grantPaidEnrollment(order) {
  const request = store.courseRequests.find((item) => item.courseId === order.courseId && item.studentId === order.userId && item.status === "approved");
  if (!request || store.enrollments.some((item) => item.courseId === order.courseId && item.userId === order.userId)) return false;
  store.enrollments.push({ id: id(), courseId: order.courseId, userId: order.userId, requestId: request.id, createdAt: now(), source: "fawry_payment" });
  const course = store.courses.find((item) => item.id === order.courseId);
  notify(order.userId, "تم تفعيل الكورس بعد الدفع", `تم قبول طلبك وتأكيد دفع كورس ${course?.title || ""}.`, `course-details.html?course=${encodeURIComponent(order.courseId)}`);
  return true;
}
let store = loadStore();
let builtInAdmin = store.users.find((user) => user.email === ADMIN_EMAIL && user.role === "admin");
if (!builtInAdmin && production && process.env.ADMIN_EMAIL) {
  const admins = store.users.filter((user) => user.role === "admin");
  if (admins.length === 1) { builtInAdmin = admins[0]; builtInAdmin.email = ADMIN_EMAIL; saveStore(store); }
}
if (production && builtInAdmin && ADMIN_PASSWORD && verifyPassword("ChangeMe123!", builtInAdmin.passwordHash)) {
  builtInAdmin.passwordHash = hashPassword(ADMIN_PASSWORD);
  builtInAdmin.sessionVersion = (builtInAdmin.sessionVersion || 0) + 1;
  saveStore(store);
  console.log("Replaced the legacy development admin password with ADMIN_PASSWORD.");
}
if (builtInAdmin && process.env.RESET_ADMIN_PASSWORD === "true") {
  builtInAdmin.passwordHash = hashPassword(ADMIN_RESET_PASSWORD);
  builtInAdmin.sessionVersion = (builtInAdmin.sessionVersion || 0) + 1;
  saveStore(store);
  console.log("Admin password reset completed.");
}

function send(res, status, body) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); }
function error(res, status, message) { send(res, status, { error: message }); }
function readJson(req, maxBytes = 1_500_000) { return new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on("data", (chunk) => { size += chunk.length; if (size > maxBytes) { reject(Object.assign(new Error("حجم الطلب أكبر من المسموح."), { status: 413 })); req.destroy(); return; } chunks.push(chunk); }); req.on("end", () => { try { const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(new Error("بيانات الطلب غير صحيحة.")); } }); req.on("error", reject); }); }
function userFromPayload(payload) { return payload ? store.users.find((user) => user.id === payload.sub && user.active && (user.sessionVersion || 0) === (payload.sv || 0)) || null : null; }
function cookieToken(req) { const entry = (req.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith("ameen_token=")); return entry ? decodeURIComponent(entry.slice("ameen_token=".length)) : ""; }
function getUser(req) { const header = req.headers.authorization || ""; const bearer = header.startsWith("Bearer ") ? userFromPayload(verifyToken(header.slice(7))) : null; return bearer || userFromPayload(verifyToken(cookieToken(req))); }
function requireUser(req, res, roles) { const user = getUser(req); if (!user) { error(res, 401, "سجّل الدخول أولاً."); return null; } if (roles && !roles.includes(user.role)) { error(res, 403, "ليس لديك صلاحية لهذا الإجراء."); return null; } return user; }
function createCourseCode() { return crypto.randomBytes(16).toString("hex").toUpperCase(); }
function lessonAccess(user, courseId, lesson = null) { return user.role !== "student" || lesson?.isFree || store.enrollments.some((item) => item.courseId === courseId && item.userId === user.id); }
function isOwner(user, course) { return user.role === "admin" || course.ownerId === user.id; }
function prepareExamQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length || questions.length > 100) return null;
  const prepared = [];
  for (const item of questions) {
    const prompt = String(item?.prompt || "").trim().slice(0, 1000);
    const options = Array.isArray(item?.options) ? item.options.map((value) => String(value || "").trim().slice(0, 300)).filter(Boolean).slice(0, 6) : [];
    const answerIndex = Number(item?.answerIndex), imageUrl = String(item?.imageUrl || "");
    if (options.length < 2 || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) return null;
    if (!/^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(imageUrl)) return null;
    prepared.push({ prompt, imageUrl, options, answerIndex });
  }
  return prepared;
}
function prepareLessonQuestions(questions) {
  if (!Array.isArray(questions) || questions.length > 30) return null;
  const prepared = [];
  for (const item of questions) {
    const question = String(item?.question || item?.prompt || "").trim().slice(0, 1000);
    const options = Array.isArray(item?.options) ? item.options.map((value) => String(value || "").trim().slice(0, 300)) : [];
    const answer = Number(item?.answer ?? item?.answerIndex);
    if (!question || options.length < 2 || options.length > 6 || options.some((option) => !option) || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    prepared.push({ question, options, answer });
  }
  return prepared;
}
function setSessionCookie(res, user) { const token = sign({ sub: user.id, sv: user.sessionVersion || 0, exp: Date.now() + 7 * 86400000 }); res.setHeader("Set-Cookie", `ameen_token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${production ? "; Secure" : ""}`); return token; }
function lessonMediaUrl(url, user, lesson, watchEvent) {
  const provider = externalVideoEmbed(url);
  if (provider) return provider;
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return url;
  const ticket = sign({ sub: user.id, lessonId: lesson.id, watchId: watchEvent.id, scope: "lesson-media", exp: Date.now() + 30 * 60_000 });
  return `${url}${url.includes("?") ? "&" : "?"}watch=${ticket}`;
}
function externalVideoEmbed(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    let match;
    if (["youtu.be", "www.youtube.com", "youtube.com", "m.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname)) {
      const videoId = url.hostname === "youtu.be" ? url.pathname.split("/").filter(Boolean)[0] : url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/)?.[1];
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) return null;
      return `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1`;
    }
    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)) {
      match = url.pathname.match(/(?:^|\/)(?:video\/)?(\d{6,12})(?:$|\/)/);
      if (!match) return null;
      return `https://player.vimeo.com/video/${match[1]}`;
    }
    if (/\.(?:mp4|webm)$/i.test(url.pathname)) return url.toString();
  } catch {}
  return null;
}
function validLessonVideo(value) { return /^\/uploads\/[0-9a-f-]{36}\.(?:mp4|webm)$/i.test(String(value || "")) || Boolean(externalVideoEmbed(value)); }

async function api(req, res, pathname) {
  const method = req.method;
  if (method === "POST" && pathname === "/api/payments/fawry/webhook") {
    if (!FAWRY_CONFIGURED) return error(res, 503, "بوابة الدفع غير مهيأة.");
    const callback = await readJson(req, 100_000);
    if (!constantTimeHexEqual(callback.messageSignature, fawryWebhookSignature(callback))) return error(res, 403, "توقيع إشعار الدفع غير صالح.");
    const order = store.paymentOrders.find((item) => item.merchantRefNum === String(callback.merchantRefNumber || ""));
    if (!order) return error(res, 404, "طلب الدفع غير موجود.");
    const course = store.courses.find((item) => item.id === order.courseId);
    const expected = order.amountPiasters / 100;
    if (!course || Math.round(Number(callback.orderAmount) * 100) !== order.amountPiasters || !Number.isFinite(Number(callback.paymentAmount)) || Number(callback.paymentAmount) < expected) return error(res, 400, "مبلغ إشعار الدفع لا يطابق الطلب.");
    const status = String(callback.orderStatus || "").toUpperCase();
    if (status === "PAID" && order.status !== "refunded") {
      order.status = "paid";
      order.fawryRefNumber = String(callback.fawryRefNumber || "");
      order.updatedAt = now();
      grantPaidEnrollment(order);
    } else if (["CANCELED", "CANCELLED", "EXPIRED", "FAILED", "REFUNDED", "PARTIAL_REFUNDED"].includes(status)) {
      order.status = status.includes("REFUND") ? "refunded" : status === "EXPIRED" ? "expired" : "failed";
      order.updatedAt = now();
      if (order.status === "refunded") store.enrollments = store.enrollments.filter((item) => !(item.courseId === order.courseId && item.userId === order.userId && item.source === "fawry_payment"));
    }
    audit(store, null, "payment.webhook", order.id, { status: order.status });
    saveStore(store);
    return send(res, 200, { received: true });
  }
  const paymentStatusMatch = pathname.match(/^\/api\/payments\/([^/]+)$/);
  if (method === "GET" && paymentStatusMatch) {
    const user = requireUser(req, res); if (!user) return;
    const order = store.paymentOrders.find((item) => item.id === paymentStatusMatch[1] && (item.userId === user.id || user.role === "admin"));
    if (!order) return error(res, 404, "طلب الدفع غير موجود.");
    return send(res, 200, { payment: { id: order.id, courseId: order.courseId, amount: order.amountPiasters / 100, status: order.status, referenceNumber: order.fawryRefNumber, merchantRefNum: order.merchantRefNum, createdAt: order.createdAt } });
  }
  const testPaymentMatch = pathname.match(/^\/api\/payments\/([^/]+)\/test-confirm$/);
  if (method === "POST" && testPaymentMatch) {
    if (production) return error(res, 404, "المسار غير موجود.");
    const user = requireUser(req, res, ["admin"]); if (!user) return;
    const order = store.paymentOrders.find((item) => item.id === testPaymentMatch[1]);
    if (!order) return error(res, 404, "طلب الدفع غير موجود.");
    order.status = "paid"; order.fawryRefNumber = `DEV-${order.merchantRefNum}`; order.updatedAt = now();
    grantPaidEnrollment(order); audit(store, user, "payment.test_confirmed", order.id); saveStore(store);
    return send(res, 200, { payment: { id: order.id, status: order.status } });
  }
  const createPaymentMatch = pathname.match(/^\/api\/courses\/([^/]+)\/payments$/);
  if (method === "POST" && createPaymentMatch) {
    const user = requireUser(req, res, ["student"]); if (!user) return;
    const course = store.courses.find((item) => item.id === createPaymentMatch[1] && item.published);
    if (!course || course.isFree || course.pricePiasters <= 0) return error(res, 400, "هذا الكورس لا يحتاج إلى دفع.");
    const request = store.courseRequests.find((item) => item.courseId === course.id && item.studentId === user.id && item.status === "approved");
    if (!request) return error(res, 409, "أرسل طلب الالتحاق وانتظر موافقة المدرس أو المدير قبل الدفع.");
    if (store.enrollments.some((item) => item.courseId === course.id && item.userId === user.id)) return error(res, 409, "أنت مشترك بالفعل.");
    const pendingOrder = store.paymentOrders.find((item) => item.courseId === course.id && item.userId === user.id && item.status === "pending");
    if (pendingOrder) return send(res, 200, { payment: { id: pendingOrder.id, status: pendingOrder.status, amount: pendingOrder.amountPiasters / 100, referenceNumber: pendingOrder.fawryRefNumber, merchantRefNum: pendingOrder.merchantRefNum } });
    if (!FAWRY_CONFIGURED) return error(res, 503, "الدفع غير متاح الآن. يجب إعداد بيانات التاجر ومفتاح فوري ورابط إشعار HTTPS.");
    const phone = String(user.phone || request.phone || "").replace(/[\s()+-]/g, "");
    if (!/^01\d{9}$/.test(phone) || !user.email.includes("@")) return error(res, 400, "أكمل رقم هاتف مصري وبريدًا إلكترونيًا صالحًا في ملفك قبل الدفع.");
    const merchantRefNum = `${Date.now()}${crypto.randomInt(1000, 9999)}`;
    const amount = (course.pricePiasters / 100).toFixed(2);
    const paymentMethod = "PayAtFawry";
    const customerProfileId = "";
    const payload = {
      merchantCode: FAWRY_MERCHANT_CODE,
      merchantRefNum,
      customerName: user.name,
      customerMobile: phone,
      customerEmail: user.email,
      amount,
      currencyCode: "EGP",
      paymentExpiry: Date.now() + 24 * 60 * 60 * 1000,
      language: "ar-eg",
      paymentMethod,
      description: `Course: ${course.title}`.slice(0, 200),
      chargeItems: [{ itemId: course.id, description: course.title.slice(0, 100), price: amount, quantity: "1" }],
      orderWebHookUrl: FAWRY_WEBHOOK_URL,
      signature: sha256(FAWRY_MERCHANT_CODE + merchantRefNum + customerProfileId + paymentMethod + amount + FAWRY_SECURE_KEY),
    };
    const order = { id: id(), userId: user.id, courseId: course.id, merchantRefNum, fawryRefNumber: "", amountPiasters: course.pricePiasters, status: "pending", paymentMethod, createdAt: now(), updatedAt: now() };
    store.paymentOrders.push(order); audit(store, user, "payment.created", order.id, { courseId: course.id }); saveStore(store);
    try {
      const response = await fetch(FAWRY_API_URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok || Number(result.statusCode) !== 200 || String(result.merchantRefNumber || result.merchantRefNum || "") !== merchantRefNum || Math.round(Number(result.orderAmount) * 100) !== order.amountPiasters || !constantTimeHexEqual(result.signature, fawryResponseSignature(result))) throw new Error("تعذر التحقق من استجابة فوري.");
      order.fawryRefNumber = String(result.referenceNumber || "");
      if (!order.fawryRefNumber) throw new Error("لم يصدر فوري رقم مرجعي.");
      if (String(result.orderStatus || "").toUpperCase() === "PAID" && Math.round(Number(result.orderAmount) * 100) === order.amountPiasters && Number(result.paymentAmount) >= order.amountPiasters / 100) {
        order.status = "paid"; grantPaidEnrollment(order);
      }
      order.updatedAt = now(); saveStore(store);
      return send(res, 201, { payment: { id: order.id, status: order.status, amount: order.amountPiasters / 100, referenceNumber: order.fawryRefNumber, merchantRefNum: order.merchantRefNum, expiresAt: payload.paymentExpiry } });
    } catch (cause) {
      order.status = "failed"; order.updatedAt = now(); saveStore(store);
      console.error("Fawry charge request failed:", cause.message);
      return error(res, 502, "تعذر إنشاء طلب الدفع الآن. حاول لاحقًا أو تواصل مع الإدارة.");
    }
  }
  if (method === "POST" && pathname === "/api/uploads") {
    const requestedKind = String(req.headers["x-upload-kind"] || "");
    const user = requireUser(req, res, requestedKind.startsWith("chat-") || requestedKind === "avatar" ? undefined : ["teacher", "admin"]); if (!user) return;
    const rule = UPLOAD_RULES[requestedKind];
    if (!rule) { req.resume(); return error(res, 400, "نوع المرفق غير مدعوم في نسخة الخادم الحالية. أوقف الخادم القديم وشغّل run-local-server.bat من جديد."); }
    if (uploadInFlight >= MAX_CONCURRENT_UPLOADS) { req.resume(); return error(res, 503, "يوجد رفع ملف آخر جارٍ. أعد المحاولة بعد قليل."); }
    uploadInFlight += 1;
    try {
      const { dataUrl, kind } = await readJson(req, Math.ceil(rule.maxBytes / 3) * 4 + 32_768);
      if (kind !== requestedKind) return error(res, 400, "بيانات نوع المرفق غير متطابقة. أعد اختيار الملف ثم أرسله مرة أخرى.");
      const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/);
      const contentType = match?.[1]?.toLowerCase();
      if (!match || !rule.types.includes(contentType)) return error(res, 400, "صيغة الملف غير مسموحة.");
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.toString("base64") !== match[2]) return error(res, 400, "ترميز الملف غير صالح.");
      if (bytes.length > rule.maxBytes) return error(res, 413, "حجم الملف أكبر من المسموح.");
      if (!uploadContentMatches(bytes, contentType)) return error(res, 400, "محتوى الملف لا يطابق نوعه المعلن.");

      const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "audio/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/mpeg": ".mp3" };
      const ext = requestedKind === "chat-video" ? (contentType === "video/webm" ? ".video.webm" : ".mp4")
        : requestedKind === "video" ? (contentType === "video/webm" ? ".webm" : ".mp4")
        : requestedKind === "pdf" ? ".pdf" : extensions[contentType];
      const storedName = `${id()}${ext}`;
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const tempPath = path.join(UPLOAD_DIR, `scan-${id()}.tmp`);
      const finalPath = path.join(UPLOAD_DIR, storedName);
      fs.writeFileSync(tempPath, bytes, { flag: "wx", mode: 0o600 });
      try {
        if (AV_SCAN_REQUIRED) {
          const scan = await scanWithClamAV(tempPath);
          if (scan.status !== "clean") {
            fs.unlinkSync(tempPath);
            if (scan.status === "infected") return error(res, 400, "تم رفض الملف بعد اكتشاف محتوى ضار.");
            console.error(`ClamAV upload scan failed (${scan.status}).`);
            return error(res, 503, "تعذر فحص الملف أمنيًا الآن؛ لم يتم حفظه. حاول لاحقًا أو تواصل مع الإدارة.");
          }
        }
        fs.copyFileSync(tempPath, finalPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(finalPath, 0o600);
        fs.unlinkSync(tempPath);
      } catch (cause) {
        try { fs.unlinkSync(tempPath); } catch {}
        try { fs.unlinkSync(finalPath); } catch {}
        throw cause;
      }
      audit(store, user, "file.uploaded", storedName, { kind: requestedKind, bytes: bytes.length }); saveStore(store);
      return send(res, 201, { url: `/uploads/${storedName}` });
    } finally {
      uploadInFlight -= 1;
    }
  }
  if (method === "POST" && pathname === "/api/contact") {
    const { name, email, subject, message } = await readJson(req);
    if (!name?.trim() || !email?.includes("@") || !message?.trim()) return error(res, 400, "أكمل بيانات الرسالة.");
    const entry = { id: id(), name: name.trim(), email: email.trim(), subject: String(subject || "استفسار"), message: message.trim(), createdAt: now() };
    store.contactMessages = store.contactMessages || []; store.contactMessages.unshift(entry); store.contactMessages = store.contactMessages.slice(0, 500); notifyAdmins("رسالة جديدة", `رسالة جديدة من ${entry.name}.`, "admin.html"); saveStore(store);
    if (mailer) await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: ADMIN_EMAIL, replyTo: entry.email, subject: `[منصة أمين] ${entry.subject}`, text: `${entry.name}\n${entry.email}\n\n${entry.message}` });
    return send(res, 201, { sent: Boolean(mailer), message: mailer ? "تم إرسال الرسالة." : "تم حفظ الرسالة. أضف إعدادات SMTP لتفعيل الإرسال بالبريد." });
  }
  if (method === "POST" && pathname === "/api/auth/register") {
    const { name, email, password, grade, phone } = await readJson(req);
    const safeName = String(name || "").trim();
    const safeEmail = String(email || "").trim();
    const safePassword = String(password || "");
    if (!safeName || !safeEmail.includes("@") || safePassword.length < 8 || safePassword.length > 256) return error(res, 400, "أدخل اسمًا وبريدًا صحيحًا وكلمة مرور من 8 إلى 256 حرفًا.");
    const studentGrade = gradeStage(grade);
    if (!SECONDARY_GRADES.includes(studentGrade)) return error(res, 400, "اختر صفًا من الصفوف الثانوية الثلاثة.");
    const normalizedEmail = safeEmail.toLowerCase();
    if (store.users.some((user) => user.email === normalizedEmail)) return error(res, 409, "البريد مسجل بالفعل.");
    const user = { id: id(), name: safeName, email: normalizedEmail, role: "student", grade: studentGrade, phone: String(phone || "").trim(), passwordHash: hashPassword(safePassword), sessionVersion: 0, createdAt: now(), active: true };
    store.users.push(user); audit(store, user, "user.registered", user.id); notifyAdmins("حساب طالب جديد", `تم إنشاء حساب جديد باسم ${user.name}.`, "admin.html"); saveStore(store);
    setSessionCookie(res, user);
    return send(res, 201, { user: publicUser(user) });
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const { email, password } = await readJson(req); const user = store.users.find((item) => item.email === String(email || "").trim().toLowerCase());
    const candidatePassword = String(password || "");
    if (candidatePassword.length > 256 || !user || !user.active || !verifyPassword(candidatePassword, user.passwordHash)) return error(res, 401, "بيانات الدخول غير صحيحة.");
    audit(store, user, "user.logged_in", user.id); saveStore(store);
    setSessionCookie(res, user);
    return send(res, 200, { user: publicUser(user) });
  }
  if (method === "POST" && pathname === "/api/auth/password-reset-request") {
    const { email } = await readJson(req); const user = store.users.find((item) => item.email === String(email || "").trim().toLowerCase());
    if (user) { const request = { id: id(), userId: user.id, email: user.email, status: "pending", createdAt: now() }; store.passwordResetRequests.unshift(request); audit(store, user, "password.reset_requested", request.id); notifyAdmins("طلب استعادة كلمة المرور", `${user.name} طلب إعادة تعيين كلمة المرور.`, "admin.html"); saveStore(store); if (mailer) await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: ADMIN_EMAIL, subject: "طلب استعادة كلمة المرور", text: `${user.name} (${user.email}) طلب استعادة كلمة المرور.` }); }
    return send(res, 200, { message: "إذا كان البريد مسجلاً، تم إرسال طلب الاستعادة إلى إدارة المنصة." });
  }
  if (method === "GET" && pathname === "/api/me") { const user = requireUser(req, res); if (user) send(res, 200, { user: publicUser(user) }); return; }
  if (method === "GET" && pathname === "/api/direct-messages/users") {
    const user = requireUser(req, res); if (!user) return;
    const conversations = new Map();
    (store.directMessages || []).filter((message) => message.senderId === user.id || message.recipientId === user.id).forEach((message) => {
      const otherId = message.senderId === user.id ? message.recipientId : message.senderId;
      const item = conversations.get(otherId) || { lastMessage: null, unread: 0 };
      if (!item.lastMessage || new Date(message.createdAt) > new Date(item.lastMessage.createdAt)) item.lastMessage = message;
      if (message.recipientId === user.id && !message.readAt) item.unread += 1;
      conversations.set(otherId, item);
    });
    const users = store.users.filter((other) => other.active && other.id !== user.id).map((other) => {
      const conversation = conversations.get(other.id);
      return { id: other.id, name: other.name, role: other.role, grade: other.grade || "", avatarUrl: other.avatarUrl || "", lastMessage: conversation?.lastMessage ? { text: conversation.lastMessage.text || (conversation.lastMessage.attachment ? "مرفق" : ""), createdAt: conversation.lastMessage.createdAt } : null, unread: conversation?.unread || 0 };
    }).sort((a, b) => Number(Boolean(b.lastMessage)) - Number(Boolean(a.lastMessage)) || new Date(b.lastMessage?.createdAt || 0) - new Date(a.lastMessage?.createdAt || 0) || a.name.localeCompare(b.name, "ar"));
    return send(res, 200, { users });
  }
  const directMessageMatch = pathname.match(/^\/api\/direct-messages\/([^/]+)$/);
  if (directMessageMatch && method === "GET") {
    const user = requireUser(req, res); if (!user) return;
    const other = store.users.find((item) => item.id === directMessageMatch[1] && item.active && item.id !== user.id);
    if (!other) return error(res, 404, "الحساب غير موجود.");
    const messages = (store.directMessages || []).filter((message) => (message.senderId === user.id && message.recipientId === other.id) || (message.senderId === other.id && message.recipientId === user.id));
    const latest = messages.slice(-100);
    let markedRead = false;
    latest.forEach((message) => { if (message.recipientId === user.id && !message.readAt) { message.readAt = now(); markedRead = true; } });
    if (markedRead) saveStore(store);
    return send(res, 200, { user: { id: other.id, name: other.name, role: other.role }, messages: latest });
  }
  if (directMessageMatch && method === "POST") {
    const user = requireUser(req, res); if (!user) return;
    const other = store.users.find((item) => item.id === directMessageMatch[1] && item.active && item.id !== user.id);
    if (!other) return error(res, 404, "الحساب غير موجود.");
    const { text, attachment } = await readJson(req);
    const content = String(text || "").trim();
    if (!content && !attachment) return error(res, 400, "اكتب رسالة أو أرفق ملفًا.");
    if (content.length > 2000) return error(res, 400, "الحد الأقصى للرسالة 2000 حرف.");
    let safeAttachment = null;
    if (attachment) {
      const allowedTypes = { image: /\.(?:jpg|png|webp)$/i, video: /\.(?:mp4|video\.webm)$/i, audio: /\.(?:m4a|ogg|wav|mp3|webm)$/i };
      const match = String(attachment.url || "").match(/^\/uploads\/([0-9a-f-]{36}\.(?:jpg|png|webp|mp4|video\.webm|m4a|ogg|wav|mp3|webm))$/i);
      const url = String(attachment.url || "");
      if (!allowedTypes[attachment.type]?.test(url) || !match || !fs.existsSync(path.join(UPLOAD_DIR, path.basename(url)))) return error(res, 400, "المرفق الخاص غير صالح.");
      safeAttachment = { type: attachment.type, url };
    }
    const message = { id: id(), senderId: user.id, recipientId: other.id, text: content, attachment: safeAttachment, createdAt: now(), readAt: null };
    store.directMessages = store.directMessages || [];
    store.directMessages.push(message);
    if (store.directMessages.length > 10000) store.directMessages.splice(0, store.directMessages.length - 10000);
    notify(other.id, "رسالة خاصة جديدة", "رسالة من " + user.name + ": " + (content || "مرفق").slice(0, 140), "messages.html?user=" + encodeURIComponent(user.id));
    saveStore(store);
    return send(res, 201, { message });
  }
  if (pathname === "/api/chat/groups" && method === "GET") {
    const user = requireUser(req, res); if (!user) return;
    const requestedGrade = new URL(req.url, `http://${req.headers.host}`).searchParams.get("grade");
    const grades = ["teacher", "admin"].includes(user.role) ? (requestedGrade ? [requestedGrade] : SECONDARY_GRADES) : [gradeStage(user.grade)];
    if (grades.some((grade) => !SECONDARY_GRADES.includes(grade))) return error(res, 400, "حدد صفك الثانوي في الملف الشخصي أولاً.");
    store.chatGroups = store.chatGroups || [];
    let changed = false;
    for (const grade of grades) if (!store.chatGroups.some((group) => group.grade === grade)) { store.chatGroups.push({ id: chatGroupId(grade), grade, createdAt: now() }); changed = true; }
    if (changed) saveStore(store, ["chat_groups"]);
    return send(res, 200, { groups: grades.map((grade) => ({ id: chatGroupId(grade), grade, title: `مجموعة ${gradeLabel(grade)}` })) });
  }
  if (pathname === "/api/chat/messages" && method === "DELETE") {
    const user = requireUser(req, res, ["admin"]); if (!user) return;
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const grade = search.get("grade");
    const targets = grade ? store.chatMessages.filter((message) => message.groupId === chatGroupId(grade)) : [...store.chatMessages];
    if (grade && !SECONDARY_GRADES.includes(grade)) return error(res, 400, "المرحلة غير صالحة.");
    const targetIds = new Set(targets.map((message) => message.id));
    const removedFiles = new Set(targets.map((message) => message.attachment?.url).filter(Boolean));
    store.chatMessages = store.chatMessages.filter((message) => !targetIds.has(message.id));
    store.chatDeletedMessageIds = [...(store.chatDeletedMessageIds || []), ...targetIds].slice(-5000);
    for (const url of removedFiles) if (!store.chatMessages.some((message) => message.attachment?.url === url) && !(store.directMessages || []).some((message) => message.attachment?.url === url)) {
      const filename = path.basename(url), filepath = path.join(UPLOAD_DIR, filename);
      if (/^[0-9a-f-]{36}\./i.test(filename) && filepath.startsWith(UPLOAD_DIR) && fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }
    audit(store, user, "admin.cleared_chat", grade || "all", { deleted: targetIds.size });
    saveStore(store);
    return send(res, 200, { deleted: targetIds.size });
  }
  if (pathname === "/api/chat/messages" && method === "GET") {
    const user = requireUser(req, res); if (!user) return;
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const requestedGrade = search.get("grade");
    const grade = ["teacher", "admin"].includes(user.role) ? (requestedGrade || SECONDARY_GRADES[0]) : gradeStage(user.grade);
    if (!SECONDARY_GRADES.includes(grade) || (!["teacher", "admin"].includes(user.role) && requestedGrade && requestedGrade !== grade)) return error(res, 403, "لا يمكنك فتح مجموعة هذه المرحلة.");
    const groupMessages = store.chatMessages.filter((item) => item.groupId === chatGroupId(grade));
    const beforeId = search.get("before");
    const beforeIndex = beforeId ? groupMessages.findIndex((item) => item.id === beforeId) : -1;
    if (beforeId && beforeIndex < 0) return error(res, 404, "تعذر العثور على الرسالة المطلوبة.");
    const end = beforeId ? beforeIndex : groupMessages.length;
    const start = Math.max(0, end - 100);
    return send(res, 200, { groupId: chatGroupId(grade), messages: groupMessages.slice(start, end), deletedMessageIds: store.chatDeletedMessageIds || [], hasMore: start > 0 });
  }
  const chatMessageMatch = pathname.match(/^\/api\/chat\/messages\/([^/]+)$/);
  if (chatMessageMatch && method === "DELETE") {
    const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return;
    const index = store.chatMessages.findIndex((item) => item.id === chatMessageMatch[1]);
    if (index < 0) return error(res, 404, "الرسالة غير موجودة أو تم حذفها بالفعل.");
    const [deletedMessage] = store.chatMessages.splice(index, 1);
    store.chatDeletedMessageIds = store.chatDeletedMessageIds || [];
    store.chatDeletedMessageIds.push(deletedMessage.id);
    if (store.chatDeletedMessageIds.length > 5000) store.chatDeletedMessageIds.splice(0, store.chatDeletedMessageIds.length - 5000);
    if (deletedMessage.attachment?.url && !store.chatMessages.some((item) => item.attachment?.url === deletedMessage.attachment.url)) {
      const fileName = path.basename(deletedMessage.attachment.url);
      const filePath = path.join(UPLOAD_DIR, fileName);
      if (filePath.startsWith(UPLOAD_DIR) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    saveStore(store);
    return send(res, 200, { ok: true });
  }
  if (pathname === "/api/chat/messages" && method === "POST") {
    const user = requireUser(req, res); if (!user) return;
    const { text, replyToId, attachment, isQuestion, grade: requestedGrade } = await readJson(req);
    const grade = ["teacher", "admin"].includes(user.role) ? (requestedGrade || SECONDARY_GRADES[0]) : gradeStage(user.grade);
    if (!SECONDARY_GRADES.includes(grade) || (!["teacher", "admin"].includes(user.role) && requestedGrade && requestedGrade !== grade)) return error(res, 403, "لا يمكنك الإرسال إلى مجموعة هذه المرحلة.");
    store.chatGroups = store.chatGroups || [];
    if (!store.chatGroups.some((group) => group.grade === grade)) { store.chatGroups.push({ id: chatGroupId(grade), grade, createdAt: now() }); saveStore(store, ["chat_groups"]); }
    const content = String(text || "").trim();
    if (!content && !attachment) return error(res, 400, "اكتب رسالة أو أرفق صورة أو فيديو أو تسجيلاً صوتيًا.");
    if (content.length > 1000) return error(res, 400, "الحد الأقصى للرسالة 1000 حرف.");
    let safeAttachment = null;
    if (attachment) {
      const kind = attachment.type === "image" ? "chat-image" : attachment.type === "audio" ? "chat-audio" : attachment.type === "video" ? "chat-video" : "";
      const match = String(attachment.url || "").match(/^\/uploads\/([0-9a-f-]{36})\.(jpg|png|webp|webm|video\.webm|mp4|m4a|ogg|wav|mp3)$/i);
      if (!kind || !match || !fs.existsSync(path.join(UPLOAD_DIR, path.basename(attachment.url)))) return error(res, 400, "المرفق غير صالح.");
      const audioExts = ["webm", "m4a", "ogg", "wav", "mp3"];
      const videoExts = ["mp4", "video.webm"];
      if ((attachment.type === "audio") !== audioExts.includes(match[2].toLowerCase())) return error(res, 400, "نوع المرفق لا يطابق الملف.");
      if ((attachment.type === "video") !== videoExts.includes(match[2].toLowerCase())) return error(res, 400, "نوع المرفق لا يطابق الملف.");
      safeAttachment = { type: attachment.type, url: attachment.url };
    }
    let replyTo = null;
    if (replyToId) {
      const parent = store.chatMessages.find((item) => item.id === replyToId);
      if (!parent) return error(res, 404, "الرسالة التي تريد الرد عليها غير موجودة.");
      replyTo = { id: parent.id, authorName: parent.author.name, text: String(parent.text || "رسالة مرفقة").slice(0, 240) };
    }
    const message = { id: id(), author: { id: user.id, name: user.name, role: user.role }, text: content, attachment: safeAttachment, isQuestion: Boolean(isQuestion), replyTo, groupId: chatGroupId(grade), createdAt: now() };
    store.chatMessages.push(message);
    if (store.chatMessages.length > 3000) store.chatMessages.splice(0, store.chatMessages.length - 3000);
    if (message.isQuestion) {
      const questionText = content || (safeAttachment?.type === "image" ? "أرسل صورة" : safeAttachment?.type === "audio" ? "أرسل تسجيلاً صوتيًا" : safeAttachment?.type === "video" ? "أرسل فيديو" : "سؤال جديد");
      const teacherIds = new Set(store.courses.filter((course) => course.grade === grade).map((course) => course.ownerId));
      store.users.filter((item) => item.role === "teacher" && item.active && (!teacherIds.size || teacherIds.has(item.id))).forEach((teacher) => notify(teacher.id, "سؤال جديد في الشات العام", `${user.name}: ${questionText.slice(0, 180)}`, `chat.html?grade=${grade}&message=${encodeURIComponent(message.id)}`));
    }
    if (replyTo) {
      const original = store.chatMessages.find((item) => item.id === replyTo.id);
      if (original && original.author.id !== user.id) notify(original.author.id, "رد جديد على رسالتك", `${user.name}: ${(content || "رد على مرفق").slice(0, 140)}`, `chat.html?grade=${grade}&message=${encodeURIComponent(message.id)}`);
    }
    saveStore(store);
    return send(res, 201, { message });
  }
  if (method === "GET" && pathname === "/api/notifications") { const user = requireUser(req, res); if (!user) return; const notifications = store.notifications.filter((item) => item.userId === user.id).slice(0, 40); return send(res, 200, { notifications, unread: notifications.filter((item) => !item.read).length }); }
  if (method === "DELETE" && pathname === "/api/notifications") { const user = requireUser(req, res); if (!user) return; const previousCount = store.notifications.length; store.notifications = store.notifications.filter((item) => item.userId !== user.id); const deleted = previousCount - store.notifications.length; saveStore(store, ["notifications"]); return send(res, 200, { ok: true, deleted }); }
  if (method === "POST" && pathname === "/api/notifications/read-all") { const user = requireUser(req, res); if (!user) return; store.notifications.forEach((item) => { if (item.userId === user.id) item.read = true; }); saveStore(store); return send(res, 200, { ok: true }); }
  const notificationMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if (method === "POST" && notificationMatch) { const user = requireUser(req, res); if (!user) return; const notification = store.notifications.find((item) => item.id === notificationMatch[1] && item.userId === user.id); if (!notification) return error(res, 404, "الإشعار غير موجود."); notification.read = true; saveStore(store); return send(res, 200, { ok: true }); }
  if (method === "POST" && pathname === "/api/auth/logout") { const user = getUser(req); if (user) { user.sessionVersion = (user.sessionVersion || 0) + 1; saveStore(store); } res.setHeader("Set-Cookie", `ameen_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${production ? "; Secure" : ""}`); return send(res, 200, { ok: true }); }
  if (method === "PATCH" && pathname === "/api/me") { const user = requireUser(req, res); if (!user) return; const { name, grade, phone, avatarUrl } = await readJson(req); if (name?.trim()) user.name = name.trim(); if (grade !== undefined) { const normalizedGrade = gradeStage(grade); if (!SECONDARY_GRADES.includes(normalizedGrade)) return error(res, 400, "اختر صفًا من الصفوف الثانوية الثلاثة."); user.grade = normalizedGrade; } if (phone !== undefined) user.phone = String(phone).trim(); if (avatarUrl !== undefined) { const avatarMatch = String(avatarUrl || "").match(/^\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i); if (avatarUrl && (!avatarMatch || !fs.existsSync(path.join(UPLOAD_DIR, path.basename(avatarUrl))))) return error(res, 400, "صورة الحساب غير صالحة."); user.avatarUrl = avatarUrl || ""; } audit(store, user, "user.updated_profile", user.id); saveStore(store); return send(res, 200, { user: publicUser(user) }); }
  if (method === "PATCH" && pathname === "/api/me/password") { const user = requireUser(req, res); if (!user) return; const { currentPassword, newPassword } = await readJson(req); const nextPassword = String(newPassword || ""); if (nextPassword.length < 8 || nextPassword.length > 256) return error(res, 400, "كلمة المرور الجديدة يجب أن تكون من 8 إلى 256 حرفًا."); if (!verifyPassword(String(currentPassword || ""), user.passwordHash)) return error(res, 401, "كلمة المرور الحالية غير صحيحة."); user.passwordHash = hashPassword(nextPassword); user.sessionVersion = (user.sessionVersion || 0) + 1; audit(store, user, "user.changed_password", user.id); saveStore(store); return send(res, 200, { ok: true }); }

  if (method === "GET" && pathname === "/api/exams") {
    const user = requireUser(req, res); if (!user) return;
    const courseId = new URL(req.url, "http://" + req.headers.host).searchParams.get("course") || "";
    const exams = store.exams.filter((exam) => (!courseId || exam.courseId === courseId) && (user.role === "admin" || store.courses.some((item) => item.id === exam.courseId && item.ownerId === user.id) || store.enrollments.some((item) => item.courseId === exam.courseId && item.userId === user.id))).map((exam) => { const course = store.courses.find((item) => item.id === exam.courseId); const canManage = user.role === "admin" || course?.ownerId === user.id; return { ...exam, courseTitle: course?.title || "", questions: exam.questions.map((question) => { const { answerIndex, ...safe } = question; return canManage ? { ...safe, answerIndex } : safe; }) }; });
    return send(res, 200, { exams });
  }
  const courseExams = pathname.match(/^\/api\/courses\/([^/]+)\/exams$/);
  if (courseExams && method === "POST") {
    const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return;
    const course = store.courses.find((item) => item.id === courseExams[1]); if (!course || !isOwner(user, course)) return error(res, 403, "لا تملك هذا الكورس.");
    const { title, description = "", questions = [] } = await readJson(req); const prepared = prepareExamQuestions(questions);
    if (!title?.trim() || !prepared) return error(res, 400, "أدخل عنوان الامتحان وسؤالاً واحداً على الأقل مع 2 إلى 6 اختيارات وإجابة صحيحة.");
    const exam = { id: id(), courseId: course.id, title: title.trim().slice(0,160), description: String(description).trim().slice(0,500), questions: prepared, createdAt: now(), updatedAt: now() }; store.exams.push(exam); audit(store,user,"exam.created",exam.id); store.enrollments.filter((item)=>item.courseId===course.id).forEach((item)=>notify(item.userId,"امتحان جديد", "أضيف امتحان جديد إلى كورس " + course.title + ": " + exam.title + ".", "exams.html?course=" + course.id)); saveStore(store); return send(res,201,{exam});
  }
  const examMatch = pathname.match(/^\/api\/exams\/([^/]+)$/);
  if (examMatch && (method === "PATCH" || method === "DELETE")) {
    const user=requireUser(req,res,["teacher","admin"]); if(!user)return; const exam=store.exams.find((item)=>item.id===examMatch[1]); const course=exam&&store.courses.find((item)=>item.id===exam.courseId); if(!exam||!course||!isOwner(user,course))return error(res,403,"لا تملك هذا الامتحان.");
    if(method==="DELETE"){store.exams=store.exams.filter((item)=>item.id!==exam.id);store.quizAttempts=store.quizAttempts.filter((item)=>item.examId!==exam.id);audit(store,user,"exam.deleted",exam.id);saveStore(store);return send(res,200,{ok:true});}
    const body=await readJson(req);const prepared=body.questions===undefined?exam.questions:prepareExamQuestions(body.questions);if(body.questions!==undefined&&!prepared)return error(res,400,"تحقق من الأسئلة والاختيارات والإجابات الصحيحة.");if(body.title!==undefined){if(!String(body.title).trim())return error(res,400,"عنوان الامتحان مطلوب.");exam.title=String(body.title).trim().slice(0,160);}if(body.description!==undefined)exam.description=String(body.description).trim().slice(0,500);exam.questions=prepared;exam.updatedAt=now();audit(store,user,"exam.updated",exam.id);saveStore(store);return send(res,200,{exam});
  }
  const examSubmit=pathname.match(/^\/api\/exams\/([^/]+)\/submit$/);
  if(examSubmit&&method==="POST"){const user=requireUser(req,res,["student"]);if(!user)return;const exam=store.exams.find((item)=>item.id===examSubmit[1]);if(!exam||!store.enrollments.some((item)=>item.courseId===exam.courseId&&item.userId===user.id))return error(res,403,"سجّل في الكورس أولاً لبدء الامتحان.");const {answers=[]}=await readJson(req);if(!Array.isArray(answers)||answers.length!==exam.questions.length||answers.some((answer,index)=>String(answer).trim()===""||!Number.isInteger(Number(answer))||Number(answer)<0||Number(answer)>=exam.questions[index].options.length))return error(res,400,"أجب عن جميع الأسئلة واختر إجابة صالحة لكل سؤال.");const score=exam.questions.reduce((total,q,i)=>total+(Number(answers[i])===q.answerIndex?1:0),0);const attempt={id:id(),examId:exam.id,courseId:exam.courseId,userId:user.id,score,total:exam.questions.length,createdAt:now()};store.quizAttempts.push(attempt);if(store.quizAttempts.length>10000)store.quizAttempts.splice(0,store.quizAttempts.length-10000);audit(store,user,"exam.submitted",exam.id,{score,total:exam.questions.length});saveStore(store);return send(res,200,{score,total:exam.questions.length});}
  if (method === "GET" && pathname === "/api/admin/stats") { const user = requireUser(req, res, ["admin"]); if (!user) return; return send(res, 200, { stats: { students: store.users.filter((item) => item.role === "student" && item.active).length, courses: store.courses.length, exams: store.exams.length, attempts: store.quizAttempts.length } }); }
if (method === "GET" && pathname === "/api/student-progress") {
    const user = requireUser(req, res, ["admin", "teacher"]); if (!user) return;
    const courseIds = new Set(store.courses.filter((course) => user.role === "admin" || course.ownerId === user.id).map((course) => course.id));
    const studentIds = new Set(store.enrollments.filter((entry) => courseIds.has(entry.courseId)).map((entry) => entry.userId));
    const students = store.users.filter((student) => student.role === "student" && (user.role === "admin" || studentIds.has(student.id))).map((student) => {
      const attempts = store.quizAttempts.filter((attempt) => attempt.userId === student.id && courseIds.has(attempt.courseId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const completed = store.progress.filter((entry) => entry.userId === student.id && courseIds.has(entry.courseId) && entry.completed).length;
      return { id: student.id, name: student.name, email: student.email, grade: student.grade || "", active: student.active, completedLessons: completed, lastAttempt: attempts[0] ? { score: attempts[0].score, total: attempts[0].total, createdAt: attempts[0].createdAt } : null };
    });
    const scores = store.quizAttempts.filter((attempt) => courseIds.has(attempt.courseId) && attempt.total > 0).map((attempt) => attempt.score / attempt.total);
    return send(res, 200, { students, averageScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 100) : null, completedLessons: store.progress.filter((entry) => courseIds.has(entry.courseId) && entry.completed).length });
  }
  if (method === "GET" && pathname === "/api/courses") {
    const user = getUser(req);
    let list = store.courses;
    if (!user || user.role === "student") {
      list = list.filter((course) => course.published && course.grade !== "prep" && (!user || matchesCourseGrade(user.grade, course.grade)));
    } else if (user.role === "teacher") {
      list = list.filter((course) => course.published || course.ownerId === user.id);
    }
    return send(res, 200, { courses: list.map((course) => courseFor(user, course)) });
  }
  if (method === "POST" && pathname === "/api/courses") { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const body = await readJson(req); const { title, description, grade, cover, maxViews } = body; const safeTitle = typeof title === "string" ? title.trim() : "", safeDescription = typeof description === "string" ? description.trim() : "", safeCover = normalizeCourseCover(cover); const pricePiasters = parsePricePiasters(body.price ?? 0), isFree = body.isFree !== false, published = body.published !== false, requiresApproval = body.requiresApproval !== false; const normalizedGrade = gradeStage(grade); if (!safeTitle || safeTitle.length > 160 || !safeDescription || safeDescription.length > 5000) return error(res, 400, "أدخل اسم الكورس والوصف بصورة صحيحة."); if (!SECONDARY_GRADES.includes(normalizedGrade)) return error(res, 400, "اختر صفًا ثانويًا صحيحًا."); if (safeCover === null) return error(res, 400, "صورة الغلاف غير صالحة أو لم يكتمل رفعها."); if (pricePiasters === null || (!isFree && pricePiasters < 1)) return error(res, 400, "أدخل سعرًا موجبًا للكورس المدفوع."); const course = { id: id(), title: safeTitle, description: safeDescription, grade: normalizedGrade, category: "", cover: safeCover, pricePiasters: isFree ? 0 : pricePiasters, isFree, requiresApproval, ownerId: user.id, accessCode: createCourseCode(), published, maxViews: Math.max(1, Math.min(Number(maxViews) || 3, 20)), createdAt: now(), updatedAt: now() }; store.courses.push(course); audit(store, user, "course.created", course.id); notify(user.id, published ? "تم نشر الكورس" : "تم حفظ مسودة الكورس", `${published ? "تم نشر" : "تم حفظ"} كورس ${course.title}.`, "teacher-dashboard.html"); if (published) { const gradeMatches = (studentGrade) => gradeStage(studentGrade) === course.grade; store.users.filter((student) => student.role === "student" && student.active && gradeMatches(student.grade)).forEach((student) => notify(student.id, "كورس جديد لمرحلتك", `تم نشر كورس جديد لمرحلتك: ${course.title}. يمكنك الاطلاع عليه الآن.`, `course-details.html?course=${encodeURIComponent(course.id)}`)); } saveStore(store); return send(res, 201, { course: courseFor(user, course), accessCode: course.accessCode }); }
  const courseMatch = pathname.match(/^\/api\/courses\/([^/]+)$/);
  if (method === "GET" && courseMatch) { const user = getUser(req); const course = store.courses.find((item) => item.id === courseMatch[1]); const canViewUnpublished = user && (user.role === "admin" || course?.ownerId === user.id || store.enrollments.some((item) => item.courseId === course?.id && item.userId === user.id)); if (!course || (!course.published && !canViewUnpublished) || (user?.role === "student" && !matchesCourseGrade(user.grade, course.grade))) return error(res, 404, "الكورس غير موجود."); return send(res, 200, { course: courseFor(user, course) }); }
  if (courseMatch && method === "PATCH") { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const course = store.courses.find((item) => item.id === courseMatch[1]); if (!course || !isOwner(user, course)) return error(res, 403, "لا تملك هذا الكورس."); const body = await readJson(req); const updates = {}; if (body.title !== undefined) { if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 160) return error(res, 400, "اسم الكورس مطلوب ويجب ألا يتجاوز 160 حرفًا."); updates.title = body.title.trim(); } if (body.description !== undefined) { if (typeof body.description !== "string" || !body.description.trim() || body.description.trim().length > 5000) return error(res, 400, "وصف الكورس مطلوب ويجب ألا يتجاوز 5000 حرف."); updates.description = body.description.trim(); } if (body.grade !== undefined) { const normalizedGrade = gradeStage(body.grade); if (!SECONDARY_GRADES.includes(normalizedGrade)) return error(res, 400, "صف الكورس غير صالح."); updates.grade = normalizedGrade; } if (body.cover !== undefined) { const cover = normalizeCourseCover(body.cover); if (cover === null) return error(res, 400, "صورة الغلاف غير صالحة."); updates.cover = cover; } if (body.requiresApproval !== undefined) { if (typeof body.requiresApproval !== "boolean") return error(res, 400, "إعداد الموافقة غير صالح."); updates.requiresApproval = body.requiresApproval; } if (body.isFree !== undefined) { if (typeof body.isFree !== "boolean") return error(res, 400, "إعداد المجانية غير صالح."); updates.isFree = body.isFree; } if (body.price !== undefined) { const pricePiasters = parsePricePiasters(body.price); if (pricePiasters === null) return error(res, 400, "سعر الكورس غير صالح."); updates.pricePiasters = pricePiasters; } if ((updates.isFree ?? course.isFree) === false && (updates.pricePiasters ?? course.pricePiasters) < 1) return error(res, 400, "أدخل سعرًا موجبًا للكورس المدفوع."); if (updates.isFree) updates.pricePiasters = 0; if (body.published !== undefined) { if (typeof body.published !== "boolean") return error(res, 400, "حالة نشر الكورس غير صالحة."); updates.published = body.published; } const wasPublished = course.published; Object.assign(course, updates); course.updatedAt = now(); if (!wasPublished && course.published) { store.users.filter((student) => student.role === "student" && student.active && gradeStage(student.grade) === course.grade).forEach((student) => notify(student.id, "كورس جديد لمرحلتك", `تم نشر كورس جديد لمرحلتك: ${course.title}.`, `course-details.html?course=${encodeURIComponent(course.id)}`)); } audit(store, user, "course.updated", course.id); saveStore(store); return send(res, 200, { course: courseFor(user, course) }); }
  if (courseMatch && method === "DELETE") { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const courseIndex = store.courses.findIndex((item) => item.id === courseMatch[1]); const course = store.courses[courseIndex]; if (!course || !isOwner(user, course)) return error(res, 403, "لا تملك هذا الكورس."); const lessonIds = new Set(store.lessons.filter((lesson) => lesson.courseId === course.id).map((lesson) => lesson.id)); const examIds = new Set(store.exams.filter((exam) => exam.courseId === course.id).map((exam) => exam.id)); store.courses.splice(courseIndex, 1); store.lessons = store.lessons.filter((lesson) => lesson.courseId !== course.id); store.exams = store.exams.filter((exam) => exam.courseId !== course.id); store.enrollments = store.enrollments.filter((item) => item.courseId !== course.id); store.courseRequests = store.courseRequests.filter((item) => item.courseId !== course.id); store.progress = store.progress.filter((item) => item.courseId !== course.id && !lessonIds.has(item.lessonId)); store.watchEvents = store.watchEvents.filter((item) => !lessonIds.has(item.lessonId)); store.quizAttempts = store.quizAttempts.filter((item) => item.courseId !== course.id && !lessonIds.has(item.lessonId) && !examIds.has(item.examId)); audit(store, user, "course.deleted", course.id); saveStore(store); return send(res, 200, { ok: true }); }
  const enrollMatch = pathname.match(/^\/api\/courses\/([^/]+)\/enroll$/);
  if (method === "POST" && enrollMatch) { const user = requireUser(req, res, ["student"]); if (!user) return; const course = store.courses.find((item) => item.id === enrollMatch[1] && item.published); const { code } = await readJson(req); if (!course || String(code || "").trim().toUpperCase() !== course.accessCode) return error(res, 400, "كود الكورس غير صحيح."); if (!course.isFree || course.pricePiasters > 0) return error(res, 403, "الكورس مدفوع. أرسل طلب الالتحاق وانتظر الموافقة ثم ادفع عبر فوري."); const request = store.courseRequests.find((item) => item.courseId === course.id && item.studentId === user.id && item.status === "approved"); if (!request) return error(res, 403, "أرسل طلب الالتحاق وانتظر موافقة المدرس أو المدير أولاً."); if (!store.enrollments.some((item) => item.courseId === course.id && item.userId === user.id)) store.enrollments.push({ id: id(), courseId: course.id, userId: user.id, requestId: request.id, createdAt: now(), source: "teacher_approval" }); audit(store, user, "course.enrolled", course.id); saveStore(store); return send(res, 200, { course: courseFor(user, course) }); }
  const requestMatch = pathname.match(/^\/api\/courses\/([^/]+)\/request$/);
  if (method === "POST" && requestMatch) { const user = requireUser(req, res, ["student"]); if (!user) return; const course = store.courses.find((item) => item.id === requestMatch[1] && item.published); if (!course || !matchesCourseGrade(user.grade, course.grade)) return error(res, 404, "الكورس غير موجود لصفك الدراسي."); if (store.enrollments.some((item) => item.courseId === course.id && item.userId === user.id)) return error(res, 409, "أنت مشترك في هذا الكورس بالفعل."); const { phone } = await readJson(req); const contactPhone = String(phone || user.phone || "").trim(); if (!contactPhone) return error(res, 400, "أدخل رقم هاتف للتواصل."); user.phone = contactPhone; let request = store.courseRequests.find((item) => item.courseId === course.id && item.studentId === user.id && item.status === "pending"); if (!request) { request = { id: id(), courseId: course.id, studentId: user.id, teacherId: course.ownerId, phone: contactPhone, requestCode: `REQ-${crypto.randomBytes(3).toString("hex").toUpperCase()}`, status: course.requiresApproval === false ? "approved" : "pending", createdAt: now() }; if (request.status === "approved") { request.handledAt = now(); request.handledBy = course.ownerId; if (course.isFree) store.enrollments.push({ id: id(), courseId: course.id, userId: user.id, requestId: request.id, createdAt: now(), source: "automatic_approval" }); } store.courseRequests.unshift(request); audit(store, user, request.status === "approved" ? "course_request.approved_automatically" : "course.requested", course.id, { requestCode: request.requestCode }); const requestDetails = `طلب كورس جديد: ${course.title}\nكود الكورس: ${course.accessCode}\nاسم الطالب: ${user.name}\nرقم الطالب: ${contactPhone}\nرقم الطلب: ${request.requestCode}`; const recipients = new Set([course.ownerId, ...store.users.filter((item) => item.role === "admin" && item.active).map((item) => item.id)]); if (request.status === "pending") recipients.forEach((recipientId) => notify(recipientId, "طلب كورس جديد", requestDetails, "teacher-dashboard.html")); else notify(user.id, "تم قبول طلبك تلقائياً", course.isFree ? `تم تفعيل كورس ${course.title} في حسابك.` : `تم قبول طلب كورس ${course.title}. أكمل الدفع من صفحة الكورس.`, `course-details.html?course=${course.id}`); saveStore(store); } const teacher = store.users.find((item) => item.id === course.ownerId); return send(res, 201, { request: { id: request.id, requestCode: request.requestCode, status: request.status }, teacher: { name: teacher?.name || "إدارة المنصة", phone: TEACHER_CONTACT_PHONE } }); }
  if (method === "GET" && pathname === "/api/course-requests") { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const requests = store.courseRequests.filter((item) => user.role === "admin" || item.teacherId === user.id).map((item) => { const student = store.users.find((u) => u.id === item.studentId); const course = store.courses.find((c) => c.id === item.courseId); return { ...item, student: student ? { name: student.name, email: student.email, phone: item.phone || student.phone, grade: student.grade } : null, course: course ? { title: course.title, accessCode: course.accessCode } : null }; }); return send(res, 200, { requests }); }
  const requestActionMatch = pathname.match(/^\/api\/course-requests\/([^/]+)\/(approve|reject)$/);
  if (method === "POST" && requestActionMatch) { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const request = store.courseRequests.find((item) => item.id === requestActionMatch[1]); if (!request || (user.role !== "admin" && request.teacherId !== user.id)) return error(res, 403, "لا تملك هذا الطلب."); if (request.status !== "pending") return error(res, 409, "تم التعامل مع هذا الطلب سابقاً."); request.status = requestActionMatch[2] === "approve" ? "approved" : "rejected"; request.handledAt = now(); request.handledBy = user.id; const course = store.courses.find((item) => item.id === request.courseId); const paidOrder = store.paymentOrders.find((item) => item.courseId === request.courseId && item.userId === request.studentId && item.status === "paid"); if (request.status === "approved" && !store.enrollments.some((item) => item.courseId === request.courseId && item.userId === request.studentId)) { if (course?.isFree) store.enrollments.push({ id: id(), courseId: request.courseId, userId: request.studentId, requestId: request.id, createdAt: now(), source: "teacher_approval" }); else if (paidOrder) grantPaidEnrollment(paidOrder); } const approvedButNeedsPayment = request.status === "approved" && !course?.isFree && !paidOrder; notify(request.studentId, request.status === "approved" ? "تم قبول طلبك" : "تم رفض طلبك", request.status === "approved" ? approvedButNeedsPayment ? `تمت الموافقة على طلب كورس ${course?.title || ""}. أكمل الدفع من صفحة الكورس لتفعيل المحتوى.` : `تم فتح كورس ${course?.title || ""} في حسابك.` : `لم تتم الموافقة على طلب كورس ${course?.title || ""}.`, request.status === "approved" ? `course-details.html?course=${request.courseId}` : "courses.html"); audit(store, user, `course_request.${request.status}`, request.id); saveStore(store); return send(res, 200, { request, paymentRequired: approvedButNeedsPayment }); }
  const lessonCollection = pathname.match(/^\/api\/courses\/([^/]+)\/lessons$/);
  if (lessonCollection && method === "GET") { const user = requireUser(req, res); if (!user) return; const enrolled = lessonAccess(user, lessonCollection[1]); const lessons = store.lessons.filter((lesson) => lesson.courseId === lessonCollection[1] && (enrolled || lesson.isFree)).sort((a, b) => a.position - b.position).map(({ questions, ...lesson }) => user.role === "admin" || user.role === "teacher" ? lesson : { ...lesson, videoUrl: undefined, pdfUrl: undefined }); return send(res, 200, { lessons }); }
  if (lessonCollection && method === "POST") { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const course = store.courses.find((item) => item.id === lessonCollection[1]); if (!course || !isOwner(user, course)) return error(res, 403, "لا تملك هذا الكورس."); const { title, videoUrl, pdfUrl, maxViews, isFree = false, questions = [] } = await readJson(req); const preparedQuestions = prepareLessonQuestions(questions); if (typeof title !== "string" || !title.trim() || title.trim().length > 160 || typeof videoUrl !== "string" || !videoUrl.trim() || videoUrl.length > 2000 || !validLessonVideo(videoUrl) || (pdfUrl !== undefined && (typeof pdfUrl !== "string" || pdfUrl.length > 2000)) || typeof isFree !== "boolean" || !preparedQuestions) return error(res, 400, "تحقق من عنوان المحاضرة ورابط الفيديو وأسئلة المحاضرة وإجاباتها."); const position = Math.max(0, ...store.lessons.filter((item) => item.courseId === course.id).map((item) => Number(item.position) || 0)) + 1; const lesson = { id: id(), courseId: course.id, title: title.trim(), videoUrl: videoUrl.trim(), pdfUrl: typeof pdfUrl === "string" ? pdfUrl.trim() : "", isFree, position, maxViews: Math.max(1, Math.min(Number(maxViews) || course.maxViews, 20)), questions: preparedQuestions, createdAt: now(), updatedAt: now() }; store.lessons.push(lesson); store.enrollments.filter((item) => item.courseId === course.id).forEach((item) => notify(item.userId, "درس جديد", `أضيف درس جديد إلى كورس ${course.title}: ${lesson.title}.`, `lessons.html?course=${course.id}`)); audit(store, user, "lesson.created", lesson.id); saveStore(store); return send(res, 201, { lesson: { ...lesson, questions: undefined } }); }
  const lessonMatch = pathname.match(/^\/api\/lessons\/([^/]+)$/);
  if (lessonMatch && method === "GET") { const user = requireUser(req, res); if (!user) return; const lesson = store.lessons.find((item) => item.id === lessonMatch[1]); const course = lesson && store.courses.find((item) => item.id === lesson.courseId); if (!lesson || !course || !lessonAccess(user, lesson.courseId, lesson)) return error(res, 403, "لا يمكنك فتح هذا الدرس."); const { questions = [], videoUrl, pdfUrl, ...publicLesson } = lesson; const canManage = user.role === "admin" || (user.role === "teacher" && course.ownerId === user.id); const visibleQuestions = canManage ? questions : questions.map(({ answer, answerIndex, ...question }) => question); const safeLesson = { ...publicLesson, questions: visibleQuestions, ...(canManage ? { videoUrl, pdfUrl } : {}) }; return send(res, 200, { lesson: safeLesson, course: { id: course.id, title: course.title } }); }
  if (lessonMatch && method === "PATCH") {
    const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return;
    const lesson = store.lessons.find((item) => item.id === lessonMatch[1]);
    const course = lesson && store.courses.find((item) => item.id === lesson.courseId);
    if (!lesson || !course || !isOwner(user, course)) return error(res, 403, "لا تملك هذا الدرس.");
    const body = await readJson(req), updates = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 160) return error(res, 400, "عنوان الدرس مطلوب ويجب ألا يتجاوز 160 حرفًا.");
      updates.title = body.title.trim();
    }
    for (const key of ["videoUrl", "pdfUrl"]) if (body[key] !== undefined) {
      if (typeof body[key] !== "string" || !body[key].trim() || body[key].length > 2000) return error(res, 400, "رابط ملف الدرس غير صالح.");
      if (key === "videoUrl" && !validLessonVideo(body[key])) return error(res, 400, "رابط الفيديو يجب أن يكون MP4/WebM أو رابط YouTube/Vimeo صالحًا.");
      updates[key] = body[key].trim();
    }
    if (body.isFree !== undefined) {
      if (typeof body.isFree !== "boolean") return error(res, 400, "إعداد إتاحة الدرس غير صالح.");
      updates.isFree = body.isFree;
    }
    if (body.questions !== undefined) {
      const preparedQuestions = prepareLessonQuestions(body.questions);
      if (!preparedQuestions) return error(res, 400, "تحقق من أسئلة المحاضرة: اكتب السؤال واختيارين على الأقل وحدد الإجابة الصحيحة.");
      updates.questions = preparedQuestions;
    }
    if (body.position !== undefined) {
      const position = Number(body.position);
      if (!Number.isInteger(position) || position < 1 || store.lessons.some((item) => item.courseId === lesson.courseId && item.id !== lesson.id && item.position === position)) return error(res, 400, "ترتيب الدرس غير صالح أو مستخدم بالفعل.");
      updates.position = position;
    }
    Object.assign(lesson, updates); lesson.updatedAt = now(); audit(store, user, "lesson.updated", lesson.id); saveStore(store);
    return send(res, 200, { lesson: { ...lesson, questions: undefined } });
  }
  if (lessonMatch && method === "DELETE") { const user = requireUser(req, res, ["teacher", "admin"]); if (!user) return; const index = store.lessons.findIndex((item) => item.id === lessonMatch[1]); const lesson = store.lessons[index]; const course = lesson && store.courses.find((item) => item.id === lesson.courseId); if (!lesson || !course || !isOwner(user, course)) return error(res, 403, "لا تملك هذا الدرس."); store.lessons.splice(index, 1); store.progress = store.progress.filter((item) => item.lessonId !== lesson.id); store.watchEvents = store.watchEvents.filter((item) => item.lessonId !== lesson.id); store.quizAttempts = store.quizAttempts.filter((item) => item.lessonId !== lesson.id); audit(store, user, "lesson.deleted", lesson.id); saveStore(store); return send(res, 200, { ok: true }); }
  const watchMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/watch$/);
  if (method === "POST" && watchMatch) { const user = requireUser(req, res); if (!user) return; const lesson = store.lessons.find((item) => item.id === watchMatch[1]); if (!lesson || !lessonAccess(user, lesson.courseId, lesson)) return error(res, 403, "لا يمكنك مشاهدة هذا الدرس."); const used = store.watchEvents.filter((item) => item.userId === user.id && item.lessonId === lesson.id).length; if (used >= lesson.maxViews) return error(res, 423, "انتهت مرات المشاهدة المتاحة لهذا الدرس."); const watchEvent = { id: id(), userId: user.id, lessonId: lesson.id, createdAt: now() }; store.watchEvents.push(watchEvent); audit(store, user, "lesson.watched", lesson.id); saveStore(store); return send(res, 200, { videoUrl: lessonMediaUrl(lesson.videoUrl, user, lesson, watchEvent), pdfUrl: lessonMediaUrl(lesson.pdfUrl, user, lesson, watchEvent), watchId: watchEvent.id, viewsRemaining: lesson.maxViews - used - 1 }); }
  const progressMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/progress$/);
  if (progressMatch && method === "POST") { const user = requireUser(req, res, ["student"]); if (!user) return; const lesson = store.lessons.find((item) => item.id === progressMatch[1]); if (!lesson || !lessonAccess(user, lesson.courseId, lesson)) return error(res, 403, "لا يمكنك تحديث تقدم هذا الدرس."); const { position = 0, watchId } = await readJson(req); const watch = store.watchEvents.find((item) => item.id === watchId && item.userId === user.id && item.lessonId === lesson.id); if (!watch) return error(res, 403, "ابدأ مشاهدة الدرس قبل تسجيل التقدم."); const elapsed = (Date.now() - new Date(watch.createdAt).getTime()) / 1000; let progress = store.progress.find((item) => item.userId === user.id && item.lessonId === lesson.id); if (!progress) { progress = { id: id(), userId: user.id, lessonId: lesson.id, courseId: lesson.courseId, position: 0, completed: false, updatedAt: now() }; store.progress.push(progress); } progress.position = Math.max(progress.position || 0, Math.min(86400, Number(position) || 0)); if (elapsed >= 60 && progress.position >= 60) progress.completed = true; progress.updatedAt = now(); saveStore(store); return send(res, 200, { progress }); }
  const courseProgressMatch = pathname.match(/^\/api\/courses\/([^/]+)\/progress$/);
  if (courseProgressMatch && method === "GET") { const user = requireUser(req, res, ["student"]); if (!user) return; const lessons = store.lessons.filter((item) => item.courseId === courseProgressMatch[1]); const progress = store.progress.filter((item) => item.userId === user.id && item.courseId === courseProgressMatch[1]); const completed = progress.filter((item) => item.completed).length; return send(res, 200, { total: lessons.length, completed, percent: lessons.length ? Math.round((completed / lessons.length) * 100) : 0, resumeLessonId: progress.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0]?.lessonId || lessons[0]?.id || null }); }
  const certificateMatch = pathname.match(/^\/api\/courses\/([^/]+)\/certificate$/);
  if (certificateMatch && method === "GET") { const user = requireUser(req, res, ["student"]); if (!user) return; const course = store.courses.find((item) => item.id === certificateMatch[1]); if (!course || !store.enrollments.some((item) => item.courseId === course.id && item.userId === user.id)) return error(res, 403, "الكورس غير متاح في حسابك."); const lessons = store.lessons.filter((item) => item.courseId === course.id); const completed = store.progress.filter((item) => item.userId === user.id && item.courseId === course.id && item.completed).length; if (!lessons.length || completed < lessons.length) return error(res, 409, "أكمل جميع دروس الكورس أولاً للحصول على الشهادة."); return send(res, 200, { certificate: { studentName: user.name, courseTitle: course.title, issuedAt: now(), number: `AMN-${crypto.randomBytes(4).toString("hex").toUpperCase()}` } }); }
  const answerMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/answers$/);
  if (method === "POST" && answerMatch) { const user = requireUser(req, res, ["student"]); if (!user) return; const lesson = store.lessons.find((item) => item.id === answerMatch[1]); if (!lesson || !lessonAccess(user, lesson.courseId)) return error(res, 403, "لا يمكنك حل أسئلة هذا الدرس."); const { answers } = await readJson(req); if (!lesson.questions?.length) return error(res, 400, "لا يوجد اختبار لهذه المحاضرة."); if (!Array.isArray(answers) || answers.length !== lesson.questions.length || answers.some((answer, index) => String(answer).trim() === "" || !Number.isInteger(Number(answer)) || Number(answer) < 0 || Number(answer) >= lesson.questions[index].options.length)) return error(res, 400, "أجب عن جميع الأسئلة واختر إجابة صالحة لكل سؤال."); const score = lesson.questions.reduce((sum, question, index) => sum + (Number(answers[index]) === Number(question.answer) ? 1 : 0), 0); const attempt = { id: id(), userId: user.id, lessonId: lesson.id, courseId: lesson.courseId, score, total: lesson.questions.length, createdAt: now() }; store.quizAttempts.push(attempt); audit(store, user, "quiz.submitted", lesson.id, { score, total: attempt.total }); saveStore(store, ["quiz_attempts", "audit_log"]); return send(res, 200, { score, total: attempt.total }); }

  if (method === "GET" && pathname === "/api/admin/contact-messages") { const user = requireUser(req, res, ["admin"]); if (!user) return; return send(res, 200, { messages: (store.contactMessages || []).slice(0, 100) }); }
  const studentAccountAction = pathname.match(/^\/api\/students\/([^/]+)\/(ban|unban)$/);
  if (studentAccountAction && method === "POST") {
    const actor = requireUser(req, res, ["admin", "teacher"]); if (!actor) return;
    const target = store.users.find((item) => item.id === studentAccountAction[1] && item.role === "student");
    if (!target) return error(res, 404, "الطالب غير موجود.");
    if (actor.role === "teacher") {
      const ownsEnrollment = store.enrollments.some((entry) => entry.userId === target.id && store.courses.some((course) => course.id === entry.courseId && course.ownerId === actor.id));
      if (!ownsEnrollment) return error(res, 403, "لا تملك صلاحية إدارة هذا الطالب.");
    }
    const active = studentAccountAction[2] === "unban";
    if (target.active !== active) {
      target.active = active;
      target.sessionVersion = (target.sessionVersion || 0) + 1;
      audit(store, actor, active ? "student.unbanned" : "student.banned", target.id);
      if (active) notify(target.id, "تم تفعيل حسابك", "أعادت إدارة المنصة تفعيل حسابك.", "login.html");
      saveStore(store);
    }
    return send(res, 200, { user: publicUser(target) });
  }
  if (method === "GET" && pathname === "/api/admin/users") { const user = requireUser(req, res, ["admin"]); if (!user) return; return send(res, 200, { users: store.users.map(publicUser) }); }
  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (method === "PATCH" && userMatch) { const admin = requireUser(req, res, ["admin"]); if (!admin) return; const target = store.users.find((user) => user.id === userMatch[1]); const { name, grade, role, active } = await readJson(req); if (!target) return error(res, 404, "المستخدم غير موجود."); const previousRole = target.role; const previousActive = target.active; if (name?.trim()) target.name = name.trim(); if (grade !== undefined) target.grade = grade; if (["student", "teacher", "admin"].includes(role)) target.role = role; if (typeof active === "boolean") target.active = active; if (previousRole !== target.role || previousActive !== target.active) target.sessionVersion = (target.sessionVersion || 0) + 1; if (target.active) notify(target.id, "تم تحديث حسابك", previousRole !== target.role ? `تم تغيير صلاحية حسابك إلى ${target.role === "teacher" ? "مدرس" : target.role === "admin" ? "أدمن" : "طالب"}.` : "تم تحديث بيانات حسابك من الإدارة.", "profile.html"); audit(store, admin, "admin.updated_user", target.id); saveStore(store); return send(res, 200, { user: publicUser(target) }); }
  const resetByAdminMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if (method === "POST" && resetByAdminMatch) { const admin = requireUser(req, res, ["admin"]); if (!admin) return; const target = store.users.find((user) => user.id === resetByAdminMatch[1]); const { newPassword } = await readJson(req); if (!target) return error(res, 404, "المستخدم غير موجود."); if (!newPassword || String(newPassword).length < 8) return error(res, 400, "كلمة المرور المؤقتة يجب أن تكون 8 أحرف على الأقل."); target.passwordHash = hashPassword(String(newPassword)); target.sessionVersion = (target.sessionVersion || 0) + 1; store.passwordResetRequests.filter((item) => item.userId === target.id && item.status === "pending").forEach((item) => { item.status = "handled"; item.handledAt = now(); }); audit(store, admin, "admin.reset_password", target.id); saveStore(store); return send(res, 200, { ok: true }); }
  if (method === "GET" && pathname === "/api/admin/activity") { const user = requireUser(req, res, ["admin"]); if (!user) return; return send(res, 200, { activity: store.audit.slice(0, 100), attempts: store.quizAttempts.slice(0, 100), watches: store.watchEvents.slice(0, 100) }); }
  return error(res, 404, "المسار غير موجود.");
}

function serveRobots(res) {
  const sitemap = SEARCH_BASE_URL ? `Sitemap: ${SEARCH_BASE_URL}/sitemap.xml\n` : "";
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(`User-agent: *\nAllow: /\nDisallow: /api/\n${sitemap}`);
}
function serveSitemap(res) {
  if (!SEARCH_BASE_URL) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    return res.end("Set SITE_URL to the public HTTPS origin to enable the sitemap.\n");
  }
  const urls = [...SEARCHABLE_PAGES].filter((pathname) => pathname !== "/index.html").map((pathname) => `  <url><loc>${SEARCH_BASE_URL}${pathname === "/" ? "/" : pathname}</loc></url>`).join("\n");
  res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".pdf": "application/pdf", ".webm": "video/webm", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
let lastRateLimitCleanup = 0;
let uploadInFlight = 0;
const MAX_CONCURRENT_UPLOADS = 1;
const UPLOAD_RULES = {
  "course-cover": { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8_000_000 },
  video: { types: ["video/mp4", "video/webm"], maxBytes: 50_000_000 },
  "chat-video": { types: ["video/mp4", "video/webm"], maxBytes: 20_000_000 },
  "chat-image": { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8_000_000 },
  "question-image": { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8_000_000 },
  avatar: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 8_000_000 },
  "chat-audio": { types: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"], maxBytes: 12_000_000 },
  pdf: { types: ["application/pdf"], maxBytes: 50_000_000 },
};
function uploadContentMatches(bytes, contentType) {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (contentType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (contentType === "application/pdf") return bytes.length >= 8 && bytes.toString("ascii", 0, 5) === "%PDF-";
  if (contentType === "video/webm" || contentType === "audio/webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (contentType === "audio/ogg") return bytes.length >= 4 && bytes.toString("ascii", 0, 4) === "OggS";
  if (contentType === "audio/wav") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
  if (contentType === "audio/mpeg") return bytes.length >= 3 && (bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));
  if (contentType === "video/mp4" || contentType === "audio/mp4") return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
  return false;
}
function scanWithClamAV(filePath) {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(CLAMSCAN_PATH, ["--no-summary", filePath], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      finish({ status: "unavailable" });
      return;
    }
    const collect = (chunk) => { if (output.length < 8_192) output += chunk.toString("utf8").slice(0, 8_192 - output.length); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", () => finish({ status: "unavailable" }));
    child.once("close", (code) => finish(code === 0 ? { status: "clean" } : code === 1 ? { status: "infected" } : { status: "error", output }));
    timer = setTimeout(() => {
      child.kill();
      finish({ status: "timeout" });
    }, CLAMSCAN_TIMEOUT_MS);
    timer.unref?.();
  });
}
function rateAllowed(req, pathname) {
  const rules = pathname === "/api/contact" ? ["contact", 5, 60_000]
    : pathname === "/api/auth/login" ? ["login", 15, 15 * 60_000]
    : pathname === "/api/auth/register" ? ["register", 10, 60 * 60_000]
    : pathname === "/api/auth/password-reset-request" ? ["reset", 5, 15 * 60_000]
    : pathname === "/api/uploads" ? ["upload", 12, 60_000]
    : pathname.endsWith("/enroll") || pathname.includes("course-requests") ? ["course", 30, 60_000]
    : pathname.includes("/chat/") || pathname.includes("direct-messages") ? ["messages", 180, 60_000] : null;
  if (!rules) return true;
  const [scope, limit, windowMs] = rules;
  const forwarded = TRUST_PROXY ? req.headers["x-forwarded-for"] : "";
  // When an explicitly trusted proxy appends its observed client address, the
  // final entry cannot be chosen by a client-supplied leading X-Forwarded-For.
  const ip = forwarded ? String(forwarded).split(",").at(-1).trim() : (req.socket.remoteAddress || "unknown");
  const user = getUser(req);
  const key = sha256(`${scope}:${user ? `user:${user.id}` : `ip:${ip}`}`);
  const time = Date.now();
  const existing = database.prepare("SELECT window_started_at, hits FROM rate_limit_buckets WHERE bucket_key = ?").get(key);
  const expired = !existing || time - existing.window_started_at >= windowMs;
  const hits = expired ? 1 : existing.hits + 1;
  database.prepare("INSERT INTO rate_limit_buckets (bucket_key, window_started_at, hits, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at = excluded.window_started_at, hits = excluded.hits, updated_at = excluded.updated_at").run(key, expired ? time : existing.window_started_at, hits, time);
  if (time - lastRateLimitCleanup >= 10 * 60_000) {
    database.prepare("DELETE FROM rate_limit_buckets WHERE updated_at < ?").run(time - 2 * 60 * 60_000);
    lastRateLimitCleanup = time;
  }
  return hits <= limit;
}
function serveFile(req, res, file, privateFile = false) {
  const ext = path.extname(file).toLowerCase();
  const contentType = mime[ext] || "application/octet-stream";
  const stat = fs.statSync(file);
  let htmlBody = null;
  if (ext === ".html") {
    htmlBody = fs.readFileSync(file);
    if (SEARCH_BASE_URL && SEARCHABLE_PAGES.has(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname)) {
      const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
      const canonicalPath = pathname === "/index.html" ? "/" : pathname;
      htmlBody = Buffer.from(htmlBody.toString("utf8").replace("<!--SEO_CANONICAL-->", `<link rel="canonical" href="${SEARCH_BASE_URL}${canonicalPath}">`));
    } else {
      htmlBody = Buffer.from(htmlBody.toString("utf8").replace("<!--SEO_CANONICAL-->", ""));
    }
  }
  const total = htmlBody ? htmlBody.length : stat.size;
  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()"
  };
  if (privateFile || !production) headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  const range = req.headers.range;
  if (range && (ext === ".mp4" || ext === ".webm" || ext === ".m4a" || ext === ".mp3" || ext === ".ogg" || ext === ".wav")) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (isNaN(start) || start >= total || (end && end >= total) || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      return res.end();
    }
    const chunkSize = (end - start) + 1;
    headers["Content-Range"] = `bytes ${start}-${end}/${total}`;
    headers["Content-Length"] = chunkSize;
    res.writeHead(206, headers);
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    stream.pipe(res);
    return;
  }
  headers["Content-Length"] = total;
  if (req.method === "HEAD") { res.writeHead(200, headers); return res.end(); }
  res.writeHead(200, headers);
  if (htmlBody) return res.end(htmlBody);
  const stream = fs.createReadStream(file);
  stream.on("error", () => { if (!res.headersSent) res.writeHead(404); res.end(); });
  stream.pipe(res);
}
function mediaAccess(req, pathname, searchParams) {
  const user = getUser(req);
  const match = pathname.match(/^\/uploads\/([0-9a-f-]{36}\.(?:jpg|png|webp|webm|video\.webm|m4a|ogg|wav|mp3|mp4|pdf))$/i);
  if (!match) return null;
  const url = `/uploads/${match[1]}`;
  if (store.courses.some((course) => course.published && course.cover === url)) return user || { role: "public" };
  if (!user) return null;
  const chatMessage = (store.chatMessages || []).find((message) => message.attachment?.url === url);
  if (chatMessage) {
    if (user.role === "admin" || user.role === "teacher") return user;
    if (user.role === "student" && chatMessage.groupId === chatGroupId(gradeStage(user.grade))) return user;
    return null;
  }
  if ((store.directMessages || []).some((message) => message.attachment?.url === url && (message.senderId === user.id || message.recipientId === user.id))) return user;
  if (store.users.some((entry) => entry.avatarUrl === url)) return user;
  const exam = (store.exams || []).find((item) => item.questions?.some((q) => q.imageUrl === url));
  if (exam) {
    const course = store.courses.find((item) => item.id === exam.courseId);
    if (!course) return null;
    if (user.role === "admin" || course.ownerId === user.id) return user;
    if (user.role === "student" && store.enrollments.some((item) => item.courseId === exam.courseId && item.userId === user.id)) return user;
    return null;
  }
  const lesson = store.lessons.find((item) => item.videoUrl === url || item.pdfUrl === url);
  if (!lesson) return null;
  const course = store.courses.find((item) => item.id === lesson.courseId);
  if (!course) return null;
  if (user.role === "admin" || course.ownerId === user.id) return user;
  if (user.role === "student" && lessonAccess(user, lesson.courseId, lesson) && (lesson.isFree ? course.published : true)) {
    const ticket = verifyToken(searchParams?.get("watch") || "");
    const isLessonFile = lesson.videoUrl === url || lesson.pdfUrl === url;
    const hasWatchEvent = ticket && store.watchEvents.some((event) => event.id === ticket.watchId && event.userId === user.id && event.lessonId === lesson.id);
    if (isLessonFile && ticket?.scope === "lesson-media" && ticket.sub === user.id && ticket.lessonId === lesson.id && hasWatchEvent) return user;
  }
  return null;
}
const server = http.createServer(async (req, res) => {
  res.on("finish", () => {
    // Never write query parameters: media tickets and other bearer tokens can appear there.
    console.log(`${req.method} ${String(req.url || "").split("?", 1)[0]} -> ${res.statusCode}`);
  });
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/robots.txt") return serveRobots(res);
    if (req.method === "GET" && url.pathname === "/sitemap.xml") return serveSitemap(res);
    if (url.pathname.startsWith("/api/")) {
      if (!rateAllowed(req, url.pathname)) return error(res, 429, "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.");
      return await api(req, res, url.pathname);
    }
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    if (requested.startsWith("/uploads/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
      const user = mediaAccess(req, requested, url.searchParams);
      if (!user) return res.writeHead(404).end("Not found");
      const file = path.join(UPLOAD_DIR, path.basename(requested));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end("Not found");
      return serveFile(req, res, file, true);
    }
    const allowedPage = PUBLIC_PAGES.has(requested);
    const allowedAsset = /^\/assets\/[a-z0-9._-]+\.(?:js|css|jpe?g|png|webp|ico)$/i.test(requested);
    if ((!allowedPage && !allowedAsset) || (req.method !== "GET" && req.method !== "HEAD")) return res.writeHead(404).end("Not found");
    const file = path.resolve(ROOT, `.${requested}`);
    const relative = path.relative(ROOT, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end("Not found");
    const pageGuard = PROTECTED_PAGES[requested];
    if (pageGuard) {
      const viewer = userFromPayload(verifyToken(cookieToken(req)));
      if (!viewer || !pageGuard.includes(viewer.role)) {
        res.writeHead(302, { Location: "/login.html?next=" + encodeURIComponent(requested) });
        return res.end();
      }
    }
    return serveFile(req, res, file);
  } catch (cause) { if (res.headersSent) return res.destroy(); error(res, cause.status || 500, cause.status ? cause.message : (cause.message || "حدث خطأ بالخادم.")); }
});
server.on("error", (cause) => {
  if (cause.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use on ${HOST}. Stop the other server or choose another PORT.`);
  else if (cause.code === "EACCES") console.error(`Permission denied while binding ${HOST}:${PORT}. Choose an available port or check the service permissions.`);
  else console.error(`Could not start the server: ${cause.message}`);
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => console.log(`Ameen platform: http://${HOST}:${PORT}`));














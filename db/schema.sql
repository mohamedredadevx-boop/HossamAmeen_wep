-- Ameen Learning Platform database schema (SQLite 3.38+)
-- Run with: sqlite3 data/ameen.sqlite < db/schema.sql
-- Keep uploaded media in the uploads/ directory; store only its URL/path here.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA encoding = 'UTF-8';

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    grade TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    session_version INTEGER NOT NULL DEFAULT 0 CHECK (session_version >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    grade TEXT NOT NULL CHECK (grade IN ('prep', 'secondary')),
    grade_level INTEGER NOT NULL DEFAULT 0 CHECK (grade_level BETWEEN 0 AND 3),
    category TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
    price_piasters INTEGER NOT NULL DEFAULT 0 CHECK (price_piasters >= 0),
    is_free INTEGER NOT NULL DEFAULT 1 CHECK (is_free IN (0, 1)),
    access_code TEXT NOT NULL UNIQUE,
    published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
    requires_approval INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval IN (0, 1)),
    max_views INTEGER NOT NULL DEFAULT 3 CHECK (max_views BETWEEN 1 AND 20),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    video_url TEXT NOT NULL,
    pdf_url TEXT NOT NULL,
    is_free INTEGER NOT NULL DEFAULT 0 CHECK (is_free IN (0, 1)),
    position INTEGER NOT NULL DEFAULT 1 CHECK (position >= 1),
    max_views INTEGER NOT NULL DEFAULT 3 CHECK (max_views BETWEEN 1 AND 20),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS lesson_questions (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    answer TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 1),
    UNIQUE (lesson_id, position)
);

CREATE TABLE IF NOT EXISTS lesson_question_options (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 1),
    UNIQUE (question_id, position)
);

CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT,
    source TEXT NOT NULL DEFAULT 'course_code',
    created_at TEXT NOT NULL,
    UNIQUE (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS course_requests (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    phone TEXT NOT NULL,
    request_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    handled_at TEXT,
    handled_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'handled')),
    created_at TEXT NOT NULL,
    handled_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    position REAL NOT NULL DEFAULT 0 CHECK (position >= 0),
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS watch_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_questions (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    answer_index INTEGER NOT NULL CHECK (answer_index >= 0),
    position INTEGER NOT NULL CHECK (position >= 1),
    UNIQUE (exam_id, position)
);

CREATE TABLE IF NOT EXISTS exam_question_options (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (question_id, position)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
    exam_id TEXT REFERENCES exams(id) ON DELETE CASCADE,
    course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0),
    total INTEGER NOT NULL CHECK (total >= 0 AND score <= total),
    answers_json TEXT CHECK (answers_json IS NULL OR json_valid(answers_json)),
    created_at TEXT NOT NULL,
    CHECK (lesson_id IS NOT NULL OR exam_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL CHECK (author_role IN ('student', 'teacher', 'admin')),
    text TEXT NOT NULL DEFAULT '',
    attachment_json TEXT CHECK (attachment_json IS NULL OR json_valid(attachment_json)),
    is_question INTEGER NOT NULL DEFAULT 0 CHECK (is_question IN (0, 1)),
    reply_to_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
    reply_to_json TEXT CHECK (reply_to_json IS NULL OR json_valid(reply_to_json)),
    group_id TEXT NOT NULL DEFAULT 'global',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_groups (
    id TEXT PRIMARY KEY,
    grade TEXT NOT NULL UNIQUE CHECK (grade IN ('prep', 'secondary', 'first-secondary', 'second-secondary', 'third-secondary')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_deleted_messages (
    message_id TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    attachment_json TEXT CHECK (attachment_json IS NULL OR json_valid(attachment_json)),
    created_at TEXT NOT NULL,
    read_at TEXT,
    CHECK (sender_id <> recipient_id)
);

CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    merchant_ref_num TEXT NOT NULL UNIQUE,
    fawry_ref_number TEXT NOT NULL DEFAULT '',
    amount_piasters INTEGER NOT NULL CHECK (amount_piasters > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded')),
    payment_method TEXT NOT NULL DEFAULT 'PayAtFawry',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_messages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT 'استفسار',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target TEXT,
    meta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json)),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_owner ON courses(owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_published_grade ON courses(published, grade);
CREATE INDEX IF NOT EXISTS idx_lessons_course_position ON lessons(course_id, position);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_requests_teacher_status ON course_requests(teacher_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_requests_one_pending ON course_requests(course_id, student_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_user_course ON progress(user_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_watch_events_user_lesson ON watch_events(user_id, lesson_id, created_at);
CREATE INDEX IF NOT EXISTS idx_exams_course ON exams(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_course ON quiz_attempts(course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_pair ON direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_unread ON direct_messages(recipient_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- Shared, restart-resistant fixed-window rate limits. Keys are hashed by the app.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    hits INTEGER NOT NULL CHECK (hits >= 0),
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_updated ON rate_limit_buckets(updated_at);

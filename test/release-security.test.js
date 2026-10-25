const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function launchServer(port, dataDir, uploadDir, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(projectRoot, "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      AMEEN_DATA_DIR: dataDir,
      AMEEN_UPLOAD_DIR: uploadDir,
      SESSION_SECRET: "release-smoke-only-session-secret-48-characters",
      ADMIN_EMAIL: "release-check@example.test",
      ADMIN_PASSWORD: "Release-Smoke-Only-42!",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited before becoming ready.\n${output}`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) { ready = true; break; }
    } catch {}
    await sleep(100);
  }
  if (!ready) {
    child.kill();
    throw new Error(`Server did not become ready.\n${output}`);
  }
  return {
    child,
    baseUrl,
    getOutput: () => output,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        sleep(5000).then(() => { throw new Error("Timed out stopping smoke-test server."); }),
      ]);
    },
  };
}

test("release safeguards reject spoofed uploads, avoid URL-token logs, and retain rate limits across restart", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ameen-release-smoke-"));
  const dataDir = path.join(tempRoot, "data");
  const uploadDir = path.join(tempRoot, "uploads");
  const port = await availablePort();
  let server = await launchServer(port, dataDir, uploadDir);
  t.after(async () => {
    await server?.stop().catch(() => {});
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const protectedPage = await fetch(`${server.baseUrl}/admin.html`, { redirect: "manual" });
  assert.equal(protectedPage.status, 302, "admin page requires an authenticated admin session");

  const secretQuery = "query-token-must-not-be-logged";
  const login = await fetch(`${server.baseUrl}/api/auth/login?ticket=${secretQuery}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "release-check@example.test", password: "Release-Smoke-Only-42!" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("ameen_token="), "login issues an HttpOnly session cookie");

  const register = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Smoke Student", email: "student@example.test", password: "Student-Smoke-42!", grade: "first-secondary", phone: "01012345678" }),
  });
  assert.equal(register.status, 201, "student registration succeeds");
  const studentCookie = register.headers.get("set-cookie")?.split(";", 1)[0];
  assert.equal((await register.json()).user.role, "student");
  const forbiddenAdminApi = await fetch(`${server.baseUrl}/api/admin/users`, { headers: { cookie: studentCookie } });
  assert.equal(forbiddenAdminApi.status, 403, "student cannot access admin API");

  const createCourse = await fetch(`${server.baseUrl}/api/courses`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "Smoke Course", description: "Release smoke test", grade: "first-secondary", isFree: true, published: true }),
  });
  assert.equal(createCourse.status, 201, "admin can create a course");
  const courseData = await createCourse.json();
  const requestCourse = await fetch(`${server.baseUrl}/api/courses/${courseData.course.id}/request`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: studentCookie },
    body: JSON.stringify({ phone: "01012345678" }),
  });
  assert.equal(requestCourse.status, 201, "student can request course access");
  const requestsResponse = await fetch(`${server.baseUrl}/api/course-requests`, { headers: { cookie } });
  const courseRequest = (await requestsResponse.json()).requests[0];
  const approveRequest = await fetch(`${server.baseUrl}/api/course-requests/${courseRequest.id}/approve`, {
    method: "POST", headers: { cookie },
  });
  assert.equal(approveRequest.status, 200, "admin can approve the course request");
  const enrollment = await fetch(`${server.baseUrl}/api/courses/${courseData.course.id}/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: studentCookie },
    body: JSON.stringify({ code: courseData.accessCode }),
  });
  assert.equal(enrollment.status, 200, "approved student can enroll with the course code");

  const automaticCourseResponse = await fetch(`${server.baseUrl}/api/courses`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "Automatic Course", description: "Automatic approval test", grade: "first-secondary", isFree: true, requiresApproval: false, published: true }),
  });
  assert.equal(automaticCourseResponse.status, 201, "admin can configure automatic course approval");
  const automaticCourse = (await automaticCourseResponse.json()).course;
  assert.equal(automaticCourse.requiresApproval, false, "approval setting is returned by the API");
  const automaticRequestResponse = await fetch(`${server.baseUrl}/api/courses/${automaticCourse.id}/request`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: studentCookie },
    body: JSON.stringify({ phone: "01012345678" }),
  });
  assert.equal(automaticRequestResponse.status, 201);
  assert.equal((await automaticRequestResponse.json()).request.status, "approved", "automatic approval is applied immediately");
  const automaticCourseCheck = await fetch(`${server.baseUrl}/api/courses/${automaticCourse.id}`, { headers: { cookie: studentCookie } });
  assert.equal((await automaticCourseCheck.json()).course.enrolled, true, "free course auto approval enrolls the student immediately");

  const createLesson = await fetch(`${server.baseUrl}/api/courses/${courseData.course.id}/lessons`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "Smoke Lesson", videoUrl: "https://youtu.be/dQw4w9WgXcQ", questions: [{ question: "One plus one?", options: ["2", "3"], answer: 0 }, { question: "Two plus two?", options: ["4", "5"], answer: 0 }] }),
  });
  assert.equal(createLesson.status, 201, "admin can add a lesson");
  const lesson = (await createLesson.json()).lesson;
  const lessonList = await fetch(`${server.baseUrl}/api/courses/${courseData.course.id}/lessons`, { headers: { cookie: studentCookie } });
  const studentLessons = (await lessonList.json()).lessons;
  assert.equal(studentLessons.length, 1);
  assert.equal(studentLessons[0].videoUrl, undefined, "lesson list does not reveal a direct media URL");
  const studentLessonResponse = await fetch(`${server.baseUrl}/api/lessons/${lesson.id}`, { headers: { cookie: studentCookie } });
  const studentLesson = (await studentLessonResponse.json()).lesson;
  assert.equal(studentLesson.questions.length, 2, "student can view lesson quiz questions");
  assert.equal(studentLesson.questions[0].answer, undefined, "lesson quiz hides correct answers from students");
  const incompleteLessonQuiz = await fetch(`${server.baseUrl}/api/lessons/${lesson.id}/answers`, {
    method: "POST", headers: { "content-type": "application/json", cookie: studentCookie }, body: JSON.stringify({ answers: [0] }),
  });
  assert.equal(incompleteLessonQuiz.status, 400, "lesson quiz refuses to return a score while answers are missing");
  const completeLessonQuiz = await fetch(`${server.baseUrl}/api/lessons/${lesson.id}/answers`, {
    method: "POST", headers: { "content-type": "application/json", cookie: studentCookie }, body: JSON.stringify({ answers: [0, 1] }),
  });
  assert.deepEqual(await completeLessonQuiz.json(), { score: 1, total: 2 }, "lesson quiz score appears only after every answer is submitted");
  const watch = await fetch(`${server.baseUrl}/api/lessons/${lesson.id}/watch`, { method: "POST", headers: { cookie: studentCookie } });
  assert.equal(watch.status, 200, "enrolled student can start a lesson");

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const imageUpload = await fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-kind": "course-cover", cookie },
    body: JSON.stringify({ kind: "course-cover", fileName: "course-cover.png", dataUrl: `data:image/png;base64,${pngSignature.toString("base64")}` }),
  });
  assert.equal(imageUpload.status, 201, await imageUpload.clone().text());
  const courseCover = (await imageUpload.json()).url;
  const chatImageUpload = await fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-kind": "chat-image", cookie: studentCookie },
    body: JSON.stringify({ kind: "chat-image", fileName: "chat.png", dataUrl: `data:image/png;base64,${pngSignature.toString("base64")}` }),
  });
  assert.equal(chatImageUpload.status, 201, "student can upload a supported chat image");
  const chatImageUrl = (await chatImageUpload.json()).url;
  const groupMessage = await fetch(`${server.baseUrl}/api/chat/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: studentCookie },
    body: JSON.stringify({ text: "Image for first secondary", attachment: { type: "image", url: chatImageUrl } }),
  });
  assert.equal(groupMessage.status, 201, "student can post an attachment in their own grade group");
  assert.equal((await fetch(`${server.baseUrl}${chatImageUrl}`, { headers: { cookie: studentCookie } })).status, 200, "same-grade student can open the group attachment");
  const otherGradeRegister = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Other Grade Student", email: "other-grade@example.test", password: "Student-Smoke-42!", grade: "second-secondary", phone: "01012345678" }),
  });
  assert.equal(otherGradeRegister.status, 201);
  const otherGradeCookie = otherGradeRegister.headers.get("set-cookie")?.split(";", 1)[0];
  assert.equal((await fetch(`${server.baseUrl}${chatImageUrl}`, { headers: { cookie: otherGradeCookie } })).status, 404, "a different-grade student cannot open a group attachment by URL");
  const updateCourseCover = await fetch(`${server.baseUrl}/api/courses/${courseData.course.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ cover: courseCover }),
  });
  assert.equal(updateCourseCover.status, 200, "uploaded image can be saved as a course cover");
  const publicCourseCover = await fetch(`${server.baseUrl}${courseCover}`);
  assert.equal(publicCourseCover.status, 200, "published course cover can be displayed without a student session");
  const questionImageUpload = await fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-kind": "question-image", cookie },
    body: JSON.stringify({ kind: "question-image", fileName: "question.png", dataUrl: `data:image/png;base64,${pngSignature.toString("base64")}` }),
  });
  assert.equal(questionImageUpload.status, 201);
  const questionImage = (await questionImageUpload.json()).url;
  const createExam = await fetch(`${server.baseUrl}/api/courses/${courseData.course.id}/exams`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "Smoke Exam", questions: [{ prompt: "One plus one?", imageUrl: questionImage, options: ["2", "3"], answerIndex: 0 }] }),
  });
  assert.equal(createExam.status, 201, "admin can create an exam");
  const exam = (await createExam.json()).exam;
  const studentExamResponse = await fetch(`${server.baseUrl}/api/exams?course=${encodeURIComponent(courseData.course.id)}`, { headers: { cookie: studentCookie } });
  const studentExam = (await studentExamResponse.json()).exams[0];
  assert.equal(studentExam.questions[0].answerIndex, undefined, "student exam payload hides the answer key");
  const submitExam = await fetch(`${server.baseUrl}/api/exams/${exam.id}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: studentCookie },
    body: JSON.stringify({ answers: [0] }),
  });
  assert.deepEqual(await submitExam.json(), { score: 1, total: 1 }, "exam answer is scored correctly");

  const goodPdf = Buffer.from("%PDF-1.7\nsmoke test\n%%EOF", "ascii");
  const upload = await fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-kind": "pdf", cookie },
    body: JSON.stringify({ kind: "pdf", fileName: "smoke.pdf", dataUrl: `data:application/pdf;base64,${goodPdf.toString("base64")}` }),
  });
  assert.equal(upload.status, 201, "valid PDF signature is accepted");
  const uploaded = await upload.json();
  assert.match(uploaded.url, /^\/uploads\/[0-9a-f-]{36}\.pdf$/);
  assert.equal((await fs.stat(path.join(uploadDir, path.basename(uploaded.url)))).size, goodPdf.length);

  const spoofed = await fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-kind": "pdf", cookie },
    body: JSON.stringify({ kind: "pdf", fileName: "fake.pdf", dataUrl: `data:application/pdf;base64,${Buffer.from("not a PDF").toString("base64")}` }),
  });
  assert.equal(spoofed.status, 400, "content with a spoofed MIME type is rejected");

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const failedLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "release-check@example.test", password: "wrong-password" }),
    });
    assert.equal(failedLogin.status, 401, `login attempt ${attempt + 2} remains under the rate limit`);
  }
  const blocked = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "release-check@example.test", password: "wrong-password" }),
  });
  assert.equal(blocked.status, 429, "the next attempt is rate limited");
  await server.stop();
  assert.ok(!server.getOutput().includes(secretQuery), "request query token is absent from server logs");

  server = await launchServer(port, dataDir, uploadDir);
  const afterRestart = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "release-check@example.test", password: "wrong-password" }),
  });
  assert.equal(afterRestart.status, 429, "rate limit remains active after restarting the server");
});

test("required malware scanning fails closed when ClamAV is unavailable", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ameen-av-smoke-"));
  const dataDir = path.join(tempRoot, "data");
  const uploadDir = path.join(tempRoot, "uploads");
  const port = await availablePort();
  const missingScanner = path.join(tempRoot, "missing-clamscan");
  const server = await launchServer(port, dataDir, uploadDir, { AV_SCAN_REQUIRED: "true", CLAMSCAN_PATH: missingScanner });
  t.after(async () => {
    await server.stop().catch(() => {});
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const login = await fetch(`${server.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "release-check@example.test", password: "Release-Smoke-Only-42!" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  const pdf = Buffer.from("%PDF-1.7\nclean test\n%%EOF", "ascii");
  const upload = await fetch(`${server.baseUrl}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-upload-kind": "pdf", cookie },
    body: JSON.stringify({ kind: "pdf", fileName: "smoke.pdf", dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}` }),
  });
  assert.equal(upload.status, 503, "an unavailable required scanner rejects the upload");
  assert.match((await upload.json()).error, /لم يتم حفظه/);
  assert.deepEqual(await fs.readdir(uploadDir), [], "unscanned files are not left in uploads");
});

test("port conflicts exit with a clear diagnostic", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ameen-port-smoke-"));
  const listener = createServer();
  const port = await availablePort();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(port, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => listener.close(resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  const child = spawn(process.execPath, [path.join(projectRoot, "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", PORT: String(port), AMEEN_DATA_DIR: path.join(tempRoot, "data"), AMEEN_UPLOAD_DIR: path.join(tempRoot, "uploads"), SESSION_SECRET: "port-smoke-session-secret-48-characters-long", ADMIN_PASSWORD: "Port-Smoke-Only-42!" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  const exitCode = await Promise.race([
    new Promise((resolve, reject) => { child.once("exit", (code) => resolve(code)); child.once("error", reject); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Server did not exit on port conflict. ${output}`)), 5_000)),
  ]);
  assert.equal(exitCode, 1);
  assert.match(output, /Port .* is already in use/);
});

/** @format */

const PAGE = typeof location !== "undefined" ? (location.pathname.split("/").pop() || "index.html") : "index.html";

// Apply Bootstrap's form controls to the existing platform fields while
// keeping the platform's own visual theme as the final stylesheet override.
document.querySelectorAll(".field input:not([type=checkbox]):not([type=radio]), .field textarea").forEach((field) => field.classList.add("form-control"));
document.querySelectorAll(".field select").forEach((field) => field.classList.add("form-select"));

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const apiEnabled = location.protocol === "http:" || location.protocol === "https:";
const storage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return fallback;
      try { return JSON.parse(value); } catch { return value; }
    } catch { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {}
  },
};
async function apiRequest(route, options = {}) {
  const apiPath = route.startsWith("/api/") ? route : `/api${route.startsWith("/") ? route : `/${route}`}`;
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(apiPath, { ...options, headers, credentials: "same-origin" });
  } catch {
    throw new Error("تعذر الاتصال بخادم المنصة. شغّل run-local-server.bat واترك نافذته مفتوحة، ثم أعد المحاولة.");
  }
  let result = {};
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 405) throw new Error(`أنت تتصفح الموقع عبر خادم ملفات ثابتة. افتح رابط خادم المنصة: ${location.origin}`);
    if (result.error === "نوع الملف غير صالح.") throw new Error("الخادم المفتوح يعمل بنسخة قديمة لا تدعم نوع هذا المرفق. أوقفه وشغّل run-local-server.bat من جديد.");
    throw new Error(result.error || `تعذر إكمال الطلب (${response.status}).`);
  }
  return result;
}
let toggle = $(".menu-toggle");
const nav = $(".nav-links");
if (nav && !nav.id) nav.id = "primaryNavigation";
if (nav && !nav.getAttribute("aria-label")) nav.setAttribute("aria-label", "القائمة الرئيسية");
if (toggle && nav) toggle.setAttribute("aria-controls", nav.id);
if (nav && !toggle) {
  toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "menu-toggle";
  toggle.setAttribute("aria-label", "فتح القائمة");
  toggle.setAttribute("aria-expanded", "false");
  nav.parentElement.insertBefore(toggle, nav);
}
if (nav && !$('a[href="chat.html"]', nav)) {
  const chatLink = document.createElement("a");
  chatLink.href = "chat.html";
  chatLink.dataset.nav = "chat.html";
  chatLink.textContent = "الشات الجماعي";
  nav.appendChild(chatLink);
}
if (nav && !$('a[href="messages.html"]', nav)) {
  const messagesLink = document.createElement("a");
  messagesLink.href = "messages.html";
  messagesLink.dataset.nav = "messages.html";
  messagesLink.textContent = "الرسائل الخاصة";
  nav.appendChild(messagesLink);
}
// Keep account access in the menu opened by the hamburger, not in the mobile action row.
if (nav) {
  const header = nav.closest(".nav");
  $$(".nav-actions a.btn", header || document).forEach((link) => {
    const path = new URL(link.href, location.href).pathname.split("/").pop();
    if (["login.html", "profile.html"].includes(path)) {
      link.remove();
      return;
    }
    link.classList.remove("btn", "btn-primary", "btn-secondary");
    link.classList.add("nav-action-link");
    nav.appendChild(link);
  });
}
if (nav && !$('.nav-account-link', nav)) {
  const accountLink = document.createElement("a");
  const accountUser = storage.get("ameen-session", null);
  const isSignedIn = Boolean(accountUser && storage.get("ameen-token", ""));
  accountLink.className = "nav-account-link";
  accountLink.href = isSignedIn ? dashboardFor(accountUser.role) : "login.html";
  accountLink.dataset.nav = accountLink.href;
  accountLink.textContent = "حسابي";
  accountLink.setAttribute("aria-label", "حسابي");
  nav.appendChild(accountLink);
  $$('.nav-actions a[href="login.html"], .nav-actions a[href="profile.html"]', nav.closest(".nav") || document).forEach((link) => link.remove());
}
if (nav) {
  const primaryItems = [
    ["index.html", "الرئيسية"],
    ["courses.html", "الكورسات"],
    ["lessons.html", "المحاضرات"],
    ["exams.html", "الامتحانات"],
    ["about.html", "من نحن"],
    ["contact.html", "تواصل معنا"],
    ["chat.html", "الشات الجماعي"],
    ["messages.html", "الرسائل الخاصة"],
  ];
  const getPage = (link) => new URL(link.href, location.href).pathname.split("/").pop();
  primaryItems.forEach(([href, label]) => {
    let link = [...nav.querySelectorAll("a")].find((item) => getPage(item) === href);
    if (!link) {
      link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      nav.appendChild(link);
    }
    link.dataset.nav = href;
  });
  const coreLinks = primaryItems.map(([href]) => [...nav.querySelectorAll("a")].find((item) => getPage(item) === href));
  const accountLink = $(".nav-account-link", nav);
  const coreSet = new Set([...coreLinks, accountLink].filter(Boolean));
  const extraLinks = [...nav.querySelectorAll("a")].filter((link) => !coreSet.has(link));
  [...coreLinks, accountLink, ...extraLinks].filter(Boolean).forEach((link) => nav.appendChild(link));
}
if (toggle && nav)
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

const year = $("#year");
if (year) year.textContent = new Date().getFullYear();

const search = $("#courseSearch");
const category = $("#courseGradeFilter");
function filterCourses() {
  const cards = $$(".course-card[data-course]");
  if (!cards.length) return;
  const term = (search?.value || "").trim().toLowerCase();
  const grade = category?.value || "all";
  let shown = 0;
  cards.forEach((card) => {
    const matchesTerm = card.textContent.toLowerCase().includes(term);
    const matchesGrade = grade === "all" || card.dataset.grade === grade || card.dataset.grade === "secondary";
    const visible = matchesTerm && matchesGrade;
    card.hidden = !visible;
    if (visible) shown++;
  });
  const empty = $("#emptyState");
  if (empty) empty.style.display = shown ? "none" : "block";
}
search?.addEventListener("input", filterCourses);
category?.addEventListener("change", filterCourses);

/* ===== خلفية المعادلات الفيزيائية المتحركة ===== */
const PHYSICS_EQS = [
  "E = mc²",
  "F = m·a",
  "V = I·R",
  "λ = v / f",
  "P = V·I",
  "W = F·d",
  "KE = ½mv²",
  "Q = m·c·ΔT",
  "a = Δv / t",
  "Δx = v₀t + ½at²",
  "Fg = G·m₁m₂ / r²",
  "p = m·v",
];
function buildPhysicsBg() {
  const bg = document.createElement("div");
  bg.className = "physics-bg";
  bg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.textContent = PHYSICS_EQS[i % PHYSICS_EQS.length];
    s.style.left = Math.random() * 92 + "%";
    s.style.fontSize = 16 + Math.random() * 24 + "px";
    const dur = 34 + Math.random() * 32;
    s.style.animationDuration = dur + "s";
    s.style.animationDelay = -Math.random() * dur + "s";
    bg.appendChild(s);
  }
  document.body.appendChild(bg);
}
buildPhysicsBg();

/* ===== قاموس الترجمة (عربي  إنجليزي) ===== */
const I18N = {
  "مستر حسام أمين": "Mr. Hossam Amin",
  "حسام أمين": "Hossam Amin",
  "معلّم المادة": "Physics Teacher",
  "بوابتك للتفوق": "Your Gateway to Excellence",
  "مستر حسام أمين — جميع الحقوق محفوظة":
    "Mr. Hossam Amin — All Rights Reserved",
  الرئيسية: "Home",
  الكورسات: "Courses",
  المحاضرات: "Lectures",
  الامتحانات: "Exams",
  "من نحن": "About Us",
  "تواصل معنا": "Contact Us",
  "دخول الطلاب": "Student Login",
  "دخول الطلاب ": "Student Login ",
  "عن المنصة": "About the Platform",
  "فتح القائمة": "Open menu",
  "حسابي": "My Account",
  "تغيير اللغة": "Change language",
  "الوضع الليلي": "Dark mode",
  "/ الكورسات": "/ Courses",
  "/ المحاضرات": "/ Lectures",
  "/ الامتحانات": "/ Exams",
  "/ من نحن": "/ About Us",
  "/ تواصل معنا": "/ Contact Us",
  "/ دخول الطلاب": "/ Student Login",
  "/ إنشاء حساب": "/ Sign Up",
  "/ تفاصيل الكورس": "/ Course Details",
  "✦ رحلة تعليمية تفاعلية": "✦ Interactive Learning Journey",
  "افهم الفيزياء...": "Understand Physics...",
  "ومتخليهاش حمل عليك!": "Don't Let It Weigh You Down!",
  "رحلة تعليمية شيقة وتفاعلية مع مستر حسام أمين. نبسّط المعلومة ونخليك تستنتجها بنفسك، عشان تفهم صح وتستعد للدرجة النهائية في الثانوية.":
    "An engaging, interactive learning journey with Mr. Hossam Amin. We simplify every concept so you can figure it out yourself — understand it right and aim for full marks in secondary school.",
  "🖉 استكشف الكورسات": "🖉 Explore Courses",
  "⚙ تعرّف على منهجنا": "⚙ Discover Our Method",
  "شرح مبسط · تدريبات عملية · متابعة مستمرة":
    "Simple Explanation · Practical Exercises · Continuous Follow-up",
  "✦ البوابة التعليمية": "✦ Learning Portal",
  "افهمها مع أمين": "Learn It with Amin",
  "⚡ قانون السرعة": "⚡ Speed Law",
  "🧲 قانون نيوتن للحركة": "🧲 Newton's Law",
  القوة: "Force",
  التسارع: "Acceleration",
  "واجبات وتدريبات": "Assignments & Drills",
  "محاضرة تعليمية": "Lectures",
  "امتحانات شاملة مكتملة": "Comprehensive Exams",
  "ابدأ من هنا": "Start Here",
  "كورسات تساعدك تتفوق": "Courses That Help You Excel",
  "محتوى منظم من الأساسيات لحد حل أصعب الأسئلة.":
    "Organized content from the basics all the way to solving the toughest questions.",
  "عرض كل الكورسات ": "View All Courses ",
  "الأكثر طلبًا": "Most Popular",
  "شرح وتطبيق": "Explanation & Practice",
  "مراجعة شاملة": "Full Review",
  "شرح مبسط": "Simplified",
  تدريبات: "Practice",
  امتحانات: "Exams",
  "📚 9 دروس": "📚 9 Lessons",
  "الصف الأول الثانوي": "First Secondary Grade",
  الثانوي: "Secondary",
  الإعدادي: "Prep Stage",
  "تفاصيل الكورس ": "Course Details ",
  "عرض التفاصيل ": "View Details ",
  "ابدأ التدريب ": "Start Practice ",
  "ليه تتعلم معانا؟": "Why Learn With Us?",
  "التعليم أبسط لما تفهمه صح":
    "Learning Is Easier When You Understand It Right",
  "منهج واضح يساعدك تتعلم خطوة بخطوة وتتابع تقدمك بثقة.":
    "A clear curriculum that helps you learn step by step and track your progress with confidence.",
  "شرح تفاعلي": "Interactive Explanation",
  "افهم الفكرة من جذورها من خلال أمثلة وتطبيقات عملية.":
    "Understand the idea from its roots through examples and real applications.",
  "تدريبات بعد كل درس": "Exercises After Every Lesson",
  "اختبر فهمك واكتشف النقاط التي تحتاج إلى مراجعة.":
    "Test your understanding and discover what needs review.",
  "مراجعات منظمة": "Organized Reviews",
  "رتّب مذاكرتك واستعد للامتحان بخطة واضحة.":
    "Organize your study and get exam-ready with a clear plan.",
  "جاهز تبدأ رحلتك؟": "Ready to Start Your Journey?",
  "اختار الكورس المناسب ليك وخلي كل درس خطوة ناحية التفوق.":
    "Pick the right course for you and make every lesson a step toward success.",
  "اختار كورسك الآن ": "Choose Your Course Now ",
  "أضف رابط واتساب أو خدمة المحادثة هنا":
    "Add your WhatsApp or chat service link here",
  "الكورسات التعليمية": "Educational Courses",
  "اختار المادة والمرحلة المناسبة ليك، وابدأ التعلّم بخطوات واضحة.":
    "Pick the subject and grade that fit you, and start learning with clear steps.",
  "ابحث عن كورس أو موضوع...": "Search for a course or topic...",
  "كل المراحل": "All Grades",
  "الحركة، القوى، قوانين نيوتن، ومفاهيم الطاقة.":
    "Motion, forces, Newton's laws, and energy concepts.",
  "الشحنة، التيار، قانون أوم، والمجالات المغناطيسية.":
    "Charge, current, Ohm's law, and magnetic fields.",
  "مراجعة مركزة للمفاهيم الأساسية والتدريبات.":
    "Focused review of core concepts and practice.",
  "مفيش كورسات مطابقة لبحثك. جرّب كلمة تانية.":
    "No courses match your search. Try another keyword.",
  "محتاج مساعدة في اختيار الكورس؟": "Need Help Choosing a Course?",
  "ابعتلنا وساعدنا نوجّهك للمحتوى المناسب.":
    "Message us and we'll guide you to the right content.",
  "تواصل معنا ": "Contact Us ",
  "ماذا ستتعلم؟": "What Will You Learn?",
  "الحركة والإزاحة": "Motion & Displacement",
  "فهم السرعة والتسارع والإحداثيات":
    "Understand velocity, acceleration, and coordinates",
  "قوانين نيوتن": "Newton's Laws",
  "القوى وتأثيرها على الأجسام": "Forces and their effect on objects",
  "الشغل والطاقة": "Work & Energy",
  "الطاقة الحركية والكامنة بأمثلة بسيطة":
    "Kinetic and potential energy with simple examples",
  "تدريبات واختبارات": "Exercises & Quizzes",
  "أسئلة قصيرة لتثبيت الفهم": "Short questions to reinforce understanding",
  "مناسب للمبتدئين": "Beginner Friendly",
  "محتويات الكورس": "Course Contents",
  "12 درس تعليمي": "12 Lessons",
  "شرح خطوة بخطوة": "Step-by-step explanation",
  "4 مجموعات تدريبات": "4 Practice Sets",
  "تقييم بعد كل وحدة": "Assessment after each unit",
  "مراجعة نهائية": "Final Review",
  "تلخيص لأهم الأفكار": "Summary of the key ideas",
  "سجّل وابدأ التعلّم ": "Sign Up & Start Learning ",
  "هذه بيانات توضيحية قابلة للتعديل حسب محتوى الكورس الفعلي.":
    "This is sample data you can edit to match the actual course content.",
  "محتوى الكورس": "Course Content",
  "خطة الدروس": "Lesson Plan",
  "كل المحاضرات ": "All Lectures ",
  "12 دقيقة · مقدمة": "12 min · Intro",
  "18 دقيقة · الدرس الأول": "18 min · Lesson 1",
  "16 دقيقة · الدرس الثاني": "16 min · Lesson 2",
  عرض: "View",
  "ابدأ بفهم المفاهيم الأساسية للفيزياء، من الحركة والقوى إلى الشغل والطاقة، مع شرح مبسط وتدريبات بعد كل وحدة.":
    "Start with the core concepts of physics, from motion and forces to work and energy, with simple explanations and practice after each unit.",
  "المحاضرات والدروس": "Lectures & Lessons",
  "تابع الدروس بالترتيب، وارجع لأي محاضرة وقت ما تحتاج.":
    "Follow the lessons in order, and revisit any lecture anytime.",
  "شاهد ": "Watch ",
  "نصيحة للمذاكرة": "Study Tip",
  "اتعلم بتركيز": "Learn with Focus",
  "شاهد الدرس، دوّن أهم الأفكار، وبعدها حل التدريب المرتبط به. الاستمرار أهم من المذاكرة لساعات طويلة مرة واحدة.":
    "Watch the lesson, note the key ideas, then solve the related exercise. Consistency matters more than one long study session.",
  "تصفّح الكورسات": "Browse Courses",
  "ملخص الدرس": "Lesson Summary",
  " حفظ الدرس": " Save Lesson",
  "دروس الكورس": "Course Lessons",
  "اختبر فهمك ": "Test Yourself ",
  "الامتحانات والتدريبات": "Exams & Practice",
  "درّب نفسك بعد كل وحدة، وتابع مستوى فهمك قبل الامتحان.":
    "Train yourself after each unit, and track your understanding before the exam.",
  "10 أسئلة": "10 Questions",
  "15 سؤال": "15 Questions",
  "20 سؤال": "20 Questions",
  "راجع المفاهيم الرئيسية في الحركة والقوى والطاقة.":
    "Review the key concepts of motion, forces, and energy.",
  "اختبر فهمك للتيار وقانون أوم والدارات البسيطة.":
    "Test your understanding of current, Ohm's law, and simple circuits.",
  "تدريب شامل يساعدك تراجع أهم الأفكار.":
    "Comprehensive practice to review the most important ideas.",
  "ابدأ الاختبار ": "Start Quiz ",
  "سيتم ربط الاختبار بنظام الأسئلة لاحقًا":
    "The quiz will be linked to the question system later",
  "راجع قبل ما تختبر نفسك": "Review Before You Test Yourself",
  "ارجع للمحاضرات لو محتاج تراجع أي نقطة.":
    "Go back to the lectures if you need to review anything.",
  "المحاضرات ": "Lectures ",
  "التعليم مش حفظ وبس — ": "Education Isn't Just Memorization — ",
  "التعليم فهم": "Education Is Understanding",
  "هدفنا نخلي الفيزياء أسهل وأقرب للطالب من خلال شرح واضح، أمثلة من الحياة اليومية، وتدريبات تقيس الفهم الحقيقي.":
    "Our goal is to make physics easier and closer to students through clear explanations, real-life examples, and exercises that measure true understanding.",
  رؤيتنا: "Our Vision",
  "كل طالب يقدر يفهم": "Every Student Can Understand",
  "بنؤمن إن الشرح الجيد يبدأ من تبسيط الفكرة، ثم ربطها بأمثلة عملية، وبعدها التدريب والتقييم. المنصة مصممة لتجمع الدروس والواجبات والامتحانات في مكان واحد.":
    "We believe good teaching starts by simplifying the idea, then connecting it to practical examples, followed by practice and assessment. The platform brings lessons, assignments, and exams together in one place.",
  بساطة: "Simplicity",
  "معلومة واضحة من غير تعقيد.": "Clear information without complication.",
  تطور: "Growth",
  "متابعة مستمرة للتقدم.": "Continuous progress tracking.",
  "واجهة تعليمية تجمع المحتوى المنظم والتدريب والمراجعة — عدّل هذه النبذة لتناسب المدرّس وخبراته الفعلية.":
    "An educational platform combining organized content, practice, and review — edit this bio to match the teacher's actual experience.",
  "تصفّح الكورسات ": "Browse Courses ",
  طريقتنا: "Our Method",
  "خطوات بسيطة لنتيجة أفضل": "Simple Steps for a Better Result",
  "افهم الفكرة": "Understand the Idea",
  "شاهد الشرح وركّز على الفكرة الأساسية.":
    "Watch the explanation and focus on the core idea.",
  "طبّق بنفسك": "Apply It Yourself",
  "حل الأسئلة وجرّب استخدام المعلومة.":
    "Solve questions and try using what you learned.",
  "راجع تقدمك": "Review Your Progress",
  "استخدم الاختبارات لتحديد ما تحتاج إلى مراجعته.":
    "Use quizzes to identify what you need to review.",
  "إحنا هنا عشان نساعدك": "We're Here to Help You",
  "عندك سؤال عن الكورسات أو محتاج مساعدة؟ ابعتلنا رسالتك.":
    "Have a question about the courses or need help? Send us your message.",
  "ابعت رسالتك": "Send Your Message",
  الاسم: "Name",
  "اكتب اسمك": "Type your name",
  "البريد الإلكتروني": "Email",
  "موضوع الرسالة": "Message Subject",
  "استفسار عن كورس": "Course Inquiry",
  "مشكلة تقنية": "Technical Issue",
  "استفسار عام": "General Inquiry",
  رسالتك: "Your Message",
  "اكتب تفاصيل استفسارك...": "Write your inquiry details...",
  "إرسال الرسالة ": "Send Message ",
  "تواصل مباشر": "Direct Contact",
  "خلينا نسمع منك": "Let's Hear From You",
  واتساب: "WhatsApp",
  "أضف رابط واتساب الرسمي هنا": "Add the official WhatsApp link here",
  "مواعيد الرد": "Response Time",
  "من السبت إلى الخميس": "Saturday to Thursday",
  "أهلًا بعودتك!": "Welcome Back!",
  "سجّل دخولك عشان تتابع الكورسات والمحاضرات.":
    "Log in to follow your courses and lectures.",
  "تم التحقق من النموذج شكليًا فقط. تسجيل الدخول الحقيقي يحتاج Backend.":
    "Form validated visually only. Real login requires a backend.",
  "كلمة المرور": "Password",
  "تسجيل الدخول ": "Log In ",
  "لسه معندكش حساب؟ ": "Don't have an account yet? ",
  "إنشاء حساب جديد": "Create a New Account",
  "ابدأ رحلتك التعليمية": "Start Your Learning Journey",
  "أنشئ حسابك عشان تتابع الدروس والواجبات في مكان واحد.":
    "Create your account to follow lessons and assignments in one place.",
  "تم التحقق من النموذج شكليًا فقط. إنشاء الحساب الحقيقي يحتاج Backend.":
    "Form validated visually only. Real signup requires a backend.",
  "الاسم بالكامل": "Full Name",
  "المرحلة الدراسية": "Grade",
  "اختر المرحلة": "Choose your grade",
  "الأول الثانوي": "First Secondary",
  "الثاني الثانوي": "Second Secondary",
  "الثالث الثانوي": "Third Secondary",
  "6 أحرف على الأقل": "At least 6 characters",
  "إنشاء الحساب ": "Sign Up ",
  "عندك حساب بالفعل؟ ": "Already have an account? ",
  "سجّل دخولك": "Log In",
  "الرئيسية | مستر حسام أمين": "Home | Mr. Hossam Amin",
  "الكورسات | مستر حسام أمين": "Courses | Mr. Hossam Amin",
  "تفاصيل الكورس | مستر حسام أمين": "Course Details | Mr. Hossam Amin",
  "المحاضرات | مستر حسام أمين": "Lectures | Mr. Hossam Amin",
  "مشاهدة الدرس | مستر حسام أمين": "Watch Lesson | Mr. Hossam Amin",
  "الامتحانات | مستر حسام أمين": "Exams | Mr. Hossam Amin",
  "من نحن | مستر حسام أمين": "About Us | Mr. Hossam Amin",
  "تواصل معنا | مستر حسام أمين": "Contact Us | Mr. Hossam Amin",
  "دخول الطلاب | مستر حسام أمين": "Student Login | Mr. Hossam Amin",
  "إنشاء حساب | مستر حسام أمين": "Sign Up | Mr. Hossam Amin",
  "إنشاء كورس | مستر حسام أمين": "Create Course | Mr. Hossam Amin",
  "الملف الشخصي | مستر حسام أمين": "Profile | Mr. Hossam Amin",
  "إدارة المنصة | مستر حسام أمين": "Admin Panel | Mr. Hossam Amin",
  "متابعة الطلاب | مستر حسام أمين": "Student Progress | Mr. Hossam Amin",
  "لوحة الطالب | مستر حسام أمين": "Student Dashboard | Mr. Hossam Amin",
  "لوحة المدرس | مستر حسام أمين": "Teacher Dashboard | Mr. Hossam Amin",
  "الإدارة": "Admin",
  "مستوى الطلاب": "Student Progress",
  "ملفي": "My Profile",
  "/ إنشاء كورس": "/ Create Course",
  "/ الملف الشخصي": "/ Profile",
  "/ الإدارة": "/ Admin",
  "/ الإدارة / متابعة الطلاب": "/ Admin / Student Progress",
  "/ لوحة الطالب": "/ Student Dashboard",
  "/ لوحة المدرس": "/ Teacher Dashboard",
  "إنشاء كورس جديد": "Create New Course",
  "أضف بيانات الكورس وصورته الرمزية ليظهر مباشرة في قائمة الكورسات.": "Add the course details and cover image and it appears right away in the course list.",
  "بيانات الكورس": "Course Details",
  "اسم الكورس": "Course Name",
  "وصف مختصر": "Short Description",
  "المرحلة": "Grade",
  "عدد الدروس": "Number of Lessons",
  "الصورة الرمزية للكورس": "Course Cover Image",
  "أو اختر أيقونة": "Or pick an icon",
  "⚛️ ذرة": "⚛️ Atom",
  "🧲 مغناطيس": "🧲 Magnet",
  "📐 هندسة": "📐 Geometry",
  "🔭 استكشاف": "🔭 Explore",
  "⚡ كهرباء": "⚡ Electricity",
  "نشر الكورس": "Publish Course",
  "معاينة": "Preview",
  "سيظهر وصف الكورس هنا.": "The course description will appear here.",
  "اكتب نبذة واضحة عن محتوى الكورس": "Write a clear note about the course content",
  "حدّث بياناتك وتابع آخر ما حفظته وأنجزته.": "Update your info and follow what you saved and accomplished.",
  "طالب المنصة": "Platform Student",
  "سجّل دخولك لتظهر بياناتك.": "Log in to see your data.",
  "حفظ التعديلات": "Save Changes",
  "تقدمك": "Your Progress",
  "الدروس المحفوظة": "Saved Lessons",
  "0 درس": "0 Lessons",
  "آخر اختبار": "Last Quiz",
  "لم تُجرِ اختبارًا بعد": "No quiz taken yet",
  "اذهب إلى الاختبارات": "Go to Quizzes",
  "لوحة إدارة المنصة": "Platform Admin Panel",
  "أدر المحتوى وتابع نشاط الطلاب من مكان واحد.": "Manage content and track student activity in one place.",
  "حسابات طلاب": "Student Accounts",
  "اختبارات منجزة": "Completed Quizzes",
  "أضف كورساً جديداً واختر له صورة رمزية.": "Add a new course with a cover image.",
  "راجع الحسابات ونتائج الاختبارات.": "Review accounts and quiz results.",
  "عرض الكورسات": "View Courses",
  "راجع ما يظهر للطلاب في صفحة الكورسات.": "Review what students see on the courses page.",
  "نظرة سريعة على التسجيلات ومستوى الإنجاز والاختبارات.": "A quick look at registrations, completion, and quizzes.",
  "متوسط آخر اختبار": "Last Quiz Average",
  "دروس محفوظة": "Saved Lessons",
  "سجل الطلاب": "Students Record",
  "تظهر هنا الحسابات المُنشأة من هذا المتصفح.": "Accounts created in this browser appear here.",
  "الحالة": "Status",
  "نشط": "Active",
  "أدخل كود الكورس الذي يرسله المدرس لتتمكن من مشاهدة الدروس وحل الأسئلة.": "Enter the course code from your teacher to watch lessons and answer questions.",
  "دخول كورس بالكود": "Join Course with Code",
  "معرّف الكورس": "Course ID",
  "كود الكورس": "Course Code",
  "دخول الكورس": "Join Course",
  "ماذا تستطيع؟": "What Can You Do?",
  "مشاهدة الفيديو بعد الدخول، فتح ملف PDF، وحل أسئلة الاختيار من متعدد. عدد المشاهدات يُحتسب من الخادم.": "Watch the video after joining, open the PDF, and answer multiple-choice questions. Views are counted by the server.",
  "أنشئ الكورسات وشارك كود كل كورس مع الطلاب، وأضف فيديو وPDF وأسئلة لكل درس.": "Create courses, share each course code with students, and add video, PDF, and questions per lesson.",
  "إنشاء ونشر المحتوى": "Create & Publish Content",
  "ملف مرافق لكل درس": "A File Attached to Each Lesson",
  "حد المشاهدة الافتراضي": "Default View Limit",
  "يظهر في رابط الكورس": "Shown in the course URL",
  "جاري تحميل الكورسات...": "Loading courses...",
  "لا توجد كورسات لمرحلتك حاليًا — ستظهر هنا فور نشرها من المدرس.": "No courses for your grade yet — they will appear here once your teacher publishes them.",
  "مستر حسام أمين": "Mr. Hossam Amin",
  "بوابتك للتفوق": "Your Path to Excellence",
  "دخول الطلاب ↗": "Student Login ↗",
  "التعليم مش حفظ وبس —": "Learning Is More Than Memorizing —",
  "تصفّح الكورسات ↗": "Browse Courses ↗",
  "كورسات منشورة": "Published Courses",
  "إنشاء كورس": "Create Course",
  "متابعة مستوى الطلاب": "Track Student Progress",
  "شهادة الإتمام | مستر حسام أمين": "Completion Certificate | Mr. Hossam Amin",
  "شهادة الإتمام": "Completion Certificate",
  "اختر كورساً مكتمل الدروس من رابط الشهادة في قائمة كورساتك.": "Choose a course with all lessons completed using the certificate link in your courses.",
  "لم يتم اختيار كورس بعد.": "No course selected yet.",
  "الشات العام | مستر حسام أمين": "Public Chat | Mr. Hossam Amin",
  "/ الشات العام": "/ Public Chat",
  "الشات العام": "Public Chat",
  "الشات الجماعي": "Group Chat",
  "الرسائل الخاصة": "Private Messages",
  "مساحة تجمع طلاب ومدرسي وإدارة المنصة. اكتب رسالة أو رد على رسالة أحد المشاركين.": "A shared space for students, teachers, and platform admins. Send a message or reply to another participant.",
  "محادثة المنصة": "Platform Chat",
  "جارٍ الاتصال...": "Connecting...",
  "عام": "Public",
  "تحميل رسائل أقدم": "Load Older Messages",
  "إلغاء الرد": "Cancel Reply",
  "إرفاق صورة": "Attach Image",
  "بدء التسجيل الصوتي": "Start Audio Recording",
  "إيقاف التسجيل": "Stop Recording",
  "تمييز الرسالة كسؤال": "Mark Message as a Question",
  "إرسال الرسالة ↗": "Send Message ↗",
  "إرسال الرسالة": "Send Message",
  "تواصل معنا ↗": "Contact Us ↗",
  "سجّل وابدأ التعلّم ↗": "Sign Up and Start Learning ↗",
  "كل المحاضرات ←": "All Lessons ←",
  "هندسة": "Geometry",
  "استكشاف": "Explore",
  "إضافة درس | مستر حسام أمين": "Add Lesson | Mr. Hossam Amin",
  "لوحة المدرس": "Teacher Dashboard",
  "لوحة المدرس / إضافة درس": "Teacher Dashboard / Add Lesson",
  "إضافة درس جديد": "Add a New Lesson",
  "ارفع فيديو وPDF إلى نفس سيرفر المنصة، ثم حدد عدد مرات المشاهدة المسموحة للطالب.": "Upload a video and PDF to the platform server, then set how many times the student may view them.",
  "عنوان الدرس": "Lesson Title",
  "فيديو الشرح (MP4 أو WebM، حتى 50 MB)": "Lesson Video (MP4 or WebM, up to 50 MB)",
  "ملف الشرح PDF (حتى 50 MB)": "Lesson PDF (up to 50 MB)",
  "عدد المشاهدات المسموحة": "Allowed Views",
  "رفع ونشر الدرس": "Upload and Publish Lesson",
  "3 أسئلة": "3 Questions",
  "ابدأ الاختبار ↗": "Start Quiz ↗",
  "المحاضرات ↗": "Lessons ↗",
  "استعادة كلمة المرور | مستر حسام أمين": "Password Recovery | Mr. Hossam Amin",
  "تسجيل الدخول": "Log In",
  "استعادة كلمة المرور": "Password Recovery",
  "أدخل بريدك، وسيصل طلبك إلى إدارة المنصة لإعادة تعيين كلمة مرور مؤقتة.": "Enter your email. Your request will be sent to the platform admin to reset your password.",
  "إرسال الطلب": "Send Request",
  "العودة لتسجيل الدخول": "Back to Log In",
  "معلّم المادة حسام أمين": "Your Teacher, Hossam Amin",
  "عرض كل الكورسات": "View All Courses",
  "اختار كورسك الآن ↗": "Choose Your Course Now ↗",
  "حفظ الدرس": "Save Lesson",
  "تسجيل الدخول ↗": "Log In ↗",
  "نسيت كلمة المرور؟": "Forgot Password?",
  "لسه معندكش حساب؟": "Don't have an account yet?",
  "الرسائل الخاصة | مستر حسام أمين": "Private Messages | Mr. Hossam Amin",
  "/ الرسائل الخاصة": "/ Private Messages",
  "الرسائل الخاصة": "Private Messages",
  "تواصل مباشرة مع أي حساب مسجل في المنصة.": "Message any account registered on the platform directly.",
  "بحث عن حساب": "Search for an Account",
  "اختر حسابًا لبدء المحادثة": "Choose an account to start a conversation",
  "الملف الشخصي": "Profile",
  "لوحة الطالب": "Student Dashboard",
  "إنشاء الحساب ↗": "Create Account ↗",
  "عندك حساب بالفعل؟": "Already have an account?",
  "طلبات الطلاب": "Student Requests",
  "كورس": "Course",
  "إنشاء كورس جديد ↗": "Create a New Course ↗",
  "طلبات الالتحاق بالكورسات": "Course Enrollment Requests",
  "طالب": "Student",
  "طلاب مسجلون": "Registered Students",
  "الطالب": "Student",
  "مستر حسام أمين — جميع الحقوق محفوظة": "Mr. Hossam Amin — All Rights Reserved",
};
Object.assign(I18N, {
  "امتحانات الكورسات": "Course Exams", "كورسات منشورة": "Published Courses", "محاضرات متاحة": "Available Lessons", "امتحانات منشورة": "Published Exams", "اختر إجابة واحدة لكل سؤال. تظهر الامتحانات التي أضافها مدرس الكورس.": "Choose one answer for each question. Exams are added by the course instructor.",
  "امتحانات الكورس": "Course Exams", "محاضرات الكورس": "Course Lessons", "التحاق بالكورس": "Join Course", "إدارة الامتحانات": "Manage Exams", "إضافة محاضرة": "Add Lesson", "تعديل بيانات الكورس": "Edit Course Details",
  "لا توجد محاضرات مضافة لهذا الكورس حتى الآن.": "No lessons have been added to this course yet.", "لا توجد محاضرات متاحة في هذا الكورس بعد.": "No lessons are available in this course yet.", "لا توجد امتحانات منشورة لهذا الكورس حتى الآن.": "No exams have been published for this course yet.",
  "أنشئ الكورس ثم أضف محاضرات الفيديو وملفات PDF والامتحانات.": "Create a course, then add video lessons, PDF files, and exams.", "إدارة الكورسات": "Manage Courses", "كورساتي": "My Courses", "اسم الكورس": "Course Name", "وصف الكورس": "Course Description", "المرحلة": "Grade Level", "أيقونة الكورس (اختياري)": "Course Icon (optional)", "إدارة المحاضرات": "Manage Lessons", "تعديل درس موجود": "Edit an Existing Lesson", "إضافة محاضرة جديدة": "Add a New Lesson", "عنوان الدرس": "Lesson Title", "فيديو الشرح (MP4 أو WebM، حتى 50 MB)": "Lesson Video (MP4 or WebM, up to 50 MB)", "ملف PDF (حتى 50 MB)": "PDF File (up to 50 MB)", "ملف PDF اختياري (حتى 50 MB)": "Optional PDF file (up to 50 MB)", "عدد مرات المشاهدة": "Allowed Views", "للمشتركين في الكورس": "Enrolled Students", "درس مجاني": "Free Lesson", "حفظ المحاضرة": "Save Lesson", "حذف المحاضرة": "Delete Lesson", "اترك خانة الملف فارغة للاحتفاظ بالملف الحالي.": "Leave a file field empty to keep its current file.", "تم حفظ المحاضرة بنجاح.": "Lesson saved successfully.", "أرفق فيديو وملف PDF للمحاضرة الجديدة.": "Attach a video and PDF for the new lesson.", "أدخل رابط فيديو صالحًا أو ارفع ملف فيديو للمحاضرة.": "Enter a valid video link or upload a video for the lesson.",
  "صورة السؤال (مطلوبة)": "Question Image (required)", "نص السؤال": "Question Text", "الإجابة الصحيحة": "Correct Answer", "إنشاء امتحان": "Create Exam", "تعديل الامتحان": "Edit Exam", "إضافة سؤال": "Add Question", "حفظ الامتحان": "Save Exam", "إلغاء التعديل": "Cancel Edit", "إرسال الإجابات": "Submit Answers", "ابدأ الامتحان": "Start Exam", "امتحان": "Exam", "السؤال ": "Question ", "صورة السؤال": "Question Image", "تم حفظ الامتحان.": "Exam saved.", "تم حذف هذه المحاضرة.": "Lesson deleted.", "هل تريد حذف هذه المحاضرة؟": "Delete this lesson?", "هل تريد حذف هذا الامتحان؟": "Delete this exam?", "فتح ملف PDF": "Open PDF", "المشاهدات المتبقية: ": "Views remaining: "
});let currentLang = "ar";
let arTitle = null;
const I18N_EN_TO_AR = {};
Object.entries(I18N).forEach(([ar, en]) => {
  if (Object.prototype.hasOwnProperty.call(I18N_EN_TO_AR, en))
    I18N_EN_TO_AR[en] = null;
  else I18N_EN_TO_AR[en] = ar;
});
const T = (arText) =>
  currentLang === "en" ? I18N[arText.trim()] || arText : arText;

function translateTextNode(node, lang) {
  if (!node.nodeValue || !node.nodeValue.trim()) return;
  const parent = node.parentElement;
  if (!parent || parent.closest("script,style,.physics-bg,#toast,.notice")) return;
  if (lang === "en") {
    if (node.__ar === undefined) {
      const t = node.nodeValue.trim();
      node.__ar = node.nodeValue.replace(t, I18N_EN_TO_AR[t] || t);
    }
    const t = node.nodeValue.trim();
    if (I18N[t]) node.nodeValue = node.nodeValue.replace(t, I18N[t]);
  } else if (node.__ar !== undefined) {
    node.nodeValue = node.__ar;
  }
}
function translateTextNodes(lang, root = document.body) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root, lang);
    return;
  }
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim())
          return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (
          !parent ||
          parent.closest("script,style,.physics-bg,#toast,.notice")
        )
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  let node;
  while ((node = walker.nextNode())) translateTextNode(node, lang);
}
function translateAttributes(lang, root = document.body) {
  ["placeholder", "data-toast", "data-success", "aria-label", "title"].forEach(
    (attr) => {
      const selector = "[" + attr + "]";
      const elements = [
        ...(root.matches?.(selector) ? [root] : []),
        ...root.querySelectorAll(selector),
      ];
      elements.forEach((el) => {
        const v = el.getAttribute(attr);
        if (!v || !v.trim()) return;
        if (lang === "en") {
          if (el.__arAttrs === undefined) el.__arAttrs = {};
          if (el.__arAttrs[attr] === undefined) {
            const t = v.trim();
            el.__arAttrs[attr] = v.replace(t, I18N_EN_TO_AR[t] || t);
          }
          const t = v.trim();
          if (I18N[t]) el.setAttribute(attr, v.replace(t, I18N[t]));
        } else if (el.__arAttrs && el.__arAttrs[attr] !== undefined) {
          if (v !== el.__arAttrs[attr]) el.setAttribute(attr, el.__arAttrs[attr]);
        }
      });
    },
  );
}
const langToggle = $("#langToggle");
function applyLang(lang) {
  currentLang = lang;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === "ar" ? "rtl" : "ltr";
  document.body.classList.toggle("en", lang === "en");
  if (arTitle === null) arTitle = document.title;
  translateTextNodes(lang);
  translateAttributes(lang);
  if (lang === "en") {
    if (I18N[arTitle.trim()]) document.title = I18N[arTitle.trim()];
  } else {
    document.title = arTitle;
  }
  if (langToggle) langToggle.textContent = lang === "ar" ? "EN" : "ع";
  try {
    localStorage.setItem("ameen-lang", lang);
  } catch (e) {}
}
const languageObserver = new MutationObserver((records) => {
  records.forEach((record) => {
    if (record.type === "attributes") {
      translateAttributes(currentLang, record.target);
      return;
    }
    record.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.ELEMENT_NODE)
        return;
      translateTextNodes(currentLang, node);
      if (node.nodeType === Node.ELEMENT_NODE)
        translateAttributes(currentLang, node);
    });
  });
});
languageObserver.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["placeholder", "data-toast", "data-success", "aria-label", "title"],
});
const savedLang = (() => {
  try {
    return localStorage.getItem("ameen-lang");
  } catch (e) {
    return null;
  }
})();
applyLang(savedLang === "en" ? "en" : "ar");
langToggle?.addEventListener("click", () =>
  applyLang(currentLang === "ar" ? "en" : "ar"),
);

/* ===== الوضع الليلي ===== */
const darkToggle = $("#darkToggle");
function applyDark(on) {
  document.body.classList.toggle("dark", on);
  if (darkToggle) darkToggle.textContent = on ? "☀" : "☾";
  try {
    localStorage.setItem("ameen-dark", on ? "1" : "0");
  } catch (e) {}
}
let savedDark = null;
try {
  savedDark = localStorage.getItem("ameen-dark");
} catch (e) {}
applyDark(
  savedDark === null ?
    matchMedia("(prefers-color-scheme: dark)").matches
  : savedDark === "1",
);
darkToggle?.addEventListener("click", () =>
  applyDark(!document.body.classList.contains("dark")),
);

function dashboardFor(role) {
  if (role === "admin") return "admin.html";
  if (role === "teacher") return "teacher-dashboard.html";
  return "student-dashboard.html";
}

// Public pages used to keep showing the "student login" button after login.
// That made navigation look like the session had been lost, even though the
// authenticated cookie and account were still active.
const signedInUser = storage.get("ameen-session", null);
if (signedInUser && storage.get("ameen-token", "")) {
  $$('a[href="login.html"]').forEach((link) => {
    link.href = dashboardFor(signedInUser.role);
    link.textContent = link.closest(".footer-links") ? "لوحة التحكم" : "حسابي ↗";
    link.setAttribute("aria-label", "فتح لوحة التحكم");
  });
}

function setupNotifications() {
  if (!signedInUser || !storage.get("ameen-token", "")) return;
  const actions = $(".nav-actions");
  if (!actions || $("#notificationCenter")) return;
  const center = document.createElement("div");
  center.id = "notificationCenter";
  center.className = "notification-center";
  center.innerHTML = `<button type="button" class="icon-btn notification-toggle" id="notificationToggle" aria-label="الإشعارات" aria-expanded="false" aria-controls="notificationPanel"><svg class="notification-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notification-badge" id="notificationBadge" hidden></span></button><section class="notification-panel" id="notificationPanel" aria-label="الإشعارات" hidden><div class="notification-panel-head"><b>${currentLang === "en" ? "Notifications" : "الإشعارات"}</b><div class="notification-panel-actions"><button type="button" class="text-action" id="notificationReadAll">${currentLang === "en" ? "Mark all read" : "تحديد الكل كمقروء"}</button><button type="button" class="text-action notification-clear" id="notificationClearAll">${currentLang === "en" ? "Delete all" : "حذف الكل"}</button></div></div><div class="notification-list" id="notificationList" aria-live="polite"></div></section>`;
  actions.prepend(center);
  const toggle = $("#notificationToggle", center), panel = $("#notificationPanel", center), list = $("#notificationList", center), badge = $("#notificationBadge", center);
  let notifications = [];
  const refresh = async () => {
    try {
      const result = await apiRequest("/notifications");
      notifications = result.notifications || [];
      badge.textContent = result.unread > 99 ? "99+" : String(result.unread || "");
      badge.hidden = !result.unread;
      list.replaceChildren();
      if (!notifications.length) {
        const empty = document.createElement("p");
        empty.className = "notification-empty";
        empty.textContent = currentLang === "en" ? "No notifications yet." : "لا توجد إشعارات حتى الآن.";
        list.append(empty);
        return;
      }
      notifications.forEach((item) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = `notification-item${item.read ? " is-read" : ""}`;
        const title = document.createElement("b"), message = document.createElement("span"), date = document.createElement("small");
        title.textContent = item.title || (currentLang === "en" ? "Notification" : "إشعار");
        message.textContent = item.message || "";
        date.textContent = timeAgo(item.createdAt);
        row.append(title, message, date);
        row.addEventListener("click", async () => {
          try { if (!item.read) await apiRequest(`/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" }); } catch {}
          const target = item.link ? new URL(item.link, location.href) : null;
          if (target && target.origin === location.origin) location.href = target.href;
          else await refresh();
        });
        list.append(row);
      });
    } catch {
      list.replaceChildren();
      const error = document.createElement("p");
      error.className = "notification-empty";
      error.textContent = currentLang === "en" ? "Could not load notifications." : "تعذر تحميل الإشعارات.";
      list.append(error);
    }
  };
  toggle.addEventListener("click", async () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
    if (opening) await refresh();
  });
  $("#notificationReadAll", center).addEventListener("click", async () => {
    try { await apiRequest("/notifications/read-all", { method: "POST" }); await refresh(); } catch {}
  });
  $("#notificationClearAll", center).addEventListener("click", async () => {
    if (!notifications.length) return;
    const confirmed = confirm(currentLang === "en" ? "Delete all your notifications? This cannot be undone." : "هل تريد حذف جميع إشعاراتك؟ لا يمكن التراجع عن هذا الإجراء.");
    if (!confirmed) return;
    const clearButton = $("#notificationClearAll", center);
    clearButton.disabled = true;
    try {
      await apiRequest("/notifications", { method: "DELETE" });
      await refresh();
    } catch (cause) {
      alert(cause.message || (currentLang === "en" ? "Could not delete notifications." : "تعذر حذف الإشعارات."));
    } finally {
      clearButton.disabled = false;
    }
  });  document.addEventListener("click", (event) => {
    if (!center.contains(event.target)) { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { panel.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
  });
  refresh();
  window.setInterval(refresh, 30_000);
}
setupNotifications();

function timeAgo(dateString) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (isNaN(seconds) || seconds < 60) return "الآن";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

function showFormNotice(form, message, success = true) {
  if (!form) return;
  const el = form.querySelector(".notice") || form.querySelector(".form-notice") || document.getElementById("toast");
  if (!el) {
    if (!success) alert(message);
    return;
  }
  el.textContent = message;
  el.style.display = "block";
  if (success) {
    el.style.background = "#e8fbf4";
    el.style.color = "#078c77";
    el.style.border = "1px solid #a3f0d8";
  } else {
    el.style.background = "#fdeeed";
    el.style.color = "#c53030";
    el.style.border = "1px solid #fecaca";
  }
}

const registerForm = $("#registerForm");
registerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (apiEnabled) {
    const data = new FormData(registerForm);
    apiRequest("/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) })
      .then(({ user }) => {
        storage.set("ameen-token", "cookie-session"); storage.set("ameen-session", user);
        showFormNotice(registerForm, "تم إنشاء الحساب. سيتم تحويلك إلى الكورسات الآن.");
        setTimeout(() => (location.href = dashboardFor(user.role)), 700);
      }).catch((cause) => showFormNotice(registerForm, cause.message, false));
    return;
  }
  showFormNotice(registerForm, "افتح المنصة من خلال run-local-server.bat لإنشاء حساب آمن.", false);
});

const loginForm = $("#loginForm");
loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (apiEnabled) {
    const data = new FormData(loginForm);
    apiRequest("/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) })
      .then(({ user }) => {
        storage.set("ameen-token", "cookie-session"); storage.set("ameen-session", user);
        showFormNotice(loginForm, `أهلًا بعودتك يا ${user.name}.`);
        const nextPage = (new URLSearchParams(location.search).get("next") || "").replace(/^\/+/, "");
        setTimeout(() => (location.href = /^[a-z0-9-]+\.html$/.test(nextPage) ? nextPage : dashboardFor(user.role)), 700);
      }).catch((cause) => showFormNotice(loginForm, cause.message, false));
    return;
  }
  showFormNotice(loginForm, "افتح المنصة من خلال run-local-server.bat لتسجيل الدخول بأمان.", false);
});

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

async function setupPublicChat() {
  const list = $("#chatMessages");
  const form = $("#chatComposer");
  if (!list || !form) return;
  if (!apiEnabled || !storage.get("ameen-token", "")) {
    list.innerHTML = '<div class="empty-state" style="display:block">سجّل الدخول لتشارك في الشات العام.</div>';
    $("#chatComposer").hidden = true;
    return;
  }
  let canModerate = false;
  let chatGrade = "first-secondary";
  try {
    const { user } = await apiRequest("/me");
    canModerate = ["teacher", "admin"].includes(user.role);
    if (user.role === "admin") {
      $("#chatAdminTools").hidden = false;
      $("#chatClearGroup").addEventListener("click", async () => { if (!confirm("مسح كل رسائل هذه المجموعة؟")) return; try { await apiRequest("/chat/messages?grade=" + encodeURIComponent(chatGrade), { method: "DELETE" }); knownMessages = []; await loadLatest(true); } catch (cause) { $("#chatConnectionStatus").textContent = cause.message; } });
      $("#chatClearAll").addEventListener("click", async () => { if (!confirm("مسح سجل رسائل الشات بالكامل؟")) return; try { await apiRequest("/chat/messages", { method: "DELETE" }); knownMessages = []; await loadLatest(true); } catch (cause) { $("#chatConnectionStatus").textContent = cause.message; } });
    }
    const requestedGrade = new URLSearchParams(location.search).get("grade");
    const groups = await apiRequest("/chat/groups" + (canModerate && requestedGrade ? "?grade=" + encodeURIComponent(requestedGrade) : ""));
    chatGrade = groups.groups?.[0]?.grade || "first-secondary";
    const groupPicker = $("#chatGroupSelect");
    if (groupPicker) {
      groupPicker.value = chatGrade;
      groupPicker.hidden = !canModerate;
      groupPicker.addEventListener("change", async () => {
        chatGrade = groupPicker.value;
        history.replaceState(null, "", "chat.html?grade=" + chatGrade);
        $("#chatGroupTitle").textContent = ({"first-secondary":"مجموعة الأول الثانوي","second-secondary":"مجموعة الثاني الثانوي","third-secondary":"مجموعة الثالث الثانوي"})[chatGrade] || "مجموعة الصف";
        knownMessages = []; hasMore = false;
        await loadLatest(true);
      });
    }
    $("#chatGroupTitle").textContent = ({"first-secondary":"مجموعة الأول الثانوي","second-secondary":"مجموعة الثاني الثانوي","third-secondary":"مجموعة الثالث الثانوي"})[chatGrade] || "مجموعة الصف";
  } catch {}

  const olderButton = $("#chatLoadOlder");
  const replyBar = $("#chatReplyBar");
  const replyLabel = $("#chatReplyLabel");
  const input = $("#chatInput");
  const counter = $("#chatCounter");
  const imageInput = $("#chatImageInput");
  const videoInput = $("#chatVideoInput");
  const attachmentStatus = $("#chatAttachmentStatus");
  const recordButton = $("#chatRecordAudio");
  const stopRecordButton = $("#chatStopAudio");
  const questionInput = $("#chatIsQuestion");
  const highlightedMessageId = new URLSearchParams(location.search).get("message");
  let replyToId = "";
  let hasMore = false;
  let loading = false;
  let knownMessages = [];
  let selectedAttachment = null;
  let mediaRecorder = null;
  let recordingChunks = [];

  const render = (messages, keepPosition = false) => {
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    const oldHeight = list.scrollHeight;
    knownMessages = messages;
    list.innerHTML = messages.length ? messages.map((message) => {
      const roleName = message.author.role === "teacher" ? "مدرس" : message.author.role === "admin" ? "إدارة" : "طالب";
      const reply = message.replyTo ? `<div class="chat-reply-preview"><b>رد على ${escapeHtml(message.replyTo.authorName)}</b><span>${escapeHtml(message.replyTo.text || "رسالة مرفقة")}</span></div>` : "";
      const attachment = message.attachment?.type === "image" ? `<a class="chat-attachment-link" href="${escapeHtml(message.attachment.url)}" target="_blank" rel="noopener"><img class="chat-image" src="${escapeHtml(message.attachment.url)}" alt="صورة مرفقة" loading="lazy"></a>` : message.attachment?.type === "audio" ? `<audio class="chat-audio" controls preload="metadata" src="${escapeHtml(message.attachment.url)}">المتصفح لا يدعم تشغيل التسجيل الصوتي.</audio>` : message.attachment?.type === "video" ? `<video class="chat-video" controls playsinline preload="metadata" src="${escapeHtml(message.attachment.url)}">المتصفح لا يدعم تشغيل الفيديو.</video>` : "";
      const time = new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));
      const text = message.text ? `<p>${escapeHtml(message.text).replace(/\n/g, "<br>")}</p>` : "";
      const questionBadge = message.isQuestion ? '<span class="pill chat-question-badge">سؤال</span>' : "";
      return `<article class="chat-message ${message.isQuestion ? "is-question" : ""}" id="chat-${escapeHtml(message.id)}"><div class="chat-message-head"><b>${escapeHtml(message.author.name)}</b><span class="pill">${roleName}</span>${questionBadge}<time datetime="${escapeHtml(message.createdAt)}">${time} · ${timeAgo(message.createdAt)}</time></div>${reply}${text}${attachment}<button class="text-action" type="button" data-chat-reply="${escapeHtml(message.id)}">رد</button></article>`;
    }).join("") : '<div class="empty-state" style="display:block">لا توجد رسائل بعد. ابدأ المحادثة!</div>';
    if (canModerate) {
      list.querySelectorAll(".chat-message").forEach((article) => {
        const actions = document.createElement("div");
        actions.className = "chat-message-actions";
        const replyButton = article.querySelector("[data-chat-reply]");
        if (replyButton) actions.append(replyButton);
        const deleteButton = document.createElement("button");
        deleteButton.className = "text-action chat-delete-action";
        deleteButton.type = "button";
        deleteButton.dataset.chatDelete = article.id.slice(5);
        deleteButton.textContent = "حذف الرسالة";
        actions.append(deleteButton);
        article.append(actions);
      });
    }
    if (!keepPosition || wasNearBottom) list.scrollTop = list.scrollHeight;
    else list.scrollTop += list.scrollHeight - oldHeight;
    if (highlightedMessageId) {
      const target = document.getElementById(`chat-${highlightedMessageId}`);
      if (target) { target.scrollIntoView({ block: "center" }); target.classList.add("chat-message-highlight"); }
    }
  };

  const loadLatest = async (first = false) => {
    if (loading) return;
    loading = true;
    try {
      const result = await apiRequest("/chat/messages?grade=" + encodeURIComponent(chatGrade));
      hasMore = result.hasMore;
      olderButton.hidden = !hasMore;
      const deletedIds = new Set(result.deletedMessageIds || []);
      const merged = new Map(knownMessages.map((message) => [message.id, message]));
      result.messages.forEach((message) => merged.set(message.id, message));
      render([...merged.values()].filter((message) => !deletedIds.has(message.id)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), !first);
      $("#chatConnectionStatus").textContent = "متصل · تتحدث المحادثة تلقائيًا";
    } catch (cause) {
      $("#chatConnectionStatus").textContent = cause.message;
    } finally { loading = false; }
  };

  olderButton.addEventListener("click", async () => {
    if (!hasMore || !knownMessages.length) return;
    olderButton.disabled = true;
    const firstId = knownMessages[0].id;
    const firstMessage = document.getElementById(`chat-${firstId}`);
    const firstMessageTop = firstMessage?.getBoundingClientRect().top;
    try {
      const result = await apiRequest(`/chat/messages?grade=${encodeURIComponent(chatGrade)}&before=${encodeURIComponent(firstId)}`);
      const combined = [...result.messages, ...knownMessages];
      hasMore = result.hasMore;
      olderButton.hidden = !hasMore;
      render(combined, true);
      const preservedMessage = document.getElementById(`chat-${firstId}`);
      if (preservedMessage && firstMessageTop !== undefined) list.scrollTop += preservedMessage.getBoundingClientRect().top - firstMessageTop;
    } catch (cause) { $("#chatConnectionStatus").textContent = cause.message; }
    finally { olderButton.disabled = false; }
  });

  list.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-chat-delete]");
    if (deleteButton) {
      if (!confirm("هل تريد حذف هذه الرسالة من الشات العام؟")) return;
      deleteButton.disabled = true;
      try {
        const deletedId = deleteButton.dataset.chatDelete;
        await apiRequest("/chat/messages/" + encodeURIComponent(deletedId), { method: "DELETE" });
        knownMessages = knownMessages.filter((item) => item.id !== deletedId);
        if (replyToId === deletedId) { replyToId = ""; replyBar.hidden = true; }
        render(knownMessages, true);
      } catch (cause) {
        $("#chatConnectionStatus").textContent = cause.message;
        deleteButton.disabled = false;
      }
      return;
    }
    const button = event.target.closest("[data-chat-reply]");
    if (!button) return;
    const message = knownMessages.find((item) => item.id === button.dataset.chatReply);
    if (!message) return;
    replyToId = message.id;
    replyLabel.textContent = `الرد على ${message.author.name}: ${message.text.slice(0, 90)}`;
    replyBar.hidden = false;
    input.focus();
  });
  $("#chatChooseImage").addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8_000_000) {
      imageInput.value = "";
      attachmentStatus.textContent = "اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 8 ميغابايت.";
      return;
    }
    selectedAttachment = { file, type: "image" };
    attachmentStatus.textContent = `الصورة جاهزة للإرسال: ${file.name}`;
  });
  $("#chatChooseVideo").addEventListener("click", () => videoInput.click());
  videoInput.addEventListener("change", () => {
    const file = videoInput.files[0];
    if (!file) return;
    if (!["video/mp4", "video/webm"].includes(file.type) || file.size > 20_000_000) {
      videoInput.value = "";
      attachmentStatus.textContent = "اختر فيديو MP4 أو WebM بحجم لا يتجاوز 20 ميغابايت.";
      return;
    }
    selectedAttachment = { file, type: "video" };
    attachmentStatus.textContent = `الفيديو جاهز للإرسال: ${file.name}`;
  });
  recordButton.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      attachmentStatus.textContent = "التسجيل الصوتي غير مدعوم في هذا المتصفح.";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordingChunks = [];
      mediaRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
      mediaRecorder.addEventListener("stop", () => {
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const cleanType = blob.type.split(";")[0];
        const extension = cleanType === "audio/mp4" ? "m4a" : cleanType === "audio/ogg" ? "ogg" : cleanType === "audio/wav" ? "wav" : cleanType === "audio/mpeg" ? "mp3" : "webm";
        selectedAttachment = { file: new File([blob], `chat-recording.${extension}`, { type: cleanType }), type: "audio" };
        attachmentStatus.textContent = `التسجيل جاهز للإرسال (${(blob.size / 1024 / 1024).toFixed(1)} ميغابايت).`;
        stream.getTracks().forEach((track) => track.stop());
        recordButton.hidden = false;
        stopRecordButton.hidden = true;
      }, { once: true });
      mediaRecorder.start();
      recordButton.hidden = true;
      stopRecordButton.hidden = false;
      selectedAttachment = null;
      imageInput.value = "";
      attachmentStatus.textContent = "جارٍ التسجيل...";
    } catch (cause) {
      attachmentStatus.textContent = cause.name === "NotAllowedError" ? "اسمح باستخدام الميكروفون لبدء التسجيل." : "تعذر بدء التسجيل الصوتي.";
    }
  });
  stopRecordButton.addEventListener("click", () => { if (mediaRecorder?.state === "recording") mediaRecorder.stop(); });
  $("#chatCancelReply").addEventListener("click", () => { replyToId = ""; replyBar.hidden = true; });
  input.addEventListener("input", () => { counter.textContent = `${input.value.length}/1000`; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.value.trim() && !selectedAttachment) {
      $("#chatFormNotice").textContent = "اكتب رسالة أو أرفق صورة أو فيديو أو تسجيلاً صوتيًا.";
      $("#chatFormNotice").hidden = false;
      return;
    }
    const sendButton = $("#chatSendButton");
    sendButton.disabled = true;
    try {
      let attachment;
      if (selectedAttachment) {
        attachmentStatus.textContent = "يجري رفع المرفق...";
        const uploadKind = `chat-${selectedAttachment.type}`;
        const uploaded = await apiRequest("/uploads", { method: "POST", headers: { "X-Upload-Kind": uploadKind }, body: JSON.stringify({ fileName: selectedAttachment.file.name, dataUrl: await fileToDataUrl(selectedAttachment.file), kind: uploadKind }) });
        attachment = { type: selectedAttachment.type, url: uploaded.url };
      }
      await apiRequest("/chat/messages", { method: "POST", body: JSON.stringify({ text: input.value, attachment, isQuestion: questionInput.checked, replyToId: replyToId || undefined, grade: chatGrade }) });
      form.reset(); counter.textContent = "0/1000"; replyToId = ""; replyBar.hidden = true;
      selectedAttachment = null; attachmentStatus.textContent = "";
      await loadLatest(); list.scrollTop = list.scrollHeight;
    } catch (cause) { $("#chatFormNotice").textContent = cause.message; $("#chatFormNotice").hidden = false; }
    finally { sendButton.disabled = false; }
  });
  form.addEventListener("input", () => { $("#chatFormNotice").hidden = true; }, true);
  await loadLatest(true);
  window.setInterval(() => loadLatest(), 4000);
}
setupPublicChat();

async function setupPrivateMessages() {
  const list = $("#privateUserList");
  const messageList = $("#privateMessages");
  const form = $("#privateMessageForm");
  if (!list || !messageList || !form) return;
  if (!apiEnabled || !storage.get("ameen-token", "")) {
    messageList.innerHTML = '<div class="empty-state" style="display:block">سجّل الدخول لاستخدام الرسائل الخاصة.</div>';
    return;
  }

  let currentUserId = "";
  let users = [];
  let selectedUserId = new URLSearchParams(location.search).get("user") || "";
  let loadingConversation = false;
  let selectedAttachment = null;
  try {
    const { user } = await apiRequest("/me");
    currentUserId = user.id;
  } catch (cause) {
    $("#privateThreadStatus").textContent = cause.message;
    return;
  }

  const roleLabels = { student: "طالب", teacher: "مدرس", admin: "إدارة" };
  const selectedUser = () => users.find((user) => user.id === selectedUserId);
  const renderUsers = () => {
    const query = $("#privateUserSearch").value.trim().toLocaleLowerCase("ar");
    const visible = users.filter((user) => user.name.toLocaleLowerCase("ar").includes(query));
    list.innerHTML = visible.length ? visible.map((user) => {
      const preview = user.lastMessage?.text || "ابدأ محادثة جديدة";
      const unread = user.unread ? '<span class="private-unread-count">' + user.unread + "</span>" : "";
      return '<button class="private-user' + (user.id === selectedUserId ? " active" : "") + '" type="button" data-private-user="' + escapeHtml(user.id) + '"><span class="private-user-copy"><b>' + escapeHtml(user.name) + '</b><small>' + escapeHtml(roleLabels[user.role] || "حساب") + " · " + escapeHtml(preview.slice(0, 65)) + "</small></span>" + unread + "</button>";
    }).join("") : '<p class="private-empty">لا توجد حسابات مطابقة.</p>';
  };
  const loadUsers = async () => {
    const result = await apiRequest("/direct-messages/users");
    users = result.users || [];
    renderUsers();
    if (!selectedUserId && users.length) {
      selectedUserId = users[0].id;
      history.replaceState(null, "", "messages.html?user=" + encodeURIComponent(selectedUserId));
      renderUsers();
    } else if (selectedUserId && !users.some((user) => user.id === selectedUserId)) {
      selectedUserId = "";
      history.replaceState(null, "", "messages.html");
      renderUsers();
    }
    return selectedUser();
  };
  const loadConversation = async () => {
    if (!selectedUserId || loadingConversation) return;
    loadingConversation = true;
    const wasNearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
    try {
      const result = await apiRequest("/direct-messages/" + encodeURIComponent(selectedUserId));
      $("#privateThreadTitle").textContent = result.user.name + " · " + (roleLabels[result.user.role] || "حساب");
      $("#privateThreadStatus").textContent = "محادثة خاصة";
      form.hidden = false;
      messageList.innerHTML = result.messages.length ? result.messages.map((message) => {
        const own = message.senderId === currentUserId;
        const time = new Intl.DateTimeFormat("ar-EG", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));
        const attachment = message.attachment?.type === "image" ? '<a class="chat-attachment-link" href="' + escapeHtml(message.attachment.url) + '" target="_blank" rel="noopener"><img class="chat-image" src="' + escapeHtml(message.attachment.url) + '" alt="مرفق خاص" loading="lazy"></a>' : message.attachment?.type === "audio" ? '<audio class="chat-audio" controls preload="metadata" src="' + escapeHtml(message.attachment.url) + '"></audio>' : message.attachment?.type === "video" ? '<video class="chat-video" controls playsinline preload="metadata" src="' + escapeHtml(message.attachment.url) + '"></video>' : "";
        return '<article class="private-message' + (own ? " own" : "") + '">' + (message.text ? '<p>' + escapeHtml(message.text).replace(/\n/g, "<br>") + '</p>' : "") + attachment + '<time datetime="' + escapeHtml(message.createdAt) + '">' + time + " · " + timeAgo(message.createdAt) + "</time></article>";
      }).join("") : '<div class="empty-state" style="display:block">لا توجد رسائل بينكما بعد. ابدأ المحادثة.</div>';
      if (wasNearBottom) messageList.scrollTop = messageList.scrollHeight;
    } catch (cause) {
      $("#privateThreadStatus").textContent = cause.message;
    } finally {
      loadingConversation = false;
    }
  };

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-private-user]");
    if (!button) return;
    selectedUserId = button.dataset.privateUser;
    history.replaceState(null, "", "messages.html?user=" + encodeURIComponent(selectedUserId));
    renderUsers();
    await loadConversation();
    await loadUsers();
  });
  $("#privateUserSearch").addEventListener("input", renderUsers);
  const privateAttachmentInput = $("#privateAttachmentInput");
  $("#privateChooseAttachment").addEventListener("click", () => privateAttachmentInput.click());
  privateAttachmentInput.addEventListener("change", () => {
    const file = privateAttachmentInput.files[0]; if (!file) return;
    const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "";
    const maxSize = type === "image" ? 8_000_000 : type === "video" ? 20_000_000 : 12_000_000;
    if (!type || !["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"].includes(file.type) || file.size > maxSize) { privateAttachmentInput.value = ""; $("#privateAttachmentStatus").textContent = "صيغة الملف أو حجمه غير صالح. الحد 8 ميغابايت للصورة و20 للفيديو و12 للصوت."; return; }
    selectedAttachment = { file, type }; $("#privateAttachmentStatus").textContent = "المرفق جاهز: " + file.name;
  });
  $("#privateMessageInput").addEventListener("input", () => {
    $("#privateMessageCounter").textContent = $("#privateMessageInput").value.length + "/2000";
    $("#privateMessageNotice").hidden = true;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#privateMessageInput");
    const button = $("#privateSendButton");
    if (!selectedUserId || (!input.value.trim() && !selectedAttachment)) return;
    button.disabled = true;
    try {
      let attachment;
      if (selectedAttachment) { const kind = "chat-" + selectedAttachment.type; const uploaded = await apiRequest("/uploads", { method: "POST", headers: { "X-Upload-Kind": kind }, body: JSON.stringify({ fileName: selectedAttachment.file.name, dataUrl: await fileToDataUrl(selectedAttachment.file), kind }) }); attachment = { type: selectedAttachment.type, url: uploaded.url }; }
      await apiRequest("/direct-messages/" + encodeURIComponent(selectedUserId), { method: "POST", body: JSON.stringify({ text: input.value, attachment }) });
      form.reset();
      selectedAttachment = null; $("#privateAttachmentStatus").textContent = "";
      $("#privateMessageCounter").textContent = "0/2000";
      await loadConversation();
      await loadUsers();
      messageList.scrollTop = messageList.scrollHeight;
    } catch (cause) {
      $("#privateMessageNotice").textContent = cause.message;
      $("#privateMessageNotice").hidden = false;
    } finally {
      button.disabled = false;
      input.focus();
    }
  });

  $("#privateThreadStatus").textContent = "جارٍ تحميل الحسابات...";
  try {
    await loadUsers();
    if (selectedUserId) await loadConversation();
    else $("#privateThreadStatus").textContent = users.length ? "اختر حسابًا لبدء المحادثة" : "لا توجد حسابات أخرى في المنصة بعد.";
  } catch (cause) {
    $("#privateThreadStatus").textContent = cause.message;
  }
  window.setInterval(async () => {
    try {
      await loadUsers();
      if (selectedUserId) await loadConversation();
    } catch {}
  }, 5000);
}
setupPrivateMessages();

async function renderCourses() {
  const grids = [$("#courseGrid"), $("#homeCourseGrid")].filter(Boolean);
  if (!grids.length) return;
  grids.forEach((grid) => {
    grid.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.style.display = "block";
    loading.textContent = currentLang === "en" ? "Loading courses..." : "جاري تحميل الكورسات...";
    grid.appendChild(loading);
  });
  let courses = [];
  if (apiEnabled) {
    try {
      courses = (await apiRequest("/courses")).courses || [];
    } catch { courses = []; }
  } else {
    courses = [];
  }
  grids.forEach((grid) => {
    grid.innerHTML = "";
    if (!courses.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.display = "block";
      empty.textContent = currentLang === "en"
        ? "No courses for your grade yet — they will appear here once your teacher publishes them."
        : "لا توجد كورسات لمرحلتك حاليًا — ستظهر هنا فور نشرها من المدرس.";
      grid.appendChild(empty);
      return;
    }
    courses.forEach((course) => {
      const card = document.createElement("article");
      card.className = "course-card";
      card.dataset.course = "";
      card.dataset.grade = course.grade || "all";
      const isImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(String(course.cover || "")) || /^\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(String(course.cover || ""));
      const coverClass = isImage ? "course-cover has-image" : "course-cover";
      const icon = isImage ? "" : escapeHtml(course.cover || "⚛️");
      const gradeLabel = ({"first-secondary":"الأول الثانوي","second-secondary":"الثاني الثانوي","third-secondary":"الثالث الثانوي",secondary:"الثانوي"})[course.grade] || "صف ثانوي";
      const lessonsLine = course.lessons ? `<span>${escapeHtml(course.lessons)} درس</span>` : "";
      const priceLabel = course.isFree ? "مجاني" : `${Number(course.price || 0).toFixed(2)} جنيه`;

      card.innerHTML = `<div class="${coverClass}"><span>${icon}</span></div><div class="course-body"><div class="course-meta"><span class="pill">${gradeLabel}</span>${lessonsLine}</div><h3>${escapeHtml(course.title)}</h3><p>${escapeHtml(course.description)}</p><div class="course-foot"><span class="course-price">${priceLabel}</span><a href="course-details.html?course=${encodeURIComponent(course.id)}">عرض التفاصيل ←</a></div></div>`;
      if (isImage) {
        const image = document.createElement("img");
        image.src = course.cover;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        card.querySelector(".course-cover span").replaceWith(image);
      }
      grid.appendChild(card);
    });
  });
}
renderCourses();


async function renderCourseDetails() {
  const params=new URLSearchParams(location.search),courseId=params.get("course"),main=$("#courseDetails")||($("main.container")&&location.pathname.endsWith("course-details.html")?$("main.container"):null);if(!courseId||!main)return;
  try{const courseResult=await apiRequest("/courses/"+encodeURIComponent(courseId));let lessonResult={lessons:[]};try{lessonResult=await apiRequest("/courses/"+encodeURIComponent(courseId)+"/lessons");}catch{}const course=courseResult.course,lessons=lessonResult.lessons,user=storage.get("ameen-session",null),canManage=user&&(user.role==="admin"||(user.role==="teacher"&&course.ownerId===user.id));
  const rows=lessons.length?lessons.map((lesson,index)=>'<div class="list-row"><span class="row-icon">▶</span><div class="row-copy"><b>'+String(index+1).padStart(2,"0")+' — '+escapeHtml(lesson.title)+'</b></div><a class="row-arrow" href="lesson.html?lesson='+encodeURIComponent(lesson.id)+'">مشاهدة</a>'+(canManage?'<a class="btn btn-soft" href="create-lesson.html?course='+encodeURIComponent(course.id)+'&lesson='+encodeURIComponent(lesson.id)+'">تعديل</a>':'')+'</div>').join(''):'<div class="empty-state" style="display:block">لا توجد محاضرات مضافة لهذا الكورس حتى الآن.</div>';
  main.innerHTML='<section class="page-heading"><div class="breadcrumbs"><a href="courses.html">الكورسات</a> / '+escapeHtml(course.title)+'</div><h1>'+escapeHtml(course.title)+'</h1><p class="lead">'+escapeHtml(course.description)+'</p></section><section class="admin-layout"><article class="content-card"><span class="pill">'+(({"first-secondary":"الأول الثانوي","second-secondary":"الثاني الثانوي","third-secondary":"الثالث الثانوي",secondary:"الثانوي"})[course.grade]||"صف ثانوي")+'</span><h2>محاضرات الكورس</h2><div>'+rows+'</div>'+(canManage?'<div class="form-grid" style="margin-top:20px"><a class="btn btn-primary" href="create-lesson.html?course='+encodeURIComponent(course.id)+'">إضافة محاضرة</a><a class="btn btn-secondary" href="exams.html?course='+encodeURIComponent(course.id)+'">إدارة الامتحانات</a><a class="btn btn-soft" href="create-course.html?edit='+encodeURIComponent(course.id)+'">تعديل بيانات الكورس</a><button class="btn btn-soft" type="button" id="deleteCourseButton">حذف الكورس</button></div>':'')+'</article><aside class="content-card"><h2>الالتحاق بالكورس</h2>'+(course.enrolled?'<p class="lead">أنت مشترك في هذا الكورس.</p><a class="btn btn-primary" href="lessons.html?course='+encodeURIComponent(course.id)+'">عرض المحاضرات</a> <a class="btn btn-soft" href="exams.html?course='+encodeURIComponent(course.id)+'">امتحانات الكورس</a>':canManage?'<p class="lead">إدارة محتوى الكورس من هنا.</p>':'<p class="lead">أرسل طلب الالتحاق للمدرس. سيظهر لك رقم التواصل بعد الإرسال.</p><form id="courseRequestForm"><div class="notice"></div><label class="field"><span>رقم الهاتف</span><input required name="phone" inputmode="tel" placeholder="01xxxxxxxxx"></label><button class="btn btn-primary" type="submit">إرسال طلب الكورس</button></form>')+'</aside></section>';
  const priceInfo=document.createElement("p");priceInfo.className="pill course-price-badge";priceInfo.textContent=course.isFree?"كورس مجاني":`السعر: ${Number(course.price||0).toFixed(2)} جنيه مصري`;main.querySelector(".page-heading")?.append(priceInfo);
  if(user?.role==="student"&&!course.enrolled&&course.requestStatus&&!canManage){const requestForm=$("#courseRequestForm"),panel=document.createElement("div");if(requestForm)requestForm.hidden=true;panel.className="notice";const statuses={pending:"طلبك قيد مراجعة المدرس أو المدير. سيصلك إشعار عند اتخاذ القرار.",approved:course.isFree?"تمت الموافقة. يجري تفعيل الكورس.":course.paymentStatus==="paid"?"تم تأكيد الدفع. انتظر إتمام التفعيل.":course.paymentStatus==="pending"?`تمت الموافقة. رقم الدفع المرجعي: ${course.paymentReferenceNumber||"قيد الإصدار"}.`:"تمت الموافقة على طلبك. أكمل الدفع لتفعيل محتوى الكورس.",rejected:"تم رفض الطلب السابق. يمكنك إرسال طلب جديد من النموذج."};panel.textContent=statuses[course.requestStatus]||"";if(course.requestStatus==="approved"&&!course.isFree&&course.paymentStatus!=="paid"){const pay=document.createElement("button");pay.type="button";pay.className="btn btn-primary";pay.textContent=course.paymentStatus==="pending"?"عرض رقم الدفع":"إنشاء طلب الدفع";pay.addEventListener("click",async()=>{pay.disabled=true;try{const result=await apiRequest("/courses/"+encodeURIComponent(course.id)+"/payments",{method:"POST",body:JSON.stringify({})});panel.textContent=`رقم الدفع المرجعي من فوري: ${result.payment.referenceNumber||"قيد الإصدار"}. المبلغ ${Number(result.payment.amount).toFixed(2)} جنيه.`;panel.append(pay);pay.textContent="تحديث حالة الدفع";pay.disabled=false;}catch(error){panel.textContent=error.message;pay.disabled=false;panel.append(pay);}});panel.append(document.createElement("br"),pay);}main.querySelector(".admin-layout aside")?.prepend(panel);}
  $("#courseRequestForm")?.addEventListener("submit",async(event)=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector("button");button.disabled=true;try{const result=await apiRequest("/courses/"+encodeURIComponent(course.id)+"/request",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))});let notice=result.request.status==="approved"?(course.isFree?"تم قبول طلبك تلقائياً وتفعيل الكورس.":"تم قبول طلبك تلقائياً. أكمل الدفع لتفعيل الكورس."):"تم إرسال طلب الالتحاق. كود الطلب: "+result.request.requestCode+". تواصل مع "+result.teacher.name+" على: "+result.teacher.phone+". سيظهر المحتوى بعد موافقة المدرس أو المدير.";if(!course.isFree&&result.request.status==="approved"){const payment=await apiRequest("/courses/"+encodeURIComponent(course.id)+"/payments",{method:"POST",body:JSON.stringify({})});notice+=` رقم الدفع المرجعي من فوري: ${payment.payment.referenceNumber}. ادفع خلال المهلة الموضحة لتفعيل طلبك.`;}else if(!course.isFree){notice+=" ستتمكن من الدفع بعد موافقة المدرس أو المدير.";}showFormNotice(form,notice);button.textContent=course.isFree?"تم إرسال الطلب":"تم إنشاء طلب الدفع";}catch(error){showFormNotice(form,error.message,false);button.disabled=false;}});
  $("#deleteCourseButton")?.addEventListener("click",async()=>{if(!confirm("حذف الكورس سيحذف محاضراته وامتحاناته وطلبات الالتحاق به. هل تريد المتابعة؟"))return;try{await apiRequest("/courses/"+encodeURIComponent(course.id),{method:"DELETE"});location.href="courses.html";}catch(error){alert(error.message);}});
  }catch(error){main.innerHTML='<section class="page-heading"><h1>تعذر فتح الكورس</h1><p class="lead">'+escapeHtml(error.message)+'</p></section>';}
}
renderCourseDetails();

const courseForm = $("#courseForm");
if(courseForm){const params=new URLSearchParams(location.search),editId=params.get("edit"),titleInput=$('[name="title"]',courseForm),descriptionInput=$('[name="description"]',courseForm),gradeInput=$('[name="grade"]',courseForm),coverFileInput=$("#courseCoverFile"),coverPreview=$("#courseCoverPreview"),priceInput=$('[name="price"]',courseForm),isFreeInput=$('[name="isFree"]',courseForm),approvalInput=$('[name="requiresApproval"]',courseForm),publishedInput=$('[name="published"]',courseForm),heading=$("#courseFormHeading"),submit=courseForm.querySelector("button[type=submit]");let coverValue="⚛️";
const showCoverPreview=value=>{if(!value||!/^data:image\/(?:png|jpeg|webp);base64,/i.test(value)&&!/^\/uploads\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(value)){coverPreview.hidden=true;coverPreview.removeAttribute("src");return;}coverPreview.src=value;coverPreview.hidden=false;};
coverFileInput.addEventListener("change",async()=>{const file=coverFileInput.files?.[0];if(!file){showCoverPreview(coverValue);return;}if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>8_000_000){coverFileInput.value="";showCoverPreview(coverValue);return showFormNotice(courseForm,"اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 8 ميغابايت.",false);}showCoverPreview(await fileToDataUrl(file));});
const syncPrice=()=>{const free=isFreeInput.value==="true";priceInput.disabled=free;priceInput.required=!free;if(free)priceInput.value="0";else if(Number(priceInput.value)<=0)priceInput.value="";};isFreeInput.addEventListener("change",syncPrice);syncPrice();
const session=storage.get("ameen-session",null);if(!apiEnabled||!session||!["teacher","admin"].includes(session.role))location.replace("login.html?next=create-course.html");
if(editId){heading.textContent="تعديل بيانات الكورس";submit.textContent="حفظ التعديلات";apiRequest("/courses/"+encodeURIComponent(editId)).then(({course})=>{titleInput.value=course.title;descriptionInput.value=course.description;gradeInput.value=course.grade;coverValue=course.cover||"⚛️";showCoverPreview(coverValue);priceInput.value=course.price||0;isFreeInput.value=String(Boolean(course.isFree));approvalInput.value=String(course.requiresApproval!==false);publishedInput.value=String(Boolean(course.published));syncPrice();}).catch(error=>showFormNotice(courseForm,error.message,false));}
courseForm.addEventListener("submit",async(event)=>{event.preventDefault();const file=coverFileInput.files?.[0];if(file&&(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>8_000_000))return showFormNotice(courseForm,"اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 8 ميغابايت.",false);submit.disabled=true;try{if(file){const kind="course-cover",uploaded=await apiRequest("/uploads",{method:"POST",headers:{"X-Upload-Kind":kind},body:JSON.stringify({fileName:file.name,dataUrl:await fileToDataUrl(file),kind})});coverValue=uploaded.url;}const data={title:titleInput.value.trim(),description:descriptionInput.value.trim(),grade:gradeInput.value,price:isFreeInput.value==="true"?0:Number(priceInput.value||0),isFree:isFreeInput.value==="true",requiresApproval:approvalInput.value==="true",published:publishedInput.value==="true",cover:coverValue};const result=await apiRequest(editId?"/courses/"+encodeURIComponent(editId):"/courses",{method:editId?"PATCH":"POST",body:JSON.stringify(data)});showFormNotice(courseForm,editId?"تم تحديث بيانات الكورس.":(data.published?"تم نشر الكورس. ":"تم حفظ المسودة. ")+"كود الكورس: "+result.accessCode);if(!editId){courseForm.reset();coverValue="⚛️";showCoverPreview(coverValue);syncPrice();setTimeout(()=>location.href="course-details.html?course="+encodeURIComponent(result.course.id),700);}}catch(error){showFormNotice(courseForm,error.message,false);}finally{submit.disabled=false;}});
}
async function renderManagedCourses(){const box=$("#managedCourses"),user=storage.get("ameen-session",null);if(!box||!apiEnabled||!user||!["teacher","admin"].includes(user.role))return;try{const {courses}=await apiRequest("/courses");const mine=courses.filter(course=>user.role==="admin"||course.ownerId===user.id);box.innerHTML=mine.length?mine.map(course=>'<article class="feature-card"><h3>'+escapeHtml(course.title)+'</h3><p>'+escapeHtml(course.description)+'</p><a class="btn btn-primary" href="course-details.html?course='+encodeURIComponent(course.id)+'">إدارة المحتوى</a> <a class="btn btn-soft" href="create-course.html?edit='+encodeURIComponent(course.id)+'">تعديل</a></article>').join(''):'<div class="empty-state" style="display:block">لم تنشئ أي كورس بعد.</div>';}catch(error){box.innerHTML='<div class="empty-state" style="display:block">'+escapeHtml(error.message)+'</div>';}}
renderManagedCourses();const profileForm = $("#profileForm");
if(profileForm){const session=storage.get("ameen-session",null);if(!session)location.replace("login.html?next=profile.html");const user=session||{};if(!$("#profilePhoneInput")){const field=document.createElement("label");field.className="field";field.innerHTML='<span>رقم الهاتف</span><input name="phone" id="profilePhoneInput" inputmode="tel" placeholder="01xxxxxxxxx">';$("#profileGradeInput").closest("label").before(field);}const displayName=user.name||"حساب المنصة";$("#profileName").textContent=displayName;$("#profileEmail").textContent=user.email||"";$("#profileAvatar").textContent=displayName.charAt(0);if(user.avatarUrl)$("#profileAvatar").innerHTML='<img alt="صورة الحساب" src="'+escapeHtml(user.avatarUrl)+'">';$("#profileNameInput").value=user.name||"";$("#profileGradeInput").value=user.grade||"";$("#profilePhoneInput").value=user.phone||"";
profileForm.addEventListener("submit",async(event)=>{event.preventDefault();if(!apiEnabled)return showFormNotice(profileForm,"شغّل الخادم لتعديل بيانات الحساب.",false);try{let avatarUrl=user.avatarUrl||"";const avatarFile=$("#profileAvatarInput")?.files?.[0];if(avatarFile){if(!["image/jpeg","image/png","image/webp"].includes(avatarFile.type)||avatarFile.size>8_000_000)throw new Error("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 8 ميغابايت.");const kind="avatar";const uploaded=await apiRequest("/uploads",{method:"POST",headers:{"X-Upload-Kind":kind},body:JSON.stringify({fileName:avatarFile.name,dataUrl:await fileToDataUrl(avatarFile),kind})});avatarUrl=uploaded.url;}const {user:updated}=await apiRequest("/me",{method:"PATCH",body:JSON.stringify({name:$("#profileNameInput").value.trim(),grade:$("#profileGradeInput").value,phone:$("#profilePhoneInput").value.trim(),avatarUrl})});storage.set("ameen-session",updated);$("#profileName").textContent=updated.name;$("#profileAvatar").textContent=updated.name.charAt(0);if(updated.avatarUrl)$("#profileAvatar").innerHTML='<img alt="صورة الحساب" src="'+escapeHtml(updated.avatarUrl)+'">';showFormNotice(profileForm,"تم حفظ تعديلات الملف الشخصي.");}catch(error){showFormNotice(profileForm,error.message,false);}});
if(apiEnabled){const section=document.createElement("section");section.className="section";section.innerHTML='<form class="content-card form-wrap" id="passwordForm"><h2>تغيير كلمة المرور</h2><div class="notice"></div><label class="field"><span>كلمة المرور الحالية</span><input required name="currentPassword" type="password"></label><label class="field"><span>كلمة المرور الجديدة</span><input required name="newPassword" type="password" minlength="8"></label><button class="btn btn-secondary" type="submit">تغيير كلمة المرور</button><button class="btn btn-soft" id="logoutButton" type="button">تسجيل الخروج</button></form>';profileForm.closest(".admin-layout").after(section);$("#passwordForm",section).addEventListener("submit",async(event)=>{event.preventDefault();try{await apiRequest("/me/password",{method:"PATCH",body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))});showFormNotice(event.currentTarget,"تم تغيير كلمة المرور.");}catch(error){showFormNotice(event.currentTarget,error.message,false);}});$("#logoutButton",section).addEventListener("click",()=>{apiRequest("/auth/logout",{method:"POST"}).finally(()=>{storage.set("ameen-token","");storage.set("ameen-session",null);location.href="index.html";});});}}if (registerForm && !registerForm.querySelector('[name="phone"]')) {
  const phoneField = document.createElement("label");
  phoneField.className = "field";
  phoneField.innerHTML = '<span>رقم الهاتف</span><input required name="phone" inputmode="tel" placeholder="01xxxxxxxxx">';
  registerForm.querySelector('[name="grade"]').closest("label").before(phoneField);
}

async function renderStudentProgress(){
  const table=$("#studentsTable");if(!table)return;
  try{
    const {students,averageScore,completedLessons}=await apiRequest("/student-progress");
    $("#studentCount").textContent=students.length;
    $("#averageScore").textContent=averageScore===null?"—":averageScore+"%";
    $("#savedCount").textContent=completedLessons;
    table.innerHTML=students.length?students.map(student=>{
      const active=Boolean(student.active);
      const action=active?"ban":"unban";
      const label=active?"Ban":"Unban";
      return '<tr><td>'+escapeHtml(student.name)+'</td><td>'+escapeHtml(student.grade||"—")+'</td><td>'+(student.lastAttempt?student.lastAttempt.score+'/'+student.lastAttempt.total:'—')+'</td><td><span class="status-pill">'+(active?'نشط':'محظور')+'</span> <button class="btn btn-soft" type="button" data-student-action="'+action+'" data-student-id="'+escapeHtml(student.id)+'">'+label+'</button></td></tr>';
    }).join(''):'<tr><td colspan="4">لا توجد بيانات طلاب مرتبطة بكورساتك حتى الآن.</td></tr>';
  }catch(error){table.innerHTML='<tr><td colspan="4">'+escapeHtml(error.message)+'</td></tr>';}
}
$("#studentsTable")?.addEventListener("click",async(event)=>{
  const button=event.target.closest("[data-student-action]");if(!button)return;
  button.disabled=true;
  try{
    await apiRequest("/students/"+encodeURIComponent(button.dataset.studentId)+"/"+button.dataset.studentAction,{method:"POST"});
    await renderStudentProgress();
  }catch(error){button.disabled=false;button.textContent=error.message;}
});
renderStudentProgress();
if(apiEnabled&&storage.get("ameen-session",null)?.role==="admin")apiRequest("/admin/stats").then(({stats})=>{if($("#adminCourseCount"))$("#adminCourseCount").textContent=stats.courses;if($("#adminStudentCount"))$("#adminStudentCount").textContent=stats.students;if($("#adminExamCount"))$("#adminExamCount").textContent=stats.attempts;}).catch(()=>{});
function fileToDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); }

async function uploadLessonFile(file, kind) { return apiRequest("/uploads", { method: "POST", headers: { "X-Upload-Kind": kind }, body: JSON.stringify({ fileName: file.name, dataUrl: await fileToDataUrl(file), kind }) }); }
const lessonForm = $("#lessonForm");
if(lessonForm){const courseSelect=$("#lessonCourseSelect"),lessonSelect=$("#lessonSelect"),params=new URLSearchParams(location.search),courseParam=params.get("course"),lessonParam=params.get("lesson"),titleField=lessonForm.querySelector('[name="title"]'),videoInput=$("#lessonVideo"),videoUrlField=$("#lessonVideoUrl"),pdfInput=$("#lessonPdf"),deleteButton=$("#deleteLessonButton");
const session=storage.get("ameen-session",null);if(!session||!["teacher","admin"].includes(session.role))location.replace("login.html?next=create-lesson.html");
async function loadLessonOptions(){try{const {courses}=await apiRequest("/courses");const owned=courses.filter(c=>session.role==="admin"||c.ownerId===session.id);courseSelect.innerHTML=owned.map(c=>'<option value="'+escapeHtml(c.id)+'">'+escapeHtml(c.title)+'</option>').join("");if(courseParam)courseSelect.value=courseParam;await refreshLessons();}catch(error){showFormNotice(lessonForm,error.message,false);}}
async function refreshLessons(){if(!courseSelect.value)return;const {lessons}=await apiRequest("/courses/"+encodeURIComponent(courseSelect.value)+"/lessons");lessonSelect.innerHTML='<option value="">إضافة محاضرة جديدة</option>'+lessons.map(l=>'<option value="'+escapeHtml(l.id)+'">'+escapeHtml(l.title)+'</option>').join("");if(lessonParam)lessonSelect.value=lessonParam;loadSelectedLesson();}
function renderLessonQuizEditor(questions=[]){const host=$("#lessonQuizQuestions");if(!host)return;host.innerHTML=questions.map((q,i)=>lessonQuestionEditorHtml(q,i)).join("");}
function lessonQuestionEditorHtml(q={},index=0){const options=Array.isArray(q.options)?q.options:[];return '<div class="content-card lesson-quiz-editor" style="margin:12px 0;padding:16px"><div class="form-grid"><label class="field"><span>السؤال '+(index+1)+'</span><input required maxlength="1000" data-question placeholder="اكتب السؤال" value="'+escapeHtml(q.question||q.prompt||'')+'"></label><label class="field"><span>الإجابة الصحيحة</span><select data-answer>'+[0,1,2,3].map(i=>'<option value="'+i+'" '+(Number(q.answer??q.answerIndex)===i?'selected':'')+'>الاختيار '+(i+1)+'</option>').join('')+'</select></label></div>'+Array.from({length:4},(_,i)=>'<label class="field"><span>الاختيار '+(i+1)+'</span><input maxlength="300" data-option placeholder="'+(i<2?'مطلوب':'اختياري')+'" value="'+escapeHtml(options[i]||'')+'"></label>').join('')+'<button class="btn btn-soft" type="button" data-remove-question>حذف السؤال</button></div>';}
function loadSelectedLesson(){const selected=lessonSelect.value;deleteButton.hidden=!selected;if(!selected){titleField.value="";videoInput.value="";videoUrlField.value="";pdfInput.value="";videoInput.dataset.current="";pdfInput.dataset.current="";renderLessonQuizEditor();return;}apiRequest("/lessons/"+encodeURIComponent(selected)).then(({lesson})=>{titleField.value=lesson.title;lessonForm.querySelector('[name="maxViews"]').value=lesson.maxViews||3;lessonForm.querySelector('[name="isFree"]').value=String(Boolean(lesson.isFree));videoInput.dataset.current=lesson.videoUrl;videoUrlField.value=lesson.videoUrl.startsWith("/uploads/")?"":lesson.videoUrl;pdfInput.dataset.current=lesson.pdfUrl;renderLessonQuizEditor(lesson.questions||[]);showFormNotice(lessonForm,"اترك خانة الملف فارغة للاحتفاظ بالملف الحالي.");}).catch(error=>showFormNotice(lessonForm,error.message,false));}
courseSelect.addEventListener("change",()=>{lessonParam=null;refreshLessons();});lessonSelect.addEventListener("change",loadSelectedLesson);deleteButton?.addEventListener("click",async()=>{if(!confirm("هل تريد حذف هذه المحاضرة؟"))return;try{await apiRequest("/lessons/"+encodeURIComponent(lessonSelect.value),{method:"DELETE"});showFormNotice(lessonForm,"تم حذف المحاضرة.");lessonSelect.value="";loadSelectedLesson();await refreshLessons();}catch(error){showFormNotice(lessonForm,error.message,false);}});
$("#lessonAddQuestion")?.addEventListener("click",()=>{const host=$("#lessonQuizQuestions");if(host.children.length>=30)return showFormNotice(lessonForm,"الحد الأقصى 30 سؤالاً.",false);host.insertAdjacentHTML("beforeend",lessonQuestionEditorHtml({},host.children.length));});
$("#lessonQuizQuestions")?.addEventListener("click",event=>{if(event.target.closest("[data-remove-question]")){event.target.closest(".lesson-quiz-editor").remove();[...$("#lessonQuizQuestions").children].forEach((card,i)=>{const label=card.querySelector("[data-question]").closest("label").querySelector("span");label.textContent="السؤال "+(i+1);});}});
lessonForm.addEventListener("submit",async(event)=>{event.preventDefault();const selected=lessonSelect.value,video=videoInput.files[0],pdf=pdfInput.files[0];if(!selected&&!(video||videoUrlField.value.trim()))return showFormNotice(lessonForm,"أدخل رابط فيديو صالحًا أو ارفع ملف فيديو للمحاضرة.",false);try{const questions=[...$("#lessonQuizQuestions").querySelectorAll(".lesson-quiz-editor")].map(card=>{const question=card.querySelector("[data-question]").value.trim(),optionFields=[...card.querySelectorAll("[data-option]")],options=optionFields.map(input=>input.value.trim());while(options.length&&options.at(-1)==="")options.pop();if(options.some(option=>!option))throw new Error("املأ الاختيارات بترتيب متتابع دون ترك فراغ بينها.");const answer=Number(card.querySelector("[data-answer]").value);if(!question||options.length<2||answer>=options.length)throw new Error("كل سؤال يحتاج نصًا واختيارين على الأقل مع تحديد الإجابة الصحيحة.");return{question,options,answer};});showFormNotice(lessonForm,"يجري حفظ المحاضرة ورفع الملفات...");let videoUrl=videoUrlField.value.trim()||videoInput.dataset.current||"",pdfUrl=pdfInput.dataset.current||"";if(video)videoUrl=(await uploadLessonFile(video,"video")).url;if(pdf)pdfUrl=(await uploadLessonFile(pdf,"pdf")).url;const body={title:titleField.value.trim(),maxViews:Number(lessonForm.querySelector('[name="maxViews"]').value),isFree:lessonForm.querySelector('[name="isFree"]').value==="true",questions};if(videoUrl)body.videoUrl=videoUrl;if(pdfUrl)body.pdfUrl=pdfUrl;await apiRequest(selected?"/lessons/"+encodeURIComponent(selected):"/courses/"+encodeURIComponent(courseSelect.value)+"/lessons",{method:selected?"PATCH":"POST",body:JSON.stringify(body)});showFormNotice(lessonForm,"تم حفظ المحاضرة وأسئلتها بنجاح.");await refreshLessons();if(!selected){lessonForm.reset();renderLessonQuizEditor();}}catch(error){showFormNotice(lessonForm,error.message,false);}});
loadLessonOptions();}async function renderLessonViewer(){const main=$("#lessonViewer"),lessonId=new URLSearchParams(location.search).get("lesson");if(!main)return;if(!lessonId){main.innerHTML='<section class="page-heading"><h1>اختر محاضرة من صفحة الكورس</h1><a class="btn btn-primary" href="courses.html">عرض الكورسات</a></section>';return;}try{const meta=await apiRequest("/lessons/"+encodeURIComponent(lessonId)),play=await apiRequest("/lessons/"+encodeURIComponent(lessonId)+"/watch",{method:"POST"}),lesson=meta.lesson;let isEmbed=false;try{const host=new URL(play.videoUrl,location.origin).hostname;isEmbed=host==="www.youtube-nocookie.com"||host==="player.vimeo.com";}catch{}const player=isEmbed?'<iframe id="lessonEmbed" title="فيديو المحاضرة" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" style="display:block;width:100%;aspect-ratio:16/9;border:0;background:#000" src="'+escapeHtml(play.videoUrl)+'"></iframe>':'<video id="lessonVideo" controls playsinline preload="metadata" style="display:block;width:100%;max-height:70vh;background:#000" src="'+escapeHtml(play.videoUrl)+'"></video>';main.innerHTML='<section class="page-heading"><div class="breadcrumbs"><a href="course-details.html?course='+encodeURIComponent(meta.course.id)+'">'+escapeHtml(meta.course.title)+'</a> / المحاضرة</div><h1>'+escapeHtml(lesson.title)+'</h1></section><section class="lesson-layout"><div><div class="video-placeholder" style="padding:0;overflow:hidden">'+player+'</div>'+(play.pdfUrl?'<div class="content-card" style="margin-top:18px"><h2>ملف المحاضرة</h2><a class="btn btn-secondary" href="'+escapeHtml(play.pdfUrl)+'" target="_blank" rel="noopener">فتح ملف PDF</a></div>':'')+'<div class="content-card" style="margin-top:18px"><p class="lead" style="font-size:14px">المشاهدات المتبقية: '+play.viewsRemaining+'</p></div></div><aside class="content-card"><h3>الكورس</h3><a class="btn btn-primary" href="course-details.html?course='+encodeURIComponent(meta.course.id)+'">العودة إلى محتوى الكورس</a></aside></section>';const viewerSession=storage.get("ameen-session",null);if(viewerSession?.role==="student"&&lesson.questions?.length){const quizHtml='<section class="content-card" id="lessonQuiz" style="margin:24px 0"><h2>اختبار المحاضرة</h2><p class="lead" style="font-size:14px">أجب عن جميع الأسئلة لعرض نتيجتك.</p><form id="lessonQuizForm">'+lesson.questions.map((q,i)=>'<fieldset class="content-card" style="margin:12px 0"><legend>'+(i+1)+'. '+escapeHtml(q.question||q.prompt||'')+'</legend>'+(q.options||[]).map((option,j)=>'<label class="field" style="display:block"><input required type="radio" name="lesson-question-'+i+'" value="'+j+'"> '+escapeHtml(option)+'</label>').join('')+'</fieldset>').join('')+'<div class="notice" id="lessonQuizResult" aria-live="polite"></div><button class="btn btn-primary" type="submit">إرسال الإجابات وعرض النتيجة</button></form></section>';main.insertAdjacentHTML("beforeend",quizHtml);const quizForm=$("#lessonQuizForm");quizForm.addEventListener("submit",async event=>{event.preventDefault();if(!quizForm.reportValidity())return;const answers=lesson.questions.map((_,i)=>Number(quizForm.querySelector('input[name="lesson-question-'+i+'"]:checked').value));const button=quizForm.querySelector('button[type="submit"]'),result=$("#lessonQuizResult");button.disabled=true;try{const score=await apiRequest("/lessons/"+encodeURIComponent(lessonId)+"/answers",{method:"POST",body:JSON.stringify({answers})});result.textContent="نتيجتك: "+score.score+" من "+score.total;result.className="notice success";quizForm.querySelectorAll("input").forEach(input=>input.disabled=true);button.hidden=true;}catch(error){result.textContent=error.message;result.className="notice error";button.disabled=false;}});}if(!play.watchId)return;let progressSent=false;const updateProgress=position=>{if(progressSent||position<60)return;progressSent=true;apiRequest("/lessons/"+encodeURIComponent(lessonId)+"/progress",{method:"POST",body:JSON.stringify({position:Math.round(position),watchId:play.watchId})}).catch(()=>{progressSent=false;});};const videoEl=main.querySelector("video");if(videoEl){videoEl.addEventListener("timeupdate",()=>updateProgress(videoEl.currentTime));videoEl.addEventListener("ended",()=>updateProgress(Math.max(60,videoEl.currentTime||60)));}else{const embed=main.querySelector("#lessonEmbed");const origin=new URL(embed.src).origin;if(origin==="https://www.youtube-nocookie.com"){window.addEventListener("message",event=>{if(event.origin!==origin)return;try{const data=typeof event.data==="string"?JSON.parse(event.data):event.data;if(data?.event==="infoDelivery"&&Number(data.info?.currentTime)>=60)updateProgress(data.info.currentTime);}catch{}});embed.addEventListener("load",()=>{try{embed.contentWindow.postMessage(JSON.stringify({event:"listening",id:1}),origin);embed.contentWindow.postMessage(JSON.stringify({event:"command",func:"addEventListener",args:["onStateChange"],id:1}),origin);}catch{}});}else{const script=document.createElement("script");script.src="https://player.vimeo.com/api/player.js";script.onload=()=>{if(!window.Vimeo?.Player)return;const player=new window.Vimeo.Player(embed);player.on("timeupdate",event=>updateProgress(event.seconds));player.on("ended",()=>updateProgress(60));};document.head.appendChild(script);}}}catch(error){main.innerHTML='<section class="page-heading"><h1>تعذر تشغيل المحاضرة</h1><p class="lead">'+escapeHtml(error.message)+'</p><a class="btn btn-secondary" href="courses.html">الكورسات</a></section>';}}
renderLessonViewer();async function renderLessonList(){const list=$("#lessonList"),title=$("#lessonCourseTitle"),courseId=new URLSearchParams(location.search).get("course");if(!list)return;if(!courseId){list.innerHTML='<div class="empty-state" style="display:block">افتح صفحة الكورس لاختيار محاضراته.</div>';return;}try{const [{course},{lessons}]=await Promise.all([apiRequest("/courses/"+encodeURIComponent(courseId)),apiRequest("/courses/"+encodeURIComponent(courseId)+"/lessons")]);title.textContent=course.title;list.innerHTML=lessons.length?lessons.map((l,i)=>'<div class="list-row"><span class="row-icon">▶</span><div class="row-copy"><b>'+String(i+1).padStart(2,"0")+' — '+escapeHtml(l.title)+'</b></div><a class="row-arrow" href="lesson.html?lesson='+encodeURIComponent(l.id)+'">فتح المحاضرة</a></div>').join(''):'<div class="empty-state" style="display:block">لا توجد محاضرات متاحة في هذا الكورس بعد.</div>';}catch(error){list.innerHTML='<div class="empty-state" style="display:block">'+escapeHtml(error.message)+'</div>';}}
renderLessonList();
async function setupExamPage(){const list=$("#examList"),manager=$("#examManager"),panel=$("#examPanel");if(!list)return;const user=storage.get("ameen-session",null),params=new URLSearchParams(location.search),courseParam=params.get("course");let courses=[];try{const result=await apiRequest("/courses");courses=result.courses||[];}catch{}
if(manager&&user&&["teacher","admin"].includes(user.role)){const owned=courses.filter(c=>user.role==="admin"||c.ownerId===user.id);manager.hidden=false;manager.innerHTML='<div class="content-card"><h2 id="examFormHeading">إنشاء امتحان</h2><form id="examForm"><div class="notice"></div><label class="field"><span>الكورس</span><select required name="courseId" id="examCourse"></select></label><label class="field"><span>عنوان الامتحان</span><input required name="title" maxlength="160"></label><label class="field"><span>وصف مختصر</span><textarea name="description" rows="2" maxlength="500"></textarea></label><div id="examQuestions"></div><button class="btn btn-soft" id="addExamQuestion" type="button">إضافة سؤال</button> <button class="btn btn-primary" type="submit">حفظ الامتحان</button><button class="btn btn-soft" id="cancelExamEdit" type="button" hidden>إلغاء التعديل</button></form></div>';const select=$("#examCourse"),form=$("#examForm"),qbox=$("#examQuestions"),courseIdField=courseParam&&owned.some(c=>c.id===courseParam)?courseParam:"";select.innerHTML=owned.map(c=>'<option value="'+escapeHtml(c.id)+'">'+escapeHtml(c.title)+'</option>').join('');if(courseIdField)select.value=courseIdField;let editing="";
function addQuestion(q={}){const index=qbox.children.length,card=document.createElement("fieldset");card.className="quiz-question exam-question-editor";card.dataset.image=q.imageUrl||"";card.innerHTML='<legend>السؤال '+(index+1)+'</legend><label class="field"><span>نص السؤال</span><textarea data-prompt rows="2" placeholder="اكتب السؤال أو أرفق صورة له"></textarea></label><label class="field"><span>صورة السؤال (مطلوبة)</span><input data-image type="file" accept="image/png,image/jpeg,image/webp"></label><div class="form-grid">'+[0,1,2,3].map(i=>'<label class="field"><span>الاختيار '+(i+1)+'</span><input data-option="'+i+'" required></label>').join('')+'</div><label class="field"><span>الإجابة الصحيحة</span><select data-answer>'+[0,1,2,3].map(i=>'<option value="'+i+'">الاختيار '+(i+1)+'</option>').join('')+'</select></label><button class="btn btn-soft" data-remove type="button">حذف السؤال</button>';qbox.appendChild(card);card.querySelector('[data-prompt]').value=q.prompt||"";(q.options||[]).forEach((v,i)=>{const f=card.querySelector('[data-option="'+i+'"]');if(f)f.value=v;});card.querySelector('[data-answer]').value=String(q.answerIndex||0);card.querySelector('[data-remove]').addEventListener('click',()=>{card.remove();Array.from(qbox.children).forEach((el,i)=>el.querySelector('legend').textContent='السؤال '+(i+1));});}
function resetExam(){editing="";form.reset();qbox.innerHTML="";addQuestion();$("#examFormHeading").textContent="إنشاء امتحان";$("#cancelExamEdit").hidden=true;}
function beginEdit(exam){editing=exam.id;$("#examFormHeading").textContent="تعديل الامتحان";select.value=exam.courseId;form.querySelector('[name="title"]').value=exam.title;form.querySelector('[name="description"]').value=exam.description||"";qbox.innerHTML="";exam.questions.forEach(addQuestion);$("#cancelExamEdit").hidden=false;form.scrollIntoView({behavior:"smooth"});}
$("#addExamQuestion").addEventListener("click",()=>addQuestion());$("#cancelExamEdit").addEventListener("click",resetExam);
form.addEventListener("submit",async(event)=>{event.preventDefault();try{const questions=[];for(const card of qbox.children){const file=card.querySelector('[data-image]').files[0];let imageUrl=card.dataset.image||"";if(file)imageUrl=(await uploadLessonFile(file,"question-image")).url;questions.push({prompt:card.querySelector('[data-prompt]').value.trim(),imageUrl,options:Array.from(card.querySelectorAll('[data-option]')).map(input=>input.value.trim()).filter(Boolean),answerIndex:Number(card.querySelector('[data-answer]').value)});}const body={courseId:select.value,title:form.querySelector('[name="title"]').value.trim(),description:form.querySelector('[name="description"]').value.trim(),questions};if(editing)await apiRequest("/exams/"+encodeURIComponent(editing),{method:"PATCH",body:JSON.stringify(body)});else await apiRequest("/courses/"+encodeURIComponent(select.value)+"/exams",{method:"POST",body:JSON.stringify(body)});showFormNotice(form,"تم حفظ الامتحان.");resetExam();loadExams();}catch(error){showFormNotice(form,error.message,false);}});
}
async function loadExams(){try{const url=courseParam?"/exams?course="+encodeURIComponent(courseParam):"/exams",{exams}=await apiRequest(url);list.innerHTML=exams.length?exams.map(exam=>'<article class="feature-card"><span class="pill">'+exam.questions.length+' سؤال · '+escapeHtml(exam.courseTitle||"")+'</span><h3>'+escapeHtml(exam.title)+'</h3><p>'+escapeHtml(exam.description||"")+'</p><button class="btn btn-primary" data-start-exam="'+escapeHtml(exam.id)+'">ابدأ الامتحان</button>'+(user&&["admin","teacher"].includes(user.role)?'<button class="btn btn-soft" data-edit-exam="'+escapeHtml(exam.id)+'">تعديل</button> <button class="btn btn-soft" data-delete-exam="'+escapeHtml(exam.id)+'">حذف</button>':'')+'</article>').join(''):'<div class="empty-state" style="display:block">لا توجد امتحانات منشورة لهذا الكورس حتى الآن.</div>';exams.forEach(exam=>{const start=list.querySelector('[data-start-exam="'+exam.id+'"]');start?.addEventListener('click',()=>{panel.hidden=false;panel.innerHTML='<h2>'+escapeHtml(exam.title)+'</h2><form id="takeExam">'+exam.questions.map((q,i)=>'<fieldset class="quiz-question"><legend>'+escapeHtml(q.prompt||('السؤال '+(i+1)))+'</legend>'+(q.imageUrl?'<img alt="صورة السؤال" src="'+escapeHtml(q.imageUrl)+'" style="max-width:100%;max-height:360px;object-fit:contain">':'')+q.options.map((option,n)=>'<label class="quiz-option"><input required type="radio" name="q'+i+'" value="'+n+'"> '+escapeHtml(option)+'</label>').join('')+'</fieldset>').join('')+'<button class="btn btn-primary" type="submit">إرسال الإجابات</button><div class="notice"></div></form>';const f=$("#takeExam",panel);f.addEventListener("submit",async(event)=>{event.preventDefault();try{const answers=exam.questions.map((_,i)=>Number(new FormData(f).get('q'+i))),result=await apiRequest('/exams/'+encodeURIComponent(exam.id)+'/submit',{method:'POST',body:JSON.stringify({answers})});showFormNotice(f,'نتيجتك: '+result.score+' من '+result.total);}catch(error){showFormNotice(f,error.message,false);}});panel.scrollIntoView({behavior:'smooth'});});const edit=list.querySelector('[data-edit-exam="'+exam.id+'"]');edit?.addEventListener('click',()=>beginEdit(exam));const del=list.querySelector('[data-delete-exam="'+exam.id+'"]');del?.addEventListener('click',async()=>{if(confirm('هل تريد حذف هذا الامتحان؟'))try{await apiRequest('/exams/'+encodeURIComponent(exam.id),{method:'DELETE'});loadExams();}catch(error){alert(error.message);}});});}catch(error){list.innerHTML='<div class="empty-state" style="display:block">'+escapeHtml(error.message)+' · <a href="login.html">تسجيل الدخول</a></div>';}}
loadExams();}
setupExamPage();const contactForm = $("#contactForm");
contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!apiEnabled) return showFormNotice(contactForm, "شغّل المنصة من خلال الخادم أولاً.", false);
  apiRequest("/contact", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(contactForm))) }).then((result) => { showFormNotice(contactForm, result.message); contactForm.reset(); }).catch((cause) => showFormNotice(contactForm, cause.message, false));
});

const enrollCourseForm = $("#enrollCourseForm");
enrollCourseForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(enrollCourseForm);
  if (!apiEnabled) return showFormNotice(enrollCourseForm, "شغّل المنصة من خلال الخادم أولاً.", false);
  apiRequest(`/courses/${data.get("courseId")}/enroll`, { method: "POST", body: JSON.stringify({ code: data.get("code") }) }).then(() => showFormNotice(enrollCourseForm, "تم الدخول إلى الكورس بنجاح.")).catch((cause) => showFormNotice(enrollCourseForm, cause.message, false));
});

async function addAdminControls() {
  if (!apiEnabled || !$(".admin-actions")) return;
  try {
    const { users } = await apiRequest("/admin/users");
    const section = document.createElement("section");
    section.className = "section";
    section.innerHTML = `<div class="content-card"><h2>إدارة الحسابات</h2><div id="remoteUsers"></div></div>`;
    $(".admin-actions").closest(".section").after(section);
    const usersBox = $("#remoteUsers");
    usersBox.innerHTML = users.map((user) => `<div class="list-row" data-user-id="${user.id}"><div class="row-copy"><b>${escapeHtml(user.name)}</b><small>${escapeHtml(user.email)} · ${escapeHtml(user.grade || "بدون مرحلة")}</small></div><select class="filter-select"><option value="student" ${user.role === "student" ? "selected" : ""}>طالب</option><option value="teacher" ${user.role === "teacher" ? "selected" : ""}>مدرس</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>أدمن</option></select><button class="btn btn-soft" data-save type="button">حفظ</button><button class="btn btn-soft" data-reset type="button">إعادة كلمة المرور</button></div>`).join("");
    $$(".list-row", usersBox).forEach((row) => row.querySelector("[data-save]").addEventListener("click", async () => {
      try { await apiRequest(`/admin/users/${row.dataset.userId}`, { method: "PATCH", body: JSON.stringify({ role: row.querySelector("select").value }) }); row.querySelector("button").textContent = "تم"; } catch (cause) { alert(cause.message); }
    }));
    $$("[data-reset]", usersBox).forEach((button) => button.addEventListener("click", async () => { const password = prompt("أدخل كلمة مرور مؤقتة من 8 أحرف على الأقل:"); if (!password) return; try { await apiRequest(`/admin/users/${button.closest("[data-user-id]").dataset.userId}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword: password }) }); alert("تم تعيين كلمة المرور المؤقتة."); } catch (cause) { alert(cause.message); } }));
  } catch (cause) {}
}
addAdminControls();
async function renderContactInbox(){const user=storage.get("ameen-session",null);if(!apiEnabled||user?.role!=="admin"||!$(".admin-actions"))return;try{const {messages}=await apiRequest("/admin/contact-messages");const section=document.createElement("section");section.className="section";section.innerHTML='<div class="section-head"><div><span class="eyebrow">الوارد</span><h2>رسائل التواصل</h2></div></div><div class="content-card" id="contactInbox"></div>';$(".admin-actions").closest(".section").after(section);const box=$("#contactInbox");box.innerHTML=messages.length?messages.map(m=>'<article class="list-row"><div class="row-copy"><b>'+escapeHtml(m.subject||"استفسار")+' · '+escapeHtml(m.name)+'</b><small>'+escapeHtml(m.email)+' · '+new Date(m.createdAt).toLocaleString("ar-EG")+'</small><p>'+escapeHtml(m.message)+'</p></div></article>').join(''):'<div class="empty-state" style="display:block">لا توجد رسائل واردة.</div>';}catch(error){}}
renderContactInbox();

async function renderCourseRequests() {
  let box = $("#courseRequests");
  if (!box && PAGE === "admin.html") { const section = document.createElement("section"); section.className = "section"; section.innerHTML = '<div class="section-head"><div><span class="eyebrow">طلبات الكورسات</span><h2>طلبات الالتحاق</h2></div></div><div class="content-card" id="courseRequests"></div>'; $("main.container")?.appendChild(section); box = $("#courseRequests"); }
  if (!box || !apiEnabled) return;
  try {
    const { requests } = await apiRequest("/course-requests");
    if (!requests.length) { box.innerHTML = '<div class="empty-state" style="display:block">لا توجد طلبات كورسات حالياً.</div>'; return; }
    box.innerHTML = requests.map((request) => `<div class="list-row" data-request-id="${request.id}"><div class="row-copy"><b>${escapeHtml(request.course?.title || "كورس محذوف")}</b><small>${escapeHtml(request.student?.name || "طالب") } · ${escapeHtml(request.phone)} · ${escapeHtml(request.student?.grade || "") }<br>كود الكورس: ${escapeHtml(request.course?.accessCode || "—")} · كود الطلب: ${escapeHtml(request.requestCode)} · الحالة: ${request.status === "pending" ? "بانتظار الموافقة" : request.status === "approved" ? "مقبول" : "مرفوض"}</small></div>${request.status === "pending" ? '<div><button class="btn btn-primary" data-action="approve" type="button">قبول</button> <button class="btn btn-soft" data-action="reject" type="button">رفض</button></div>' : ""}</div>`).join("");
    $$('[data-action]', box).forEach((button) => button.addEventListener("click", async () => { const row = button.closest("[data-request-id]"); try { await apiRequest(`/course-requests/${row.dataset.requestId}/${button.dataset.action}`, { method: "POST" }); renderCourseRequests(); } catch (cause) { alert(cause.message); } }));
  } catch (cause) { box.innerHTML = '<div class="empty-state" style="display:block">تعذر تحميل الطلبات.</div>'; }
}
renderCourseRequests();

const resetForm = $("#resetPasswordForm");
resetForm?.addEventListener("submit", (event) => { event.preventDefault(); apiRequest("/auth/password-reset-request", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(resetForm))) }).then((result) => showFormNotice(resetForm, result.message)).catch((cause) => showFormNotice(resetForm, cause.message, false)); });

async function renderCertificate() {
  const box = $("#certificateBox"); const courseId = new URLSearchParams(location.search).get("course"); if (!box || !courseId || !apiEnabled) return;
  try { const { certificate } = await apiRequest(`/courses/${courseId}/certificate`); box.innerHTML = `<div style="text-align:center;padding:34px"><span class="brand-icon">🎓</span><h2>شهادة إتمام</h2><p>تشهد منصة مستر حسام أمين بأن الطالب</p><h1>${escapeHtml(certificate.studentName)}</h1><p>أتم بنجاح كورس <b>${escapeHtml(certificate.courseTitle)}</b></p><p>رقم الشهادة: ${escapeHtml(certificate.number)}</p><button class="btn btn-primary" type="button" onclick="window.print()">طباعة الشهادة</button></div>`; } catch (cause) { box.innerHTML = `<p>${escapeHtml(cause.message)}</p>`; }
}
renderCertificate();




























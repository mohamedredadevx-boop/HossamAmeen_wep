# دليل تجهيز المنصة للرفع إلى Contabo

هذه الحزمة تحتوي ملفات التطبيق ولقطة SQLite من قاعدة المعاينة الحالية ومرفقاتها. لا تحتوي على ملف `.env` أو `node_modules` أو ملفات السجل. شغّلها على VPS واحد بنظام Linux؛ قاعدة البيانات SQLite وتحتاج إلى نسخة واحدة من التطبيق فقط.

## قبل الرفع

1. جهّز نطاقًا يشير إلى عنوان VPS، وثبّت Ubuntu LTS وNode.js 24 وNginx وClamAV. فعّل HTTPS بشهادة صالحة قبل استقبال تسجيلات الطلاب. تحقق من `clamscan --version` وحدّث قواعد الفحص دوريًا.
2. أنشئ مستخدم Linux مخصصًا للتطبيق ومجلدات دائمة خارج مجلد إصدار التطبيق:

```sh
sudo useradd --system --home /opt/ameen --shell /usr/sbin/nologin ameen
sudo mkdir -p /opt/ameen/app /var/lib/ameen-learning-platform/data /var/lib/ameen-learning-platform/uploads
sudo chown -R ameen:ameen /opt/ameen /var/lib/ameen-learning-platform
```

3. ارفع ZIP وفكّه في `/opt/ameen/app`. انقل قاعدة البيانات والمرفقات المرفقة إلى المسارات الدائمة. إذا كانت هناك قاعدة إنتاج سابقة، خذ نسخة احتياطية منها أولًا ولا تستبدلها بهذه اللقطة:

```sh
sudo install -o ameen -g ameen -m 0600 /opt/ameen/app/data/ameen.sqlite /var/lib/ameen-learning-platform/data/ameen.sqlite
sudo -u ameen cp -a /opt/ameen/app/uploads/. /var/lib/ameen-learning-platform/uploads/
```

تأكد أن ملف القاعدة هو `/var/lib/ameen-learning-platform/data/ameen.sqlite` وأن المرفقات موجودة في مجلد `uploads` الدائم.

## إعداد الإنتاج وحساب المدير

انسخ `.env.example` إلى ملف إعداد خارج مجلد التطبيق، مثل `/etc/ameen-learning-platform.env`، وعدّل القيم. لا ترفع ملف الأسرار داخل ZIP أو Git.

```env
NODE_ENV=production
HOST=127.0.0.1
TRUST_PROXY=true
PORT=3000
SITE_URL=https://نطاقك.example
SESSION_SECRET=سر_عشوائي_فريد_بطول_48_بايتًا_على_الأقل
ADMIN_EMAIL=admainMain1@gmail.com
ADMIN_PASSWORD=كلمة_مرور_قوية_فريدة_14_محرفًا_على_الأقل
AMEEN_DATA_DIR=/var/lib/ameen-learning-platform/data
AMEEN_UPLOAD_DIR=/var/lib/ameen-learning-platform/uploads
AV_SCAN_REQUIRED=true
CLAMSCAN_PATH=/usr/bin/clamscan
```

لأن قاعدة البيانات تحتوي حساب مدير موجودًا، اضبط في **أول تشغيل فقط** `RESET_ADMIN_PASSWORD=true` و`ADMIN_RESET_PASSWORD` على كلمة المرور القوية نفسها الموضوعة في `ADMIN_PASSWORD`. عند نجاح تشغيل الخادم وتسجيل الدخول، احذف `RESET_ADMIN_PASSWORD` و`ADMIN_RESET_PASSWORD` من ملف الإعداد ثم أعد تشغيل الخدمة. لا تترك خيار إعادة التعيين مفعّلًا.

قاعدة المعاينة المحلية تستخدم بريد المدير `admin@ameen.local` وملف `run-local-server.bat` للاختبار فقط. عند إعداد الإنتاج، يغيّر الخادم بريد المدير الوحيد إلى `ADMIN_EMAIL` إذا لزم الأمر، ثم يطبق إعادة التعيين لمرة واحدة أعلاه. لا تنسخ إعدادات ملف BAT إلى الخدمة على VPS.

ضع صلاحيات قراءة ملف الإعداد للمالك فقط، واجعل مستخدم الخدمة قادرًا على الكتابة في مجلدي البيانات والمرفقات دون السماح له بتعديل ملفات التطبيق.

## تثبيت الخدمة وNginx

داخل مجلد التطبيق نفّذ:

```sh
sudo -u ameen npm ci --omit=dev
sudo -u ameen npm test
```

استخدم قالب الخدمة `deploy/ameen-learning-platform.service.example` بعد التحقق من مسار Node.js، ثم فعّلها بـ `systemctl daemon-reload` و`systemctl enable --now ameen-learning-platform`. اجعل الخادم يستمع على `127.0.0.1:3000` فقط. استخدم `deploy/nginx-site.conf.example` بعد استبدال النطاق ومسارات الشهادة، ثم تحقّق بـ `nginx -t` وأعد تحميل Nginx.

في إعداد Nginx، فعّل شهادة HTTPS واضبط تمرير الطلبات إلى `http://127.0.0.1:3000`. أضف على الأقل:

```nginx
client_max_body_size 70m;
add_header Strict-Transport-Security "max-age=31536000" always;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
```

افتح في جدار الحماية منافذ SSH وHTTP وHTTPS فقط؛ لا تفتح 3000 للإنترنت. `TRUST_PROXY=true` يفترض أن Nginx يضيف عنوان العميل الحقيقي في نهاية `X-Forwarded-For`.

## استقبال حسابات الطلاب والمدرسين والبيانات

- التسجيل العام ينشئ حسابات طلاب. لا تمنح صلاحية المدرس من التسجيل العام؛ يغيّر المدير دور الحساب من لوحة الإدارة.
- قاعدة SQLite مناسبة لنسخة تطبيق واحدة على VPS واحد. لا تشغّل أكثر من نسخة متصلة بالملف نفسه.
- أوقف الخدمة مؤقتًا لضمان اتساق قاعدة البيانات والمرفقات، ثم أنشئ نسخة احتياطية في وجهة مشفرة وخارج VPS واختبر استعادتها في مجلد مؤقت:

```sh
sudo systemctl stop ameen-learning-platform
sudo node /opt/ameen/app/scripts/backup-data.js --database /var/lib/ameen-learning-platform/data/ameen.sqlite --uploads /var/lib/ameen-learning-platform/uploads --destination /mnt/encrypted-backups/ameen
sudo systemctl start ameen-learning-platform
sudo node /opt/ameen/app/scripts/verify-backup.js /mnt/encrypted-backups/ameen/ameen-backup-2026-10-23T20-30-00-000Z
```

استبدل مسار المثال في الأمر الأخير بالمسار الذي طبعه أمر النسخ الأول. تحقق أن الأمر يعرض نجاح تمرين الاستعادة؛ فهو يستعيد النسخة في مجلد مؤقت ولا يستبدل قاعدة الإنتاج. لا تعتمد على Snapshot الخادم كنسخة وحيدة لبيانات الطلاب.
- إعداد البريد اختياري؛ من دونه تُحفظ طلبات استعادة كلمة المرور داخل لوحة الإدارة بدل إرسالها بالبريد.
- الدفع غير مفعّل حتى تضبط قيم FawryPay الحقيقية الثلاثة وتختبر دورة الدفع وإشعار HTTPS. لا تستخدم بيانات اختبارية في الإنتاج.
- يُرفض أي رفع في الإنتاج ما لم يُرجع ClamAV نتيجة نظيفة؛ إذا كان الفاحص غير متاح أو انتهت مهلة الفحص، لا يُحفظ الملف وتُعاد رسالة خطأ للعميل. حدّث قاعدة توقيعات ClamAV باستمرار.

هذه الحزمة جاهزة للرفع بعد استكمال النطاق وأسرار الإنتاج وبيئة VPS؛ إنشاء خادم Contabo وربط النطاق وتفعيل HTTPS خطوات تتم في حساب الاستضافة ولا ينفذها هذا الملف.

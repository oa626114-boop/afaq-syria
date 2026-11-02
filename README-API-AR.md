# AFAQ SYRIA — حزمة الموقع وربط API

## الملفات
- `index.html`: الموقع الأصلي مع إضافة لوحة إعداد عنوان API واختبار الاتصال ومزامنة السجلات.
- `worker.js`: Cloudflare Worker؛ نقاط الصحة، مزامنة بيانات الموقع إلى D1، إنشاء فاتورة NOWPayments، واستقبال IPN والتحقق من HMAC-SHA512.
- `schema.sql`: مخطط قاعدة البيانات.

## النشر خطوة بخطوة
1. ارفع `index.html` إلى مستودع GitHub Pages مكان `index.html` الحالي.
2. أنشئ Cloudflare D1 Database باسم `afaq-db` ونفّذ محتوى `schema.sql` عليها.
3. أنشئ Worker جديداً، الصق `worker.js`، واربط D1 binding بالاسم `DB`.
4. أضف Worker Secrets: `NOWPAYMENTS_API_KEY` و`NOWPAYMENTS_IPN_SECRET`. لا تضعهما في HTML أو GitHub.
5. عيّن متغير `ALLOWED_ORIGIN` إلى رابط موقعك الدقيق، مثال `https://YOUR-USER.github.io` (بدون شرطة أخيرة).
6. اربط Worker بعنوان API ثابت على نفس النطاق إن أمكن، أو اسمح بعنوان الموقع في CORS. احمِ مسارات `/api/v1/*` بسياسة Cloudflare Access. لا تحمِ `/health` أو `/api/payment/ipn` أو `/api/payment/create` بسياسة تتطلب تسجيل دخول؛ مسار IPN يجب أن يكون عاماً حتى يصل إشعار NOWPayments.
7. في إعدادات NOWPayments ضع IPN callback URL: `https://YOUR-API-DOMAIN/api/payment/ipn`. أنشئ/استخدم مفتاح IPN Secret نفسه في Cloudflare.
8. افتح الموقع > مركز API والتكاملات، أدخل عنوان Worker واضغط «حفظ العنوان» ثم «اختبار الاتصال». بعد ذلك اضغط «مزامنة البيانات».

## واجهات API
- `GET /health` — فحص الخدمة.
- `POST /api/v1/sync` — مزامنة مجموعات البيانات إلى D1 (يجب حمايته عبر Cloudflare Access).
- `GET /api/v1/records` أو `GET /api/v1/records?type=projects` — قراءة السجلات (Access).
- `GET /api/v1/payments` — سجل الفواتير (Access).
- `POST /api/payment/create` — إنشاء فاتورة NOWPayments. JSON: `{ "amount": 25, "currency": "usd", "pay_currency": "usdttrc20", "description": "AFAQ invoice" }`. يرجع `invoice_url` و`order_id`.
- `POST /api/payment/ipn` — إشعارات NOWPayments والتحقق من التوقيع.

## حدود مهمة قبل التشغيل الفعلي
- عنوان Worker الفعلي، إعداد D1، أسرار NOWPayments، وسياسة Cloudflare Access يجب إعدادها في حسابك؛ لم تُنشأ هذه الموارد من داخل الملف.
- هذا الإصدار يزامن مجموعات بيانات الواجهة الحالية إلى D1، لكنه لا يحوّل الموقع إلى نظام مستخدمين وصلاحيات متعدد الحسابات. أضف تسجيل دخول وصلاحيات قبل فتح لوحة الإدارة للعامة.
- لا تعتبر الفاتورة مدفوعة من رابط العودة أو من واجهة المتصفح؛ اعتمد فقط على IPN صالح، ويفضل الاستعلام عن حالة الدفع من NOWPayments قبل تسليم الخدمة.
- `success_url` و`cancel_url` اختياريان. اختبر أولاً في بيئة NOWPayments التجريبية إن كانت مفعلة لحسابك.
- لا يوجد تنفيذ تداول أسهم أو تحويلات مصرفية في هذه الحزمة. شاشة الأسهم الحالية للعرض/تسجيل الطلبات فقط.

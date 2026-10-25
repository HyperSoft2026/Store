# Store

متجر رقمي باللغة العربية العراقية، مبني باستخدام Node.js وExpress وPostgreSQL، ومهيأ للنشر على Clever Cloud.

## التشغيل

```bash
npm install
npm start
```

## متغيرات البيئة

- `PORT`: يحددها Clever Cloud تلقائياً.
- `POSTGRESQL_ADDON_URI`: رابط اتصال PostgreSQL المقدم من Clever Cloud.
- `STORE_NAME`: اسم المتجر (الافتراضي `Store`).
- `STORE_LOGO`: مسار الشعار (الافتراضي `/Logo.png`).
- `STORE_LINK`: الرابط العام للمتجر.

عند التشغيل ينشئ التطبيق جداول قاعدة البيانات المطلوبة تلقائياً إذا كان الاتصال متاحاً.

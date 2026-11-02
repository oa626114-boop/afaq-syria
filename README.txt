AFAQ SYRIA — Business Platform Starter

Files:
- index.html: responsive Arabic RTL business dashboard and app shell
- manifest.webmanifest: installable PWA metadata
- sw.js: basic offline shell cache
- icon.svg: application icon

Deploy:
1. Upload all files to the root of the GitHub Pages repository.
2. Ensure index.html is in the published root folder.
3. Open the published website in Chrome on Android.
4. Use browser menu > Install app / Add to Home screen when available.

Important prototype limitations:
- Records are stored only in this browser using localStorage.
- There is no real login, server-side database, role enforcement, document storage, audit log, or payment processing yet.
- Do not use this prototype for real customer data, confidential documents, or money collection.
- Before production, connect a secure backend/database, authentication and authorization, backups, audit logging, and a compliant payment provider. Never put API secrets in browser code.

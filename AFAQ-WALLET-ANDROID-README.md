# AFAQ WALLET — Android APK wrapper

This Android project packages the existing AFAQ WALLET web experience as a standalone Android app.

## What it does
- Opens the existing wallet page at `https://oa626114-boop.github.io/afaq-syria/wallet.html`.
- Uses the same member login endpoint and existing AFAQ SYRIA account; it does not create a second wallet database.
- Keeps the wallet session inside the app's WebView storage.
- Keeps trusted AFAQ SYRIA pages inside the app and opens external payment-provider links in the device browser.
- Uses HTTPS only and disables file/content access in the WebView.

## Build an APK
The GitHub Actions workflow **Build AFAQ WALLET APK** builds a debug APK.
1. Open the repository's **Actions** tab.
2. Select **Build AFAQ WALLET APK**.
3. Run workflow (or wait for the branch push build).
4. Download the `afaq-wallet-debug-apk` artifact and extract `app-debug.apk`.

This is a debug APK for testing, not a signed production release. A release APK/AAB needs a private signing key stored securely in GitHub Actions secrets.

## Important
- The GitHub Pages URL must remain published at the configured path. If the Pages project URL changes, update `WALLET_URL` in `MainActivity.java`.
- The Worker must continue allowing the GitHub Pages origin `https://oa626114-boop.github.io`.
- The app is a WebView wrapper around the existing wallet site, not an offline/native rewrite.
- The wallet UI currently displays server-reported balances. Actual deposits, withdrawals, card issuance, and blockchain custody are only available if their separate licensed providers and server workflows are enabled and verified.

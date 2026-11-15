# DSH Market Radar

A compact gold, A-share and US-stock watchlist for the official DeepSeek Harness desktop app. A 28px ticker opens a watchlist with intraday charts, threshold alerts and user-reviewed quote snapshots that can be inserted into the current conversation draft.

Target runtime: **DSH 0.2.2-rc.3**, Node.js >=24.9.0. Install from npm with the bundled desktop CLI (`plugin --profile desktop add dsh-market-radar@0.1.1`), or use a prebuilt `.tgz` from GitHub Releases, then reload.

Fully quit the desktop app, including its tray process, before installing through its CLI. The hide shortcut is registered in the native DSH catalog: Ctrl+Shift+F9 on Windows and Command+Shift+F9 on macOS. A Windows user confirmed that Ctrl+Shift+F9 hides and restores the ticker.


- Pin up to three instruments. Add explicit A-share exchange prefixes (`sh600519`, `sz000001`) and US tickers (`AAPL`, `VOO`).
- Gold quotes keep XAU in USD/troy ounce and Au99.99 in CNY/gram separate.
- Tencent supplies stock quotes/minute data; Sina supplies gold quotes and XAU minute data. No market-data credentials are required.
- Au99.99 uses runtime samples rather than complete historical minute data. Missing intervals are not fabricated.
- Alerts establish a baseline before notifying on a fresh threshold crossing, with a 15-minute default cooldown. Stale quotes do not trigger alerts.
- **Ctrl+Shift+F9** hides all plugin price surfaces and mutes alerts. Restore does not replay hidden-period notifications.
- Review a snapshot, then insert it into the current editable conversation draft. Existing text and attachments remain; the user submits it.
- Settings are local and profile-specific. Monitoring requires a running DSH process and an awake computer.

Free upstream feeds can be delayed, unavailable or change format. Recurring trading hours do not cover every holiday or exceptional closure. Windows desktop validation and remaining limitations are recorded in [docs/VALIDATION.md](docs/VALIDATION.md).

Development: `pnpm install`, `pnpm check`, `pnpm smoke:live`, `pnpm smoke:package`, `pnpm dev`. The development fixture at `http://127.0.0.1:4188` is not the real DSH UI.

[中文说明](README.md) · [MIT](LICENSE)

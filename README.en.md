# DSH Market Radar

A compact gold, A-share and US-stock watchlist for the official DeepSeek Harness desktop app. A 28px ticker opens a watchlist with price charts, threshold alerts and user-reviewed quote snapshots that can be inserted into the current conversation draft.

Version `0.1.3` fixes an incorrect gold previous-close field in the older `0.1.3-dev.0` prerelease. Representative chart and alert interactions were checked in the Windows DSH desktop app.

Target runtime: **DSH 0.2.2-rc.3**, Node.js >=24.9.0. Install from npm with the bundled desktop CLI (`plugin --profile desktop add dsh-market-radar@0.1.3`), or use a prebuilt `.tgz` from GitHub Releases, then reload.

Fully quit the desktop app, including its tray process, before installing through its CLI. The hide shortcut is registered in the native DSH catalog: Ctrl+Shift+F9 on Windows and Command+Shift+F9 on macOS. A Windows user confirmed that Ctrl+Shift+F9 hides and restores the ticker.

- Pin up to three instruments. Enter an explicit A-share exchange prefix (`sh600519`, `sz000001`), or look up candidates for a six-digit A-share code; US tickers include `AAPL` and `VOO`.
- Gold quotes keep XAU in USD/troy ounce and Au99.99 in CNY/gram separate.
- Price line charts offer 1 day, 5 days, 1 month, 6 months, year to date (YTD), 1 year, 5 years and Max, with time-axis ticks, hover and keyboard readings. Max is limited to history returned within the provider and request limits. The actual source, resolution and covered interval are shown.
- Tencent supplies stock quotes, daily minute charts and A-share history; Sina supplies gold quotes and XAU history. Yahoo Finance supplies US five-day and daily history, and the Shanghai Gold Exchange supplies Au99.99 daily history. These public feeds require no market-data credentials.
- Five-day stock charts use intraday data, but gold uses daily points. Longer ranges use daily close points; the current day's point may still change. Tencent A-share daily prices are unadjusted; Yahoo US close adjustment treatment is determined by the provider. Some special US symbols lack historical coverage.
- Au99.99's one-day view uses runtime samples rather than complete historical minute data. One-day charts can fall back to runtime samples; missing history and intervals are not fabricated.
- Alerts establish a baseline before notifying on a fresh price or directional daily-change threshold crossing, with a 15-minute default cooldown. Existing absolute-change rules remain supported; stale quotes do not trigger alerts. Enter a positive threshold (for example, `3` for a fall of 3%). Older versions cannot read the new directional rules; export your settings and remove those rules before downgrading.
- **Ctrl+Shift+F9** hides all plugin price surfaces and mutes alerts. Restore does not replay hidden-period notifications.
- Review a snapshot, then insert it into the current editable conversation draft. Existing text and attachments remain; the user submits it.
- Settings are local and profile-specific. Monitoring requires a running DSH process and an awake computer.

Free upstream feeds can be delayed, unavailable or change format. Recurring trading hours do not cover every holiday or exceptional closure. The ticker, hide shortcut, draft insertion, representative multi-range charts and an intraday alert were checked in the Windows desktop app. The checks do not establish long-term availability for every market or feed.

## Disclaimer

This plugin is for personal market information only and does not constitute investment or trading advice, or a promise of returns. Third-party data may be delayed, incorrect, interrupted or missing; alerts may be delayed or fail because of network, device, software or data-source issues. Accuracy, completeness and timeliness are not guaranteed. Refer to the exchange and relevant service providers for authoritative information. Users make their own investment decisions and bear the associated risks.

Development: `pnpm install`, `pnpm check`, `pnpm smoke:live`, `pnpm smoke:history`, `pnpm smoke:package`, `pnpm dev`. The development fixture at `http://127.0.0.1:4188` is not the real DSH UI.

[中文说明](README.md) · [MIT](LICENSE)

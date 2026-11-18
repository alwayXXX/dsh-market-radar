# DSH Market Radar

Watch gold, mainland China A-shares and US market quotes in the DeepSeek Harness desktop app. Pin up to three instruments to the bottom ticker, then open the watchlist for price charts, threshold alerts and quote snapshots for chat drafts.

[中文说明](https://github.com/alwayXXX/dsh-market-radar/blob/main/README.md) · [Plugin directory](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/alwayXXX__dsh-market-radar.yml) · [npm](https://www.npmjs.com/package/dsh-market-radar) · [Changelog](https://github.com/alwayXXX/dsh-market-radar/blob/main/CHANGELOG.md)

## Install

Verified on **Windows with DeepSeek Harness 0.2.2-rc.3**. The package requires Node.js 24.9.0 or later. Select a local `.tgz` on the desktop Plugins page, or install from npm with the CLI bundled with the desktop app.

Before using the CLI, fully quit DSH, including its tray process. Replace the installation path in this example, run the command, then reopen DSH.

```powershell
& 'path-to-dsh-installation\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'dsh-market-radar@0.1.4'
```

To install a prebuilt `.tgz` from [GitHub Releases](https://github.com/alwayXXX/dsh-market-radar/releases), replace `dsh-market-radar@0.1.4` with the absolute path to the archive. Use the matching CLI and the `web` profile for the browser build. The main interaction flows were verified in the Windows desktop app.

## Use the watchlist

1. Click the bottom ticker to open the panel. If another plugin occupies the bottom slot, use the market button at the top right. Click outside the panel or press `Esc` to close it.
2. Click `+` to add an instrument. For A-shares, enter a six-digit code and confirm the matching exchange, or enter a prefixed symbol such as `sh600519`. `sh000001` is the Shanghai Composite and `sz000001` is Ping An Bank. For US markets, enter a symbol such as `AAPL` or `VOO`. Gold symbols are `XAU` (USD/troy oz) and `AU9999` (CNY/g).
3. Pin instruments to the ticker. Use row menus to reorder, set alerts or remove instruments. Settings include color conventions and JSON configuration import and export.
4. Select an instrument to see its price chart. Switch among **1 day, 5 days, 1 month, 6 months, year to date (YTD), 1 year, 5 years and Max**. Use the pointer or arrow keys to inspect prices.
5. With an editable DSH conversation open, prepare and preview a quote snapshot from the instrument details, then insert it into the draft. Existing text and attachments are preserved. You send the draft when ready.

### Alerts and hide mode

Set price or daily percentage change thresholds. The first valid quote establishes a baseline after startup, rule activation, a threshold edit or connection recovery. An in-app alert is recorded when a fresh quote crosses into the trigger range. The cooldown defaults to 15 minutes and can be set to 1–1440 minutes. Mark alerts as read from the panel.

Enter a positive number for percentage thresholds. For example, enter `3` in a daily decline rule to trigger at −3% or lower. An absolute daily move rule applies in both directions. Before downgrading to 0.1.2 or earlier, export the configuration and remove any directional percentage rules.

While the DSH window has focus, press **Ctrl+Shift+F9** (Windows) or **Command+Shift+F9** (macOS) to hide and mute the plugin. Press it again to restore it. The shortcut can be changed in DSH settings. Monitoring requires DSH to be running and the computer to be awake. Quotes can continue updating while hidden, and alerts from that period are not replayed.

## Data and privacy

| Use | Source |
| --- | --- |
| A-share and US quotes and same-day intraday history, plus A-share five-day and daily history | Tencent Finance (`qt.gtimg.cn`, `web.ifzq.gtimg.cn`) |
| Gold quotes, plus XAU intraday and daily history | Sina Finance (`hq.sinajs.cn`, `stock2.finance.sina.com.cn`) |
| US five-day and daily history | Yahoo Finance (`query1.finance.yahoo.com`) |
| Au99.99 daily history | Shanghai Gold Exchange (`www.sge.com.cn`) |

- Quotes normally refresh every 15 seconds while the panel is open or an alert is enabled, and every 60 seconds otherwise. Failed requests back off. Stale quotes remain visible and do not trigger alerts. The trading-hours estimate can show quotes as delayed on holidays or early closes.
- Charts show the source, sampling interval and actual coverage, with gaps visible. The one-day view shows a previous-close line when available. Au99.99 uses runtime quote samples for its one-day chart. Other instruments can fall back to samples if intraday history is unavailable. Five-day gold charts use daily points.
- Longer ranges use daily closes, and the current day's point may still change. Max depends on the history available from the provider. A-share daily prices are unadjusted, while US charts use the provider's `close` field. Some symbols lack historical coverage.
- The local DSH host requests quotes without market-data credentials. Providers may receive the requested symbols and network address. Settings are saved locally per profile. Once you send a snapshot in a draft, DSH handles it according to its model settings.

## Disclaimer

This plugin is for personal market information only and does not constitute investment or trading advice, or a promise of returns. Third-party data may be delayed, incorrect, interrupted or missing; alerts may be delayed or fail because of network, device, software or data-source issues. Accuracy, completeness and timeliness are not guaranteed. Refer to the exchange and relevant service providers for authoritative information. Users make their own investment decisions and bear the associated risks.

## Uninstall and develop

Remove the plugin from the DSH Plugins page, or use the same CLI and profile as for installation with `plugin --profile desktop remove dsh-market-radar`. Then reopen DSH. You can export your watchlist and alert rules from Settings before removal.

Run `pnpm install` and `pnpm check`, then use `pnpm dev` to open the simulated host at `http://127.0.0.1:4188`. `pnpm smoke:live`, `pnpm smoke:history` and `pnpm smoke:package` check quotes, history and packaging. `pnpm pack --pack-destination dist` creates a prebuilt package.

[Report an issue](https://github.com/alwayXXX/dsh-market-radar/issues) · [MIT license](https://github.com/alwayXXX/dsh-market-radar/blob/main/LICENSE)

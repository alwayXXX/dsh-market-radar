# 行情雷达 · dsh-market-radar

在 DeepSeek Harness 桌面端查看黄金、A 股和美股行情。底部行情条可固定最多三只自选，点开看板即可查看走势、设置提醒，或把行情快照放入对话草稿。

[English](#english) · [插件目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/alwayXXX__dsh-market-radar.yml) · [npm](https://www.npmjs.com/package/dsh-market-radar)

## 安装

此包的宿主版本范围为 **DSH `>=0.2.1-rc.1 <0.3.0-0`**，要求 Node.js 24.9.0 或更高版本。可从 [GitHub Releases](https://github.com/alwayXXX/dsh-market-radar/releases) 下载适配当前宿主的 `.tgz`，在桌面端的「插件」页选择本地文件。也可以用桌面端自带的 CLI 从 npm 安装兼容的发行版。

使用 CLI 前，请完整退出 DSH（包括托盘）。把示例中的安装目录换成你电脑上的实际路径，执行后重新打开 DSH。

```powershell
& '你的安装目录\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'dsh-market-radar'
```

用 CLI 安装本地包时，把 `dsh-market-radar` 换成下载的 `.tgz` 文件的绝对路径。指定 npm 版本时，在包名后加 `@版本号`。

## 使用

1. **管理自选。** 点击底部行情条打开看板。底部被占用时，可从右上角进入。用 `+` 添加标的，点图钉固定到底栏，行尾菜单可排序、设置提醒或移出自选。
2. **查看价格走势。** 点击标的，选择 1 天、5 天、1 个月、半年、年初至今（YTD）、1 年、5 年或 Max。可用鼠标或方向键查看读数。`XAU` 使用美元/金衡盎司，`AU9999` 使用人民币/克。
3. **查看黄金市场事件。** 在 XAU 或 Au99.99 的图表下展开「市场事件」，查看近期美联储货币政策公告和下一次美国 CPI 计划发布时间。日期与时间采用北京时间，点击标题可查看官方原文或日历。
4. **设置提醒。** 选择目标价或当日涨跌幅阈值。首条有效报价建立基线，之后报价从阈值外进入触发范围时，才会出现应用内提醒。默认冷却 15 分钟。涨跌幅填正数，例如「当日跌幅达到」填 `3`，表示跌至 −3% 或更低。
5. **把行情放入对话。** 打开一个可编辑的 DSH 对话，在标的详情中点「准备行情快照」，或在自选列表中点「准备重点自选快照」合并底栏固定的标的。预览后点「放入对话」。快照会加入当前草稿，已有文字与附件保留，由你决定何时发送。

A 股可输入六位代码查候选，也可直接输入带交易所前缀的代码，例如 `sh600519`。`sh000001` 是上证指数，`sz000001` 是平安银行。美股可输入 `AAPL`、`VOO` 等代码。在「设置」中可以更改涨跌配色，或导入、导出 JSON 自选配置。

### 隐藏与提醒

DSH 获得焦点时，按 **Ctrl+Shift+F9**（Windows）或 **Command+Shift+F9**（macOS）隐藏行情条和看板、静音提醒，再按一次恢复。可在宿主的快捷键设置中搜索「行情雷达：隐藏或恢复」修改组合键。监测在 DSH 运行且电脑保持唤醒时进行，恢复界面时不会补发隐藏期间的提醒。

## 数据来源与范围

| 用途 | 来源 |
| --- | --- |
| A 股、美股报价及当日分时，A 股五日分时和日线 | 腾讯财经（`qt.gtimg.cn`、`web.ifzq.gtimg.cn`） |
| 黄金报价、XAU 分时和日线 | 新浪财经（`hq.sinajs.cn`、`stock2.finance.sina.com.cn`） |
| 美股五日及日线 | Yahoo Finance（`query1.finance.yahoo.com`） |
| Au99.99 日线 | 上海黄金交易所（`www.sge.com.cn`） |
| 黄金市场事件 | 美联储（`www.federalreserve.gov`）、美国劳工统计局（`www.bls.gov`）和纽约联储（`www.newyorkfed.org`） |

- 看板打开或有提醒规则启用时，报价通常每 15 秒刷新一次，其余时间通常每 60 秒刷新一次。过期报价不触发提醒。节假日或提前收市可能显示为「报价已延迟」。
- 走势图标明实际覆盖区间与数据粒度，缺失时段留空。Au99.99 的日内走势使用插件运行期间的采样，其他标的在分时数据不可用时也可能回退到采样。较长区间使用日线收盘点，Max 取决于数据源可提供的范围。A 股日线未复权，美股使用来源的 `close` 字段。
- 市场事件仅在区块展开时加载。CPI 优先使用美国劳工统计局日历，数据源不可用时尝试纽约联储。两处都不可用时，可显示最近 24 小时内获取、且尚未到点的缓存日程，并提供查看官方日历的入口。
- 请求由本机 DSH 宿主发出，无需为行情或事件单独配置账户或 API Key。数据服务方可能收到查询代码和网络地址。自选、提醒和显示设置保存在本机当前 profile。对话快照由用户添加，发送后按 DSH 的模型配置处理。

## 卸载

在 DSH 的「插件」页卸载，或退出桌面端后，用安装时的 CLI 和 profile 执行 `plugin --profile desktop remove dsh-market-radar`。需要备份时可先在「设置」导出配置。

## 免责声明

本插件仅供个人查看行情和信息参考，不构成投资建议、交易建议或收益承诺。行情由第三方提供，可能存在延迟、错误、中断或缺失；提醒也可能因网络、设备休眠、软件故障或数据源问题而延迟或未触发。本插件不保证数据和提醒的准确性、完整性或实时性，请以交易所及相关服务机构的信息为准。投资决策由使用者独立作出，并自行承担相应风险。

[问题反馈](https://github.com/alwayXXX/dsh-market-radar/issues) · [MIT 许可证](https://github.com/alwayXXX/dsh-market-radar/blob/main/LICENSE)

## English

DSH Market Radar brings gold, China A-share and US quotes to the DeepSeek Harness desktop app. Pin up to three symbols to the bottom ticker, open charts from 1 day to Max, set price or percent-change alerts, and insert quote snapshots into an editable chat draft. Expand **市场事件** below the XAU or Au99.99 chart for recent Federal Reserve policy announcements and the next scheduled US CPI release (Beijing time).

**Install.** This package requires DSH `>=0.2.1-rc.1 <0.3.0-0` and Node.js 24.9.0 or later. Select a compatible `.tgz` from [GitHub Releases](https://github.com/alwayXXX/dsh-market-radar/releases) in the desktop Plugins page. To use the bundled CLI, quit DSH completely and run the command in the installation section above with your actual DSH installation path. Reopen DSH after installing. To uninstall, use the Plugins page or run `plugin --profile desktop remove dsh-market-radar` with the same CLI.

**Use.** Open the panel from the bottom ticker or, when its slot is occupied, from the top right. Use `+` to add symbols such as `sh600519` or `VOO`. Alerts establish a baseline on the first valid quote and fire on a subsequent threshold crossing. Press **Ctrl+Shift+F9** on Windows or **Command+Shift+F9** on macOS to hide the panel and mute alerts. Press it again to restore the panel.

**Data and privacy.** Market data comes from Tencent Finance, Sina Finance, Yahoo Finance and the Shanghai Gold Exchange. Event links point to the Federal Reserve, US Bureau of Labor Statistics and New York Fed. The DSH host requests data directly, so providers may receive the requested symbols and network address. Watchlists, alerts and display settings are stored locally per profile. A snapshot reaches your configured model when you send its draft.

**Disclaimer.** Market Radar is for personal information only and does not provide investment or trading advice. Data and alerts may be delayed, inaccurate or unavailable. Refer to the relevant exchanges and providers for authoritative information. You are responsible for your investment decisions.

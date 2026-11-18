# 行情雷达 · dsh-market-radar

在 DeepSeek Harness 桌面端查看黄金、A 股和美股行情。底部行情条可固定最多三只自选，点开看板即可查看走势、设置提醒，或把行情快照放入对话草稿。

[English](https://github.com/alwayXXX/dsh-market-radar/blob/main/README.en.md) · [插件目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/data/plugins/alwayXXX__dsh-market-radar.yml) · [npm](https://www.npmjs.com/package/dsh-market-radar) · [更新日志](https://github.com/alwayXXX/dsh-market-radar/blob/main/CHANGELOG.md)

## 安装

已验证环境为 **Windows + DeepSeek Harness 0.2.2-rc.3**，包要求 Node.js 24.9.0 或更高版本。可在桌面端插件页选择本地 `.tgz`，也可用桌面端自带的 CLI 从 npm 安装。

使用 CLI 前，请完整退出 DSH（包括托盘）。将下面示例中的安装目录替换成你电脑上的实际路径，执行后重新打开 DSH。

```powershell
& '你的安装目录\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'dsh-market-radar@0.1.4'
```

也可以从 [GitHub Releases](https://github.com/alwayXXX/dsh-market-radar/releases) 下载预构建的 `.tgz`，把命令中的 `dsh-market-radar@0.1.4` 换成该文件的绝对路径。浏览器版应使用对应的 CLI 和 `web` profile，主要交互验收在 Windows 桌面端完成。

## 使用

1. 点击底部行情条打开看板。底部被其他插件占用时，点击右上角的「行情」；点击看板外部或按 `Esc` 收起。
2. 用 `+` 添加自选。A 股可输入六位代码查找候选，或直接填 `sh600519` 等带交易所前缀的代码。`000001` 对应的候选中，`sh000001` 是上证指数，`sz000001` 是平安银行。美股可填 `AAPL`、`VOO` 等代码；黄金可选 `XAU`（美元/金衡盎司）或 `AU9999`（人民币/克）。
3. 点图钉把标的固定到底栏。行尾菜单可排序、设置提醒或移出自选；在「设置」中可调整涨跌配色、导入或导出 JSON 配置。
4. 点击标的查看价格折线。支持 **1 天、5 天、1 个月、半年、年初至今（YTD）、1 年、5 年和 Max**，可用鼠标或键盘查看读数。
5. 打开一个可编辑的 DSH 对话，再在标的详情中点「准备行情快照」→「放入对话」。快照会附到草稿中，保留已有文字与附件。发送仍由你操作。

### 提醒与隐藏

在「提醒」中可设置目标价和当日涨跌幅阈值。启动、启用规则、修改阈值或断线恢复后，首条有效报价建立基线，之后从阈值外进入触发范围时才提醒。默认冷却 15 分钟，可设为 1–1440 分钟。应用内提醒可在看板标记已读。

涨跌幅阈值填正数，例如在「当日跌幅达到」中填 `3` 表示跌至 −3% 或更低。「涨跌幅绝对值」规则同时匹配上涨和下跌。若需回退到 0.1.2 或更早版本，先导出配置，再移除现有的单向涨跌幅规则。

DSH 窗口获得焦点时，按 **Ctrl+Shift+F9**（Windows）或 **Command+Shift+F9**（macOS）隐藏行情并静音，再按一次恢复。可在宿主快捷键设置中搜索「行情雷达：隐藏或恢复」更改组合键。监测需要 DSH 运行且电脑保持唤醒。隐藏期间可以继续更新报价，恢复时不会补发提醒。

## 数据与隐私

| 用途 | 来源 |
| --- | --- |
| A 股、美股报价及当日分时，A 股五日分时和日线 | 腾讯财经（`qt.gtimg.cn`、`web.ifzq.gtimg.cn`） |
| 黄金报价，XAU 分时和日线 | 新浪财经（`hq.sinajs.cn`、`stock2.finance.sina.com.cn`） |
| 美股五日及日线 | Yahoo Finance（`query1.finance.yahoo.com`） |
| Au99.99 日线 | 上海黄金交易所（`www.sge.com.cn`） |

- 看板打开或有启用的提醒时，通常每 15 秒刷新一次。其余时间通常每 60 秒刷新一次，请求失败时会退避。过期报价可供查看，但不触发提醒。节假日或提前收市可能显示为「报价已延迟」。
- 图表标明来源、粒度和实际覆盖区间，缺失时段留空。1 天视图在有昨收数据时显示参考线。Au99.99 使用插件运行期间的日内采样，其他标的的当日分时不可用时也可能回退到采样。黄金的 5 天走势使用日线点。
- 较长区间使用日线收盘点，当日数据可能仍在变化。Max 取决于来源提供的历史范围。A 股日线未复权，美股采用来源的 `close` 字段，部分特殊代码可能缺少历史数据。
- 行情请求由本机 DSH Host 发出，无需行情账户或 API Key。数据服务方可能收到查询代码和网络地址。自选、提醒和设置保存在本机当前 profile；行情快照由你放入草稿，发送后按 DSH 的模型配置处理。

## 免责声明

本插件仅供个人查看行情和信息参考，不构成投资建议、交易建议或收益承诺。行情由第三方提供，可能存在延迟、错误、中断或缺失；提醒也可能因网络、设备休眠、软件故障或数据源问题而延迟或未触发。本插件不保证数据和提醒的准确性、完整性或实时性，请以交易所及相关服务机构的信息为准。投资决策由使用者独立作出，并自行承担相应风险。

## 卸载与开发

在 DSH 插件页卸载，或用安装时的 CLI 和 profile 执行 `plugin --profile desktop remove dsh-market-radar`，然后重新打开 DSH。本地自选和规则可在卸载前从「设置」导出。

开发时运行 `pnpm install`、`pnpm check`，再用 `pnpm dev` 打开 `http://127.0.0.1:4188` 的模拟页面。`pnpm smoke:live`、`pnpm smoke:history` 和 `pnpm smoke:package` 分别检查报价、历史数据和安装包。`pnpm pack --pack-destination dist` 可生成预构建包。

[提交问题](https://github.com/alwayXXX/dsh-market-radar/issues) · [MIT 许可证](https://github.com/alwayXXX/dsh-market-radar/blob/main/LICENSE)

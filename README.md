# WordVoice 2

在 Chrome 网页中选中文本，按 **S** 朗读。发音、释义查询和保存同时进行。支持单词、短语、句子，以及本地单词本。

## 安装与更新

需要 Chrome 116 或更新版本。安装使用源码目录，无需运行构建工具。

1. 下载并解压此仓库，或运行 `git clone https://github.com/Chaos7479/WordVoice.git`。
2. 打开 `chrome://extensions/`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的目录。
4. 在普通网页选中文本，按 **S**。

**已有用户升级：** 先在旧版单词本中导出 JSON 备份。将新版文件放回原安装目录，然后在扩展管理页点击「重新加载」。使用相同目录可以保留扩展 ID、设置和单词本。换到新目录安装时，可以导入备份。升级后扩展会尝试接入已打开的网页；某页仍无响应时，刷新该页。

测试分支的安装方式相同。GitHub Actions 会生成仅包含运行文件的 `WordVoice-extension` 安装包。

## 日常使用

| 操作                 | 效果                                                  |
| -------------------- | ----------------------------------------------------- |
| 选中文本后按 `S`     | 朗读、查询释义、记录到单词本                          |
| 选中文本后按反引号   | 同上                                                  |
| `Ctrl+Shift+S`       | 浏览器快捷键，也支持输入框选区。macOS 使用 Control 键 |
| 浮层切换发音服务     | 立即重读，并记住所选服务                              |
| 提示框「再读一次」   | 重读当前文本，保留查询次数                            |
| 「停止朗读」或 `Esc` | 停止当前朗读；Esc 同时关闭网页提示                    |
| 点击扩展图标         | 最近记录、搜索、朗读、设置和单词本入口                |
| 单词本               | 按时间、类型、掌握度筛选，搜索原文、翻译与释义        |
| 词条详情             | 发音、翻译、释义、来源、AI 例句、删除                 |
| 复习                 | 每轮最多 20 个单词或短语，按认识程度记录进度          |
| 学习统计             | 今日、本周（周一开始）、14 天趋势和掌握度分布         |
| 导出 / 导入          | JSON 备份，保留翻译、掌握度、时间和上下文             |

单按 S 会保留输入框、编辑器和输入法的原有操作。密码字段保留原有输入行为。快捷键冲突时，在设置页打开 Chrome 快捷键管理并重新分配组合键。

## 发音与服务配置

默认使用 **浏览器语音**。优先选择对应语言和英语口音的本地语音，启动朗读时无需等待网络。macOS 美式英语优先使用 Samantha，自动选择时跳过 Albert 等特殊音色。设置页可选择「浏览器音色」并试听；提示框和最近发音记录会显示实际音色。音色失效时自动选择可用音色。语音可用性由操作系统和 Chrome 决定。释义、翻译失败时，已保存的文本仍保留在单词本中。

可选服务：

| 服务                      | 用途                   | 配置                                        |
| ------------------------- | ---------------------- | ------------------------------------------- |
| 浏览器语音                | 朗读，默认选项         | 语言、英语口音、音色、速度                  |
| Free Dictionary           | 英文单词原音与词典释义 | 无需密钥。短语和句子使用浏览器语音          |
| 阿里云百炼                | Qwen3-TTS HTTP 发音    | 中国内地 API Key、模型、音色                |
| 豆包语音                  | 发音                   | App ID、Access Token、音色 ID               |
| 火山方舟                  | 翻译与 AI 例句         | 独立的方舟 API Key、模型或推理接入点 ID     |
| MiniMax                   | 发音、翻译和例句       | 中国内地 API Key、模型、音色；Group ID 可选 |
| Google Translate 免费接口 | 默认翻译               | 需要可访问该服务的网络                      |
| 通义千问                  | 翻译与例句             | 中国内地百炼 API Key、文本模型              |

设置中的「试听」「测试翻译」「测试 AI 例句」使用当前表单值。**保存设置**后，网页使用新配置。浮层的「发音」菜单可以直接切换已配置的服务；切换会重读当前文本，并保存为后续朗读的默认服务。重复试听保留查询次数和上下文。未配置的服务会标注状态，可通过旁边的「配置」打开设置页；保存后浮层立即更新。

已有 `settings.local.json` 时，在「云端服务」点击 **导入配置** 并选择该文件。扩展会合并服务凭据，并保存当前表单设置。导入成功后，已打开的浮层立即启用对应服务。文件格式错误时保留原设置。

云端发音路径设有 5 秒截止时间。服务失败或超时后会尝试浏览器语音。测试按钮直接报告所选服务的结果，便于检查配置。

## 界面与键盘操作

2.2 保留内容、操作、状态和必要说明，移除宣传语与装饰性英文标题。深浅两套外观随系统切换。单词本底部可切换单词本、复习和统计，右上角菜单提供导入与导出。

- 搜索：Ctrl/Cmd+F 定位搜索框，Esc 清空当前搜索。
- 复习：空格查看释义，1/2/3 标记认识、模糊和不认识。
- 设置：试听紧邻音色选择；固定保存栏提示未保存的更改。
- 选词浮窗：鼠标停留或键盘操作期间保持显示，Esc 关闭。

页面与交互说明见 [docs/DESIGN.md](docs/DESIGN.md)。GitHub Actions 同时提供界面截图包。

## 数据与隐私

- 设置和密钥保存在当前 Chrome 配置文件的本地存储中。v1 的同步设置会一次性迁移到本地；升级保留已有设置。
- 单词、翻译、查询次数、掌握度和网页上下文保存在 IndexedDB 中。
- 只有用户发起选词查询时，扩展才记录该选区的文本、邻近上下文、网页标题和网址。
- 查询词典会发送所选单词。启用翻译会把所选文本发送给所选服务；AI 翻译失败时会尝试 Google 免费接口。云端发音和 AI 例句也需要发送对应文本。
- 浏览器语音优先使用本地语音；缺少本地语音时，Chrome 可能选择联网语音。
- JSON 导出只包含学习记录，不包含密钥。
- 扩展使用 HTTP/HTTPS 网站权限监听选区，并在安装或更新后接入已打开的页面。`scripting` 用于接入和修复内容脚本；`offscreen` 用于在扩展页面播放音频；`tts` 用于系统语音；`storage` 用于设置；`sidePanel` 用于单词本。

## 范围与限制

- 每次最多 **2000 个字符**。百炼 Qwen3-TTS 的单次上限为 600 个字符；更长文本使用浏览器语音。
- Chrome 内部页面、扩展商店和内置 PDF 阅读器限制内容脚本。普通 HTTP/HTTPS 网页和允许脚本的嵌入网页支持选词朗读。
- 每个词条保留最近 20 条不同上下文；相同网址和句子的重复查询会合并。
- 音频缓存最多 200 条、约 32 MiB 存储预算、有效期 30 天。释义、翻译和例句缓存合计最多 1000 条、有效期 7 天。
- 单词本每次显示 100 条，可继续加载。导出包含全部词条。导入支持 25 MB 内、最多 50000 个词条和 100000 条上下文的备份。
- 重复导入同一备份会合并记录。查询次数采用较大值，避免重复导入放大次数。
- 网络服务的可用性、音色、模型权限和额度取决于服务商账户。第三方账户需要在设置页测试。

## 开发与验证

运行时使用原生 JavaScript，生产包无第三方 JavaScript 依赖。测试需要 Node.js 24。

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run package
```

- `npm test`：数据迁移、事务并发、备份、缓存、网络取消和语音请求控制。
- `npm run test:e2e`：加载真实 Chrome 扩展，验证网页选词、iframe、页面限制、侧栏、设置、复习和后台停止后的唤醒。
- 多数浏览器测试使用受控网络响应和模拟系统语音事件，保证离线复现。音频播放测试使用真实 Offscreen Audio 元素。macOS 唤醒测试另用真实系统语音。
- `npm run package`：在 `dist/` 生成可解压加载的 ZIP。

本地开发可运行 `node scripts/configure-local.mjs /绝对路径/语音服务.env`，从已有环境文件生成 `settings.local.json`。支持 `DASHSCOPE_API_KEY`、`MINIMAX_API_KEY_PROD`（或 `MINIMAX_API_KEY` / `MINIMAX_API_KEY_TEST`）、`DOUBAO_TTS_APP_ID` 与 `DOUBAO_TTS_ACCESS_TOKEN`。重新加载**此源码目录**中的扩展或打开设置页后自动导入；随后清空某个 Key 会保留该选择。需要更新 Key 时重新生成本地配置，或在设置页主动导入文件。

本地配置文件权限为 600，已排除在 Git 和发布 ZIP 之外。安装公开 ZIP 时，在设置页导入本机配置文件或填写 Key。凭据只向对应服务商发送；浮层接收服务名称、模型与配置状态。

完整审计与验证记录见 [docs/AUDIT.md](docs/AUDIT.md)。

## English

Select text on a regular Chrome page and press **S** to pronounce it, look it up and save it. WordVoice 2 starts browser speech independently of dictionary and translation requests. New selections interrupt old speech. Cloud audio plays in an extension offscreen document and falls back to browser speech after a bounded timeout.

Load the repository directory containing `manifest.json` through Chrome's **Load unpacked** button. Requires Chrome 116+. No build is required. For upgrades, export a backup first and replace files in the original extension directory to preserve its ID and data.

Includes a searchable vocabulary book, context history, flashcard review, statistics, JSON import/export and optional cloud speech/AI providers. Credentials stay in the current browser profile. Chrome internal pages, the Web Store and the built-in PDF viewer restrict content scripts. Third-party services require network access and, where applicable, valid credentials.

## License

[MIT](LICENSE)

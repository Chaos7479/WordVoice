# WordVoice — 英语发音学习助手

[English](#english) | [中文](#中文)

---

<a name="中文"></a>

## 🎯 简介

WordVoice 是一个 Chrome 浏览器扩展，帮助你在浏览网页时随时学习英语发音。选中任意英文单词，按下 **S** 键，即可听到标准发音、查看音标释义和中文翻译，同时自动记录到生词本。

## ✨ 功能特性

**核心功能**
- 🔊 选中单词按 S 键即刻发音（支持单词、短语、句子）
- 📖 自动查询音标、词性、英文释义（Free Dictionary API）
- 🌐 中文翻译（Google Translate 免费 / 通义千问 / 豆包 / MiniMax）
- 📝 自动记录到生词本，统计查询频率

**TTS 发音引擎**
- 阿里云百炼 DashScope（Qwen3-TTS，多种英文音色）
- 豆包 / 火山引擎（字节跳动 TTS）
- MiniMax（多种英文/中文音色）
- Chrome 内置 TTS（免费兜底）

**学习工具**
- 📇 闪卡复习模式（3 档掌握度：认识 / 模糊 / 不认识）
- 📊 学习统计（每日新增、掌握度分布、查询频率）
- 🤖 AI 例句生成（通义千问 / 豆包 / MiniMax）
- 📤 数据导入导出（JSON 格式）

**体验细节**
- Toast 气泡跟随选中文本定位，显示音标 + 翻译 + 发音来源
- 音频本地缓存（IndexedDB），避免重复 API 调用
- 短语/句子智能识别，自动走翻译 + TTS
- 单词本支持类型筛选（单词 / 短语 / 句子）

## 📦 安装

### 从源码安装

1. 克隆仓库

```bash
git clone https://github.com/Chaos7479/WordVoice.git
```

2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 右上角开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择克隆下来的 `WordVoice` 目录

## ⚙️ 配置

### 零配置即可使用

安装后无需任何配置即可使用基础功能：
- **发音**：Free Dictionary 原生音频 + Chrome 内置 TTS
- **翻译**：Google Translate（免费）
- **词典**：Free Dictionary API（免费）

### 可选：配置第三方 TTS（更自然的发音）

点击扩展图标 → 右键 → 选项，进入设置页面：

| 服务商 | 需要配置 | 发音质量 |
|--------|---------|---------|
| Free Dictionary | 无需配置 | ⭐⭐⭐ |
| Chrome TTS | 无需配置 | ⭐⭐⭐ |
| 阿里云百炼 DashScope | API Key | ⭐⭐⭐⭐⭐ |
| 豆包（火山引擎） | App ID + Access Token | ⭐⭐⭐⭐⭐ |
| MiniMax | Group ID + API Key | ⭐⭐⭐⭐⭐ |

## 🎹 快捷键

| 快捷键 | 条件 | 说明 |
|--------|------|------|
| `S` | 选中文本 + 不在输入框中 | 发音并保存 |
| `` ` `` | 选中文本 + 不在输入框中 | 发音并保存 |
| `Ctrl+Shift+S` | 任意场景 | 发音并保存 |

## 🏗️ 技术栈

- Chrome Extension Manifest V3
- Vanilla JavaScript（无框架依赖）
- IndexedDB 本地存储
- Free Dictionary API
- Google Translate API（免费）
- 多 TTS 服务商适配（DashScope / 豆包 / MiniMax）
- CSS 毛玻璃 + 3D 闪卡动画

## 📁 项目结构

```
WordVoice/
├── manifest.json            # 扩展配置
├── background/
│   └── service-worker.js    # 后台服务（消息路由、API 调用）
├── content/
│   ├── content.js           # 内容脚本（选词、Toast、音频播放）
│   └── content.css          # Toast 样式
├── lib/
│   ├── tts.js               # TTS 发音模块（降级链、缓存）
│   ├── tts-providers.js     # TTS 服务商适配器
│   ├── translate.js         # 翻译模块（多服务商 + 降级）
│   ├── settings.js          # 设置管理
│   ├── db.js                # IndexedDB 数据库封装
│   ├── ai-sentences.js      # AI 例句生成
│   └── utils.js             # 工具函数
├── popup/                   # 弹出面板（最近单词、快捷搜索）
├── sidepanel/               # 侧边栏（单词本、复习、统计）
├── options/                 # 设置页面（TTS/翻译/AI 配置）
└── assets/icons/            # 扩展图标
```

## 📄 许可证

MIT License

---

<a name="english"></a>

## 🎯 Introduction

WordVoice is a Chrome extension that helps you learn English pronunciation while browsing the web. Select any English word and press **S** to hear its pronunciation, view phonetics and definitions, and get a Chinese translation — all while automatically saving it to your vocabulary book.

## ✨ Features

**Core**
- 🔊 Select a word and press S for instant pronunciation (words, phrases, sentences)
- 📖 Auto-lookup: phonetics, part of speech, English definitions (Free Dictionary API)
- 🌐 Translation (Google Translate free / Qwen / Doubao / MiniMax)
- 📝 Auto-save to vocabulary book with frequency tracking

**TTS Engines**
- Alibaba Cloud DashScope (Qwen3-TTS, multiple English voices)
- Doubao / Volcengine (ByteDance TTS)
- MiniMax (multiple English/Chinese voices)
- Chrome built-in TTS (free fallback)

**Learning Tools**
- 📇 Flashcard review (3 mastery levels: know / fuzzy / don't know)
- 📊 Statistics (daily new words, mastery distribution, query frequency)
- 🤖 AI example sentences (Qwen / Doubao / MiniMax)
- 📤 Data import/export (JSON)

**UX Details**
- Toast popup follows text selection, shows phonetics + translation + TTS source
- Local audio cache (IndexedDB) to avoid redundant API calls
- Smart detection of phrases/sentences with auto translation + TTS
- Vocabulary filtering by type (word / phrase / sentence)

## 📦 Installation

### From Source

1. Clone the repository

```bash
git clone https://github.com/Chaos7479/WordVoice.git
```

2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the cloned `WordVoice` directory

## ⚙️ Configuration

### Zero Configuration Required

Works out of the box with:
- **Pronunciation**: Free Dictionary audio + Chrome built-in TTS
- **Translation**: Google Translate (free)
- **Dictionary**: Free Dictionary API (free)

### Optional: Third-party TTS (Better Voice Quality)

Right-click the extension icon → Options to configure:

| Provider | Requires | Quality |
|----------|----------|---------|
| Free Dictionary | Nothing | ⭐⭐⭐ |
| Chrome TTS | Nothing | ⭐⭐⭐ |
| Alibaba DashScope | API Key | ⭐⭐⭐⭐⭐ |
| Doubao (Volcengine) | App ID + Token | ⭐⭐⭐⭐⭐ |
| MiniMax | Group ID + API Key | ⭐⭐⭐⭐⭐ |

## 🎹 Keyboard Shortcuts

| Shortcut | Condition | Action |
|----------|-----------|--------|
| `S` | Text selected + not in input | Pronounce & save |
| `` ` `` | Text selected + not in input | Pronounce & save |
| `Ctrl+Shift+S` | Any context | Pronounce & save |

## 🏗️ Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no framework dependencies)
- IndexedDB for local storage
- Free Dictionary API
- Google Translate API (free)
- Multi-TTS provider adapters (DashScope / Doubao / MiniMax)
- CSS glassmorphism + 3D flashcard animations

## 📁 Project Structure

```
WordVoice/
├── manifest.json            # Extension manifest
├── background/
│   └── service-worker.js    # Background service (routing, API calls)
├── content/
│   ├── content.js           # Content script (selection, toast, audio)
│   └── content.css          # Toast styles
├── lib/
│   ├── tts.js               # TTS module (fallback chain, cache)
│   ├── tts-providers.js     # TTS provider adapters
│   ├── translate.js         # Translation (multi-provider + fallback)
│   ├── settings.js          # Settings management
│   ├── db.js                # IndexedDB wrapper
│   ├── ai-sentences.js      # AI sentence generation
│   └── utils.js             # Utility functions
├── popup/                   # Popup panel (recent words, search)
├── sidepanel/               # Side panel (vocabulary, review, stats)
├── options/                 # Options page (TTS/translation/AI config)
└── assets/icons/            # Extension icons
```

## 📄 License

MIT License

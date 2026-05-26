<div align="center">
  <h1>Open PicsetAI</h1>
  <p><strong>AI 电商图片生成、精修与万能画布工作台</strong></p>
  <p>
    <a href="./README.md">中文</a>
    ·
    <a href="#-快速开始">快速开始</a>
    ·
    <a href="#-环境变量">环境变量</a>
    ·
    <a href="#-项目结构">项目结构</a>
  </p>
  <p>
    <img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg" />
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black.svg" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61dafb.svg" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-blue.svg" />
    <img alt="Status" src="https://img.shields.io/badge/Open%20Source-Ready-success.svg" />
  </p>
</div>

> [!CAUTION]
> **不要提交真实 `.env` 文件、API Key、用户上传图片、数据库文件或生成产物。**
>
> 本仓库只提交 `.env.example`。本地开发请复制示例文件后自行填写密钥：
>
> ```bash
> cp frontend/.env.example frontend/.env
> cp backend/.env.example backend/.env
> ```

---

## ✨ 项目简介

Open PicsetAI 是一个面向电商图片生产的开源 AI 工作台，采用前后端分离的双 Next.js 应用架构：

- `frontend`：用户界面，默认运行在 `3000` 端口。
- `backend`：API 服务，默认运行在 `3001` 端口。

它覆盖商品图生成、风格复刻、服装组图、图片精修、知识付费素材、万能画布、OCR 文字识别、图片文字替换、智能分层 PSD/JSX 导出等流程。

---

## 🚀 功能概览

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 全品类商品图 | `/studio-genesis/workspace` | 商品图分析、AI 文案、批量生成、任务轮询、历史记录 |
| 风格复刻 | `/aesthetic-mirror` | 上传参考图后生成相似风格图片 |
| 服装组图 | `/clothing-studio` | 服装电商图片生成和模特图工作流 |
| 图片精修 | `/refinement-studio` | 图片上传、AI 分析、精修生成、结果预览 |
| 知识付费 | `/knowledge-studio` | 知识类产品视觉素材工作台 |
| 万能画布 | `/canvas-studio` | 无限画布、图片上传、选中编辑、文字编辑、智能分层 |
| OCR / 改字 | Backend API | 图片文字识别与替换生成 |
| 智能分层 | Backend API | 多模态分析图片并输出 PSD/JSX 编辑包 |

---

## 🧱 技术栈

| 分类 | 技术 |
| --- | --- |
| 前端 | Next.js 15, React 19, TypeScript, Tailwind CSS, Radix UI, lucide-react |
| 后端 | Next.js API Routes, TypeScript, NextAuth |
| 图片/AI | OpenAI-compatible Provider, Gemini Image Understanding, APIMart Image Provider |
| 画布/导出 | Canvas Studio, PSD package, Photoshop JSX |
| 开发工具 | npm, concurrently, TypeScript |

---

## 📦 项目结构

```text
open-picsetai/
├── frontend/                         # 前端 Next.js 应用，端口 3000
│   ├── app/                          # 页面路由
│   ├── components/                   # 通用 UI 和业务组件
│   ├── lib/                          # 前端请求、工具函数
│   └── .env.example                  # 前端环境变量示例
├── backend/                          # 后端 Next.js API 应用，端口 3001
│   ├── app/api/                      # API Routes
│   ├── lib/                          # AI、任务、上传、模型路由逻辑
│   ├── vendor/                       # 第三方脚本或迁移工具
│   └── .env.example                  # 后端环境变量示例
├── package.json                      # 根目录开发脚本
├── README.md                         # 项目说明
└── LICENSE                           # MIT License
```

---

## ⚡ 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/ddlmanus/open-picsetai.git
cd open-picsetai
```

### 2. 安装依赖

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

### 3. 配置环境变量

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

然后编辑：

- `frontend/.env`
- `backend/.env`

填入你的模型服务地址、模型名称和 API Key。

### 4. 启动开发环境

同时启动前端和后端：

```bash
npm run dev
```

单独启动：

```bash
npm run dev:backend
npm run dev:frontend
```

默认访问地址：

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:3000` |
| 后端 API | `http://localhost:3001` |

---

## 🔐 环境变量

### Frontend

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `BACKEND_URL` | `http://localhost:3001` | 后端 API 地址 |
| `STUDIO_GENESIS_TEXT_MODEL` | `gpt-4.1` | 文本模型名称 |
| `STUDIO_GENESIS_TEXT_API_KEY` | 留空或本地填写 | 文本模型 API Key |
| `STUDIO_GENESIS_TEXT_BASE_URL` | `https://api.example.com/v1` | 文本模型 OpenAI-compatible 地址 |
| `STUDIO_GENESIS_IMAGE_MODEL` | `gemini-3.1-flash-image-preview` | 图片模型名称 |
| `STUDIO_GENESIS_IMAGE_API_KEY` | 留空或本地填写 | 图片模型 API Key |
| `STUDIO_GENESIS_IMAGE_BASE_URL` | `https://api.example.com/v1` | 图片模型服务地址 |
| `STUDIO_GENESIS_IMAGE_ENDPOINT` | `/images/generations` | 图片生成接口路径 |

### Backend

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `STUDIO_GENESIS_SQLITE_PATH` | 留空 | 可选 SQLite 文件路径 |
| `STUDIO_GENESIS_DEV_USER_ID` | `dev-user` | 本地开发用户 ID |
| `STUDIO_GENESIS_DEV_MERCHANT_ID` | `dev-merchant` | 本地开发商户 ID |
| `STUDIO_GENESIS_TEXT_MODEL` | `gpt-4.1` | 后端文本模型名称 |
| `STUDIO_GENESIS_TEXT_API_KEY` | 留空或本地填写 | 后端文本模型 API Key |
| `STUDIO_GENESIS_TEXT_BASE_URL` | `https://api.example.com/v1` | 后端文本模型地址 |
| `STUDIO_GENESIS_IMAGE_MODEL` | `gemini-3.1-flash-image-preview` | 后端图片模型名称 |
| `STUDIO_GENESIS_IMAGE_API_KEY` | 留空或本地填写 | 后端图片模型 API Key |
| `STUDIO_GENESIS_IMAGE_BASE_URL` | `https://api.example.com/v1` | 后端图片模型地址 |
| `STUDIO_GENESIS_IMAGE_ENDPOINT` | `/images/generations` | 后端图片生成接口路径 |

> [!IMPORTANT]
> `.env.example` 只用于说明变量名。真实 API Key 应放在本地 `.env` 或线上 Secret Manager 中。

---

## 🧪 类型检查

```bash
npm --prefix frontend run typecheck
npm --prefix backend run typecheck
```

---

## 🏗️ 构建与运行

构建：

```bash
npm --prefix backend run build
npm --prefix frontend run build
```

生产运行：

```bash
npm --prefix backend run start
npm --prefix frontend run start
```

---

## 🧩 常用页面

| 页面 | 本地地址 |
| --- | --- |
| 首页 | `http://localhost:3000` |
| 全品类商品图 | `http://localhost:3000/studio-genesis/workspace` |
| 图片精修 | `http://localhost:3000/refinement-studio` |
| 万能画布 | `http://localhost:3000/canvas-studio` |
| 风格复刻 | `http://localhost:3000/aesthetic-mirror` |
| 服装组图 | `http://localhost:3000/clothing-studio` |

---

## 🧠 后端 API 示例

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/studio-genesis/analyze` | `POST` | 商品图分析任务 |
| `/api/studio-genesis/generate` | `POST` | 商品图生成任务 |
| `/api/refinement-studio/generate` | `POST` | 图片精修生成 |
| `/api/ocr` | `POST` | 图片文字识别 |
| `/api/edit-text` | `POST` | 图片文字替换 |
| `/api/canvas-studio/smart-layer` | `POST / GET` | 智能分层任务提交与轮询 |
| `/api/upload` | `POST` | 上传文件 |

---

## 🗂️ 运行时文件

以下内容默认不进入 Git：

| 路径/类型 | 说明 |
| --- | --- |
| `.env`, `.env.*` | 本地密钥 |
| `node_modules/` | 依赖目录 |
| `.next/` | Next.js 构建缓存 |
| `backend/uploads/` | 用户上传和生成结果 |
| `backend/data/` | 本地数据文件 |
| `*.sqlite`, `*.db` | 本地数据库 |
| `*.tsbuildinfo` | TypeScript 缓存 |
| `.DS_Store` | macOS 系统文件 |

---

## ❓ 常见问题

### 页面能打开，但生成失败？

检查 `backend/.env` 中的模型地址、模型名称、API Key 是否配置正确，并确认后端服务运行在 `3001` 端口。

### 前端请求不到后端？

确认 `frontend/.env`：

```bash
BACKEND_URL=http://localhost:3001
```

### 为什么仓库里没有真实 `.env`？

这是刻意设计。开源仓库不能提交真实密钥。请复制 `.env.example` 到 `.env` 后在本地填写。

### 上传图片和生成文件在哪里？

默认在后端运行时目录中生成，例如 `backend/uploads/`。这些文件已被 `.gitignore` 排除。

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。提交前建议先运行：

```bash
npm --prefix frontend run typecheck
npm --prefix backend run typecheck
```

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

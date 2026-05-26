# Open PicsetAI

Open PicsetAI is an AI image commerce studio built with Next.js. It includes product image generation, style recreation, clothing image workflows, image refinement, knowledge product assets, and a canvas studio with image editing and smart layer export experiments.

## Features

- Product image workflow with analysis, prompt writing, generation jobs, and history.
- Style recreation and clothing studio pages for guided image production.
- Image refinement tools including OCR and text replacement APIs.
- Canvas studio with upload, image selection, text editing, smart layer extraction, and PSD/JSX export package generation.
- Frontend/backend split into two Next.js apps for easier local development and API isolation.

## Project Structure

```text
.
├── frontend/          # User-facing Next.js app, runs on port 3000
├── backend/           # API Next.js app, runs on port 3001
├── package.json       # Root scripts for running both apps
└── README.md
```

## Requirements

- Node.js 20 or newer is recommended.
- npm 10 or newer.
- API keys for the text and image model providers you want to use.

## Environment Configuration

Never commit real `.env` files or API keys. This repository includes `.env.example` files only.

Create local environment files:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

Frontend variables:

```bash
BACKEND_URL=http://localhost:3001
STUDIO_GENESIS_TEXT_MODEL=
STUDIO_GENESIS_TEXT_API_KEY=
STUDIO_GENESIS_TEXT_BASE_URL=
STUDIO_GENESIS_IMAGE_MODEL=
STUDIO_GENESIS_IMAGE_API_KEY=
STUDIO_GENESIS_IMAGE_BASE_URL=
STUDIO_GENESIS_IMAGE_ENDPOINT=
```

Backend variables:

```bash
STUDIO_GENESIS_SQLITE_PATH=
STUDIO_GENESIS_DEV_USER_ID=dev-user
STUDIO_GENESIS_DEV_MERCHANT_ID=dev-merchant
STUDIO_GENESIS_TEXT_MODEL=
STUDIO_GENESIS_TEXT_API_KEY=
STUDIO_GENESIS_TEXT_BASE_URL=
STUDIO_GENESIS_IMAGE_MODEL=
STUDIO_GENESIS_IMAGE_API_KEY=
STUDIO_GENESIS_IMAGE_BASE_URL=
STUDIO_GENESIS_IMAGE_ENDPOINT=
```

`STUDIO_GENESIS_*_BASE_URL`, `STUDIO_GENESIS_*_MODEL`, and API key values depend on the model provider you configure. Keep provider-specific keys only in your local `.env` files or deployment secret manager.

## Install

Install root tooling and each app's dependencies:

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

## Local Development

Start frontend and backend together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:backend
npm run dev:frontend
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`

Common pages:

- `http://localhost:3000/studio-genesis/workspace`
- `http://localhost:3000/refinement-studio`
- `http://localhost:3000/canvas-studio`
- `http://localhost:3000/aesthetic-mirror`
- `http://localhost:3000/clothing-studio`

## Type Checking

```bash
npm --prefix frontend run typecheck
npm --prefix backend run typecheck
```

## Build

```bash
npm --prefix backend run build
npm --prefix frontend run build
```

Production start commands:

```bash
npm --prefix backend run start
npm --prefix frontend run start
```

## Runtime Files

Generated uploads, smart-layer packages, temporary images, SQLite databases, local build output, and `.env` files are ignored by Git. If you need to preserve runtime outputs, store them outside the repository or upload them to object storage.

## Security Notes

- Do not commit `.env`, API keys, generated upload files, user images, or database files.
- Use `.env.example` to document required variables without secrets.
- In production, configure secrets through the deployment platform's secret manager.

## License

Add a license file before publishing if you want to define reuse terms clearly.

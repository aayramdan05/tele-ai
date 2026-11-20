# Hive board

_Shared plans live here. The god agent is the scribe._

## Tele-AI Studio Platform
- **Objective**: Autonomous AI Agent platform bridging Telegram chat to VPS terminal execution, video clipping automation, and Web UI quota/flow monitor without 403 blocks.
- **Engine**: Antigravity CLI (`agy`) & Google OAuth 2.0.
- **Status**: v1 Live. v2 upgrade IN PROGRESS (TAL-2 & TAL-3).
- **Components Active (v1)**:
  - Web Dashboard & Live Flow Monitor (`public/`, `server/index.js`)
  - Strict Concurrency Queue & Circuit Breaker (`server/circuit-breaker.js`)
  - Telegram Gateway with Whitelisting (`server/telegram-service.js`)
  - Autonomous FB Reels Clipper (`scripts/clipper-helper.py`)
  - Cron Scheduler (`server/cron-service.js`)
  - JSON file DB (`data/db.json`)

## v2 Upgrade — IN PROGRESS
- **TAL-2** (backend): PostgreSQL migration, API hardening, session management, agy session persistence → worker-backend
- **TAL-3** (frontend): Dashboard v2, PostgreSQL admin panel, real-time improvements → worker-frontend
- **Stack target**: Node.js + Express + PostgreSQL 18 (already running on this machine)
- **PostgreSQL binary**: `C:\Program Files\PostgreSQL\18\bin\psql.exe`
- **Project CWD**: `D:\Unpad\Infra Apps\tele-ai`
- **Key constraint**: Do NOT call Google API directly — all AI calls must go through `agy` CLI (Antigravity proxy). No raw Gemini API hits.

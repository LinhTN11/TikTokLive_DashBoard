# TikTok Live Overlay App

Next.js dashboard and OBS overlay routes backed by a custom Node server, Socket.IO, and Postgres.

## Local development

```powershell
copy .env.example .env
docker compose up -d postgres
npm.cmd run db:live:apply
npm.cmd run dev:live
```

Open `http://localhost:3000`.

## Overlay routes

- `/overlays/gift`
- `/overlays/follow`
- `/overlays/chat`
- `/overlays/chat/vip`
- `/overlays/chat/donator`

## Adding a chat theme

Add a theme entry in `apps/live-overlay/src/features/themes/registry.tsx`, then add a matching database rule through the dashboard or by inserting into `theme_rules`.

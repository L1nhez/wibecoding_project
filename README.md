# Telegram Habit Tracker

A minimal Telegram Mini App for tracking daily habits.

## What it does

- Saves habit data per Telegram user.
- Uses a dark, Telegram-friendly interface.
- Tracks today's habit check-ins.
- Stores a short daily note.
- Shows simple 7, 14, and 30 day progress history.

## Run locally

```powershell
npm start
```

Open `http://localhost:3000`.

When opened outside Telegram, the app uses a demo user. Inside Telegram, it reads the current user from `Telegram.WebApp.initData`.

## Telegram setup

1. Create a bot with BotFather.
2. Create a Mini App / Web App URL that points to your deployed app.
3. For production request verification, set:

```powershell
$env:BOT_TOKEN="your_bot_token"
npm start
```

User data is stored in `data/habit-state.json`, which is intentionally ignored by git.
Set `DATA_DIR` to store the file in another directory.

## Deploy on Render

1. Push this repository to GitHub.
2. In Render, create a new Web Service from this repository.
3. Use `npm start` as the start command.
4. Add `BOT_TOKEN` as an environment variable.
5. For real user data, add persistent storage and set `DATA_DIR` to that mounted directory.
6. Use the Render HTTPS URL as the Telegram Mini App URL.

The included `render.yaml` can be used as a blueprint.

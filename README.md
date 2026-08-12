# vc-lock-bot

Discord bot with `/lock` and `/unlock` slash commands to restrict who can join your current voice channel.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your values.
3. `npm start`

## Deploying on Render (free)

1. Push this repo to GitHub.
2. On [render.com](https://render.com), New → Web Service → connect this repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables from your `.env` in the Render dashboard (Environment tab): `TOKEN`, `CLIENT_ID`, `GUILD_ID`, `VERIFIED_ROLE_ID`, `MEMBER_ROLE_ID`.
6. Deploy. Render assigns a public URL that responds `Bot is running.` — this is only used for health checks/keep-alive pings, not by Discord.

Render's free tier spins the service down after ~15 minutes of no HTTP traffic. To keep the bot alive 24/7, set up a free Cloudflare Worker Cron Trigger that pings the Render URL every 10 minutes (see repo notes / ask for setup help).

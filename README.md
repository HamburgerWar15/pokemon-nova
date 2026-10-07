# Pokémon Nova

A browser-based fan game built around roulette collecting, progression, solo adventure, and friend play.

## Included

- Accounts and persistent saves
- 1,025-species roulette pool powered by PokéAPI names and artwork
- 1/64 base shiny odds on roulette pulls
- Free first spin, coin economy, training, levels, XP and 6-Pokémon teams
- Nine regions: Kanto through Paldea
- Region gyms, badges, Elite Four and endless Battle Tower
- Expeditions and legendary raids
- Daily quests
- Friends, friend requests and async PvP
- Friend-to-friend trading
- Global leaderboard
- Mobile/desktop responsive UI
- Render blueprint with a persistent disk

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Render

The included `render.yaml` creates a Node web service with a persistent disk mounted at `/var/data`. Player accounts and game state are written to `/var/data/db.json` when deployed with that disk.

Health check: `/api/health`

## Notes

This is an unofficial fan-made project and is not affiliated with Nintendo, Game Freak, The Pokémon Company, or PokéAPI.

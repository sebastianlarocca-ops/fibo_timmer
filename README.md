# Fibonacci Workout Timer

A PWA workout timer based on the Fibonacci sequence (1, 2, 3, 5, 8 min blocks), with a Tabata mode and a workout history dashboard.

## Features

- **Fibonacci Timer** — 5 work blocks (1, 2, 3, 5, 8 min) with rest intervals. Totals ~23 min.
- **Exercise setup** — assign exercises to Core (3 min), Bodyweight (5 min), and Overload (8 min) blocks before starting.
- **Live countdown** — shows total remaining workout time while the timer runs.
- **Tabata mode** — accessible via the floating TABATA button.
- **Dashboard** — workout history per day with a mini table (Core / BD / OV) showing exercises done, plus This Month count and Last Workout stats.
- **MongoDB persistence** — workouts are saved to a backend API on Render; data survives across devices.
- **PWA** — installable, works offline after first load.

## Stack

- Frontend: vanilla HTML/CSS/JS, hosted on Netlify
- Backend: Node.js + Express + MongoDB (Mongoose), hosted on Render

## Live

[lovely-clafoutis-884099.netlify.app](https://lovely-clafoutis-884099.netlify.app)

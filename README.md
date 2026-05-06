# Fibonacci Workout Timer

A PWA workout timer based on the Fibonacci sequence (1, 2, 3, 5, 8 min blocks), with a Tabata mode and a workout history dashboard.

## Features

- **Fibonacci Timer** — 5 work blocks (1, 2, 3, 5, 8 min) with rest intervals. Totals ~23 min.
- **Exercise setup** — assign exercises to Core (3 min), Bodyweight (5 min), and Overload (8 min) blocks before starting. Plan persists in MongoDB and syncs across devices.
- **Live countdown** — shows total remaining workout time while the timer runs.
- **Tabata mode** — configurable work/rest/rounds timer.
- **Dashboard** — workout history per day with a mini table (Core / BD / OV) showing exercises done, plus This Month count and Last Workout stats.
- **MongoDB persistence** — workouts and current exercise plan saved to a backend API on Render; data survives across devices and browser clears.
- **PWA** — installable, works offline after first load.

## Stack

- Frontend: vanilla HTML/CSS/JS, hosted on Vercel
- Backend: Node.js + Express + MongoDB (Mongoose), hosted on Render

## Live

[fibonacci-workout-timer.vercel.app](https://fibonacci-workout-timer.vercel.app)

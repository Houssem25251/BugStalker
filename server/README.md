# BugStalker — Gateway (Node + Express)

Step 1 of the build order: **authentication only**. Signup, login, JWT sessions,
bcrypt-hashed passwords, users stored in Neon Postgres via Drizzle.

## Setup

```bash
cd server
npm install
cp .env.example .env   # then fill in DATABASE_URL and JWT_SECRET
npm run db:push        # creates the `users` table in your Neon database
npm run dev            # starts on http://localhost:3000
```

## Environment

| Variable         | What it is                                             |
|------------------|--------------------------------------------------------|
| `DATABASE_URL`   | Neon Postgres connection string                        |
| `JWT_SECRET`     | Long random string used to sign session tokens         |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`)                          |
| `PORT`           | Port to listen on (default `3000`)                     |

## Endpoints

| Method | Path           | Body                       | Returns                          |
|--------|----------------|----------------------------|----------------------------------|
| GET    | `/health`      | —                          | `{ status: "ok" }`               |
| POST   | `/auth/signup` | `{ email, password }`      | `201 { user, token }`            |
| POST   | `/auth/login`  | `{ email, password }`      | `200 { user, token }`            |
| GET    | `/auth/me`     | — (Bearer token)           | `200 { user }`                   |

- `password` must be at least 8 characters.
- Authenticated requests send `Authorization: Bearer <token>`.

## Database

- Schema lives in `src/db/schema.js`.
- `npm run db:push` syncs the schema straight to the DB (fine while iterating).
- `npm run db:generate` + `npm run db:migrate` for versioned SQL migrations later.
- `npm run db:studio` opens Drizzle Studio to browse the data.

## Scope

This service is intentionally limited to auth. Jobs, the Python agent, and the
React frontend come in later steps — do not build them here yet.

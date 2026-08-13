# TAYO ACADEMY — production architecture

The original responsive HTML/CSS/JavaScript interface is preserved. It is now paired with an Express API, PostgreSQL database, Prisma ORM, and cookie-based server sessions.

## What changed

- PostgreSQL models cover users, student/teacher profiles, classes, subjects, teaching assignments, attendance, results, fees, timetable, assignments, exams, announcements, notifications, and password-reset tokens.
- Passwords are salted and hashed with bcrypt; they are never returned by the API. The browser receives an HTTP-only session cookie, not an authentication token in localStorage.
- API authorization is server-side. Students are scoped to their own records; teachers are scoped to their assigned classes; administrators have full access.
- Student registration links to a matching existing student number, otherwise creates a pending account for administrator approval.
- `robots.txt`, sitemap, and basic Open Graph/description metadata have been added. Update `YOUR-DOMAIN.example` before publishing the sitemap.

## Run locally

1. Install Node.js 20+ and PostgreSQL 15+.
2. Copy `.env.example` to `.env`; set `DATABASE_URL`, a long random `SESSION_SECRET`, and a strong `ADMIN_PASSWORD`.
3. Run `npm install`, `npm run db:generate`, and `npm run db:migrate -- --name initial`.
4. Create the first administrator with `npm run seed`.
5. Start with `npm run dev`, then open `http://localhost:3000`.

## Migrate current browser data safely

1. In the old app, use **Settings → Export JSON** in every browser profile that contains records.
2. Back up each exported file outside the project.
3. With the production database configured, run `npm run migrate:legacy -- path/to/schoolos-backup.json`.
4. The importer uses `studentNumber`, `teacherNumber`, class name, and subject code as natural keys and upserts them, avoiding duplicate student/teacher records. Review result/fee imports before running it a second time.
5. Create/activate staff accounts through the administrator API or database administration process; never copy the legacy browser passwords, as those were not secure hashes.

## Deploy

Host this Node service (for example Render, Railway, Fly.io, or a VPS) and a managed PostgreSQL instance. Set every `.env` value in the host dashboard, run `npm run db:deploy` then `npm run seed` once, and serve the app over HTTPS. Set `NODE_ENV=production`; secure cookies are then enabled. Point the sitemap to the public canonical domain and submit it to Google Search Console. Dashboard/login routes are marked or disallowed from indexing.

## API

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/auth/register/student`
- `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`
- `GET|POST /api/{students,teachers,classes,subjects,attendance,results,fees,timetable,assignments,exams,announcements,notifications}`
- `PATCH|DELETE /api/:resource/:id`
- `GET /api/admin/pending-students`, `POST /api/admin/users/:id/approve`, `POST /api/admin/users/:id/reject`

The password reset request intentionally needs an email provider integration before it can deliver its one-time token. No email credentials are invented or committed here.

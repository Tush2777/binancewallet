# Binance clone local server

## Run

Requires Node.js 18 or newer.

```bash
npm start
```

Open <http://127.0.0.1:3000> to use the app. The server serves `app.html` at `/`.

The app uses MySQL. On first connection it creates the `users`, `assets`, `addresses`, and `transactions` tables and seeds demo user `demo@example.com` with an approved account and 1,000 USDT. New accounts are approved immediately for this local demo.

Set these environment variables before running locally:

```bash
export MYSQL_HOST=mysql-fastbinary-tomtylaofficial-3c44.l.aivencloud.com
export MYSQL_PORT=10915
export MYSQL_USER=avnadmin
export MYSQL_PASSWORD=your-aiven-password
export MYSQL_DATABASE=defaultdb
export MYSQL_CA_PATH=./ca.pem
```

The server exposes the API already used by the page: account creation/login, balances, assets, deposit addresses, payments, transfers, and withdrawals.

## Admin panel

Open <http://127.0.0.1:3000/admin.html>. Enter the admin key `change-me-admin` for local development.

For a different key, start the server with:

```bash
ADMIN_KEY=your-local-key npm start
```

The panel can create users, approve or suspend accounts, and add or subtract coin balances. Admin routes require the `x-admin-key` request header.

## Deploy to Vercel

1. Push this project to GitHub.
2. In Vercel, choose **Add New Project**, import `Tush2777/binancewallet`, and deploy.
3. Add the environment variable `ADMIN_KEY` in Vercel Project Settings. Do not use the default local key in production.
4. Redeploy after adding the variable.

The app will be available at the Vercel URL, with the dashboard at `/` and admin panel at `/admin.html`.

Set the same `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, and `MYSQL_CA_PATH` values in Vercel Project Settings. Use `MYSQL_CA_PATH=/var/task/ca.pem` on Vercel. The `ca.pem` file is included in the repository and is a public CA certificate; never commit database passwords.
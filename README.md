# Binance clone local server

## Run

Requires Node.js 18 or newer.

```bash
npm start
```

Open <http://127.0.0.1:3000> to use the app. The server serves `app.html` at `/`.

The database is stored in `data/app.json` and is created automatically on first start. It contains demo user `demo@example.com` with an approved account and 1,000 USDT. New accounts are approved immediately for this local demo.

The server exposes the API already used by the page: account creation/login, balances, assets, deposit addresses, payments, transfers, and withdrawals.

## Admin panel

Open <http://127.0.0.1:3000/admin.html>. Enter the admin key `change-me-admin` for local development.

For a different key, start the server with:

```bash
ADMIN_KEY=your-local-key npm start
```

The panel can create users, approve or suspend accounts, and add or subtract coin balances. Admin routes require the `x-admin-key` request header.
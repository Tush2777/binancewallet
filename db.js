const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'app.json');

const defaultDatabase = {
  nextUserId: 2,
  users: [
    {
      id: 1,
      email: 'demo@example.com',
      username: 'Demo User',
      status: 'approved',
      createdAt: '2026-01-01T00:00:00.000Z',
      balance: { usdt: 1000, todayPnl: 0 },
      assets: [
        { coin: 'USDT', name: 'TetherUS', balance: 1000, usdtValue: 1000 },
        { coin: 'BTC', name: 'Bitcoin', balance: 0, usdtValue: 0 },
        { coin: 'ETH', name: 'Ethereum', balance: 0, usdtValue: 0 }
      ],
      addresses: {
        USDT: 'TQdemoUSDTAddress7YkVh4f2n9L8m3P6',
        BNB: 'bnb1demoaddress7y kvh4f2n9l8m3p6'.replaceAll(' ', '')
      },
      transactions: []
    }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify(defaultDatabase, null, 2));
  }
}

function readDatabase() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}

function writeDatabase(database) {
  ensureDatabase();
  const tempFile = `${dbFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(database, null, 2));
  fs.renameSync(tempFile, dbFile);
}

function updateDatabase(mutator) {
  const database = readDatabase();
  const result = mutator(database);
  writeDatabase(database);
  return result;
}

function findUser(database, userId) {
  return database.users.find((user) => user.id === Number(userId));
}

function publicUser(user) {
  return { uid: user.id, username: user.username, email: user.email, status: user.status };
}

function normalizeUser(user) {
  user.balance ||= { usdt: 0, todayPnl: 0 };
  user.assets ||= [];
  user.addresses ||= {};
  user.transactions ||= [];
  return user;
}

function balanceForUser(user) {
  normalizeUser(user);
  const totalUsdt = user.assets.reduce((total, asset) => total + Number(asset.usdtValue || asset.balance || 0), 0);
  return {
    uid: user.id,
    totalUsdt: totalUsdt.toFixed(2),
    todayPnl: Number(user.balance.todayPnl || 0).toFixed(2),
    todayPnlPercent: '0.00'
  };
}

module.exports = {
  listUsers() {
    const database = readDatabase();
    return database.users.map((user) => {
      normalizeUser(user);
      return {
        ...publicUser(user),
        createdAt: user.createdAt,
        totalUsdt: balanceForUser(user).totalUsdt,
        assets: clone(user.assets),
        transactions: clone(user.transactions)
      };
    });
  },

  createUser({ email, username }) {
    return updateDatabase((database) => {
      const existing = database.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
      if (existing) return { error: 'email_exists' };

      const user = normalizeUser({
        id: database.nextUserId++,
        email,
        username,
        status: 'approved',
        createdAt: new Date().toISOString(),
        balance: { usdt: 0, todayPnl: 0 },
        assets: [],
        addresses: {
          USDT: `TQ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
          BNB: `bnb1${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
        },
        transactions: []
      });
      database.users.push(user);
      return publicUser(user);
    });
  },

  updateUserStatus(userId, status) {
    return updateDatabase((database) => {
      const user = findUser(database, userId);
      if (!user) return null;
      if (!['approved', 'pending', 'suspended'].includes(status)) return { error: 'invalid_status' };
      user.status = status;
      return publicUser(user);
    });
  },

  adjustAsset(userId, { coin, name, amount, usdtValue }) {
    return updateDatabase((database) => {
      const user = findUser(database, userId);
      const numericAmount = Number(amount);
      if (!user) return { error: 'user_not_found' };
      if (!coin || !Number.isFinite(numericAmount) || numericAmount === 0) return { error: 'invalid_asset' };
      normalizeUser(user);
      const normalizedCoin = String(coin).trim().toUpperCase();
      let asset = user.assets.find((candidate) => candidate.coin.toUpperCase() === normalizedCoin);
      if (!asset) {
        asset = { coin: normalizedCoin, name: name || normalizedCoin, balance: 0, usdtValue: 0 };
        user.assets.push(asset);
      }
      const nextBalance = Number(asset.balance || 0) + numericAmount;
      if (nextBalance < 0) return { error: 'insufficient_balance' };
      asset.balance = nextBalance;
      asset.name = name || asset.name || normalizedCoin;
      asset.usdtValue = Number.isFinite(Number(usdtValue))
        ? Number(usdtValue)
        : Number(asset.usdtValue || 0) + numericAmount;
      user.transactions.unshift({
        id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        type: 'admin_adjustment',
        coin: normalizedCoin,
        amount: numericAmount,
        createdAt: new Date().toISOString()
      });
      return { user: publicUser(user), balance: balanceForUser(user), assets: clone(user.assets) };
    });
  },

  loginByEmail(email) {
    const database = readDatabase();
    const user = database.users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
    if (!user) return null;
    if (user.status !== 'approved') return { error: 'pending' };
    return publicUser(user);
  },

  getUser(userId) {
    const database = readDatabase();
    const user = findUser(database, userId);
    return user ? normalizeUser(user) : null;
  },

  getBalance(userId) {
    const user = this.getUser(userId);
    if (!user) return null;
    return balanceForUser(user);
  },

  getAssets(userId) {
    const user = this.getUser(userId);
    return user ? { uid: user.id, assets: clone(user.assets) } : null;
  },

  getAddresses(userId) {
    const user = this.getUser(userId);
    return user ? { uid: user.id, address: user.addresses.BNB, usdtAddress: user.addresses.USDT } : null;
  },

  addTransaction(userId, transaction) {
    return updateDatabase((database) => {
      const user = findUser(database, userId);
      if (!user) return null;
      normalizeUser(user).transactions.unshift({
        id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        createdAt: new Date().toISOString(),
        ...transaction
      });
      return balanceForUser(user);
    });
  },

  sendFunds(userId, { coin, amount, recipient, site }) {
    return updateDatabase((database) => {
      const user = findUser(database, userId);
      if (!user) return { error: 'user_not_found' };
      normalizeUser(user);
      const asset = user.assets.find((candidate) => candidate.coin.toUpperCase() === coin.toUpperCase());
      const numericAmount = Number(amount);
      if (!asset || !Number.isFinite(numericAmount) || numericAmount <= 0) return { error: 'invalid_amount' };
      if (Number(asset.balance) < numericAmount) return { error: 'insufficient_balance' };
      asset.balance = Number(asset.balance) - numericAmount;
      asset.usdtValue = Number(asset.usdtValue || 0) - numericAmount;
      user.transactions.unshift({
        id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        type: site ? 'site_payment' : 'send',
        coin: coin.toUpperCase(),
        amount: numericAmount,
        recipient: recipient || null,
        site: site || null,
        createdAt: new Date().toISOString()
      });
      return { id: user.transactions[0].id, balance: balanceForUser(user) };
    });
  }
};
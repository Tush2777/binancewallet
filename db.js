const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'defaultdb',
  ssl: { ca: fs.readFileSync(process.env.MYSQL_CA_PATH || path.join(__dirname, 'ca.pem')) },
  waitForConnections: true,
  connectionLimit: 4,
  queueLimit: 0
});

let ready;

async function ensureDatabase() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        username VARCHAR(255) NOT NULL,
        status ENUM('approved', 'pending', 'suspended') NOT NULL DEFAULT 'approved',
        created_at DATETIME NOT NULL
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS assets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        coin VARCHAR(32) NOT NULL,
        name VARCHAR(255) NOT NULL,
        balance DECIMAL(36, 18) NOT NULL DEFAULT 0,
        usdt_value DECIMAL(36, 18) NOT NULL DEFAULT 0,
        UNIQUE KEY user_coin (user_id, coin),
        CONSTRAINT assets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS addresses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        coin VARCHAR(32) NOT NULL,
        address VARCHAR(255) NOT NULL,
        UNIQUE KEY user_address_coin (user_id, coin),
        CONSTRAINT addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type VARCHAR(64) NOT NULL,
        coin VARCHAR(32),
        amount DECIMAL(36, 18),
        recipient VARCHAR(255),
        site VARCHAR(255),
        created_at DATETIME NOT NULL,
        CONSTRAINT transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      const [rows] = await pool.query('SELECT id FROM users LIMIT 1');
      if (!rows.length) {
        const [result] = await pool.execute('INSERT INTO users (email, username, status, created_at) VALUES (?, ?, ?, ?)', ['demo@example.com', 'Demo User', 'approved', new Date()]);
        await pool.execute('INSERT INTO assets (user_id, coin, name, balance, usdt_value) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)', [result.insertId, 'USDT', 'TetherUS', 1000, 1000, result.insertId, 'BTC', 'Bitcoin', 0, 0, result.insertId, 'ETH', 'Ethereum', 0, 0]);
        await pool.execute('INSERT INTO addresses (user_id, coin, address) VALUES (?, ?, ?), (?, ?, ?)', [result.insertId, 'USDT', 'TQdemoUSDTAddress7YkVh4f2n9L8m3P6', result.insertId, 'BNB', 'bnb1demoaddress7ykvh4f2n9l8m3p6']);
      }
    })().catch((error) => { ready = null; throw error; });
  }
  return ready;
}

function publicUser(user) {
  return { uid: user.id, username: user.username, email: user.email, status: user.status };
}

function assetValue(asset) {
  return { coin: asset.coin, name: asset.name, balance: Number(asset.balance), usdtValue: Number(asset.usdt_value) };
}

async function getUser(userId) {
  await ensureDatabase();
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

async function getUserByEmail(email) {
  await ensureDatabase();
  const [rows] = await pool.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  return rows[0] || null;
}

async function getAssetsForUser(userId) {
  const [rows] = await pool.execute('SELECT coin, name, balance, usdt_value FROM assets WHERE user_id = ? ORDER BY id', [userId]);
  return rows.map(assetValue);
}

async function balanceForUser(userId) {
  const user = await getUser(userId);
  if (!user) return null;
  const [rows] = await pool.execute('SELECT COALESCE(SUM(usdt_value), 0) AS total FROM assets WHERE user_id = ?', [userId]);
  return { uid: user.id, totalUsdt: Number(rows[0].total).toFixed(2), todayPnl: '0.00', todayPnlPercent: '0.00' };
}

async function transactionRows(userId) {
  const [rows] = await pool.execute('SELECT id, type, coin, amount, recipient, site, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC', [userId]);
  return rows.map((row) => ({ id: String(row.id), type: row.type, coin: row.coin, amount: Number(row.amount), recipient: row.recipient, site: row.site, createdAt: row.created_at }));
}

module.exports = {
  async listUsers() {
    await ensureDatabase();
    const [users] = await pool.query('SELECT * FROM users ORDER BY id');
    return Promise.all(users.map(async (user) => ({ ...publicUser(user), createdAt: user.created_at, totalUsdt: (await balanceForUser(user.id)).totalUsdt, assets: await getAssetsForUser(user.id), transactions: await transactionRows(user.id) })));
  },

  async createUser({ email, username }) {
    await ensureDatabase();
    try {
      const [result] = await pool.execute('INSERT INTO users (email, username, status, created_at) VALUES (?, ?, ?, ?)', [email, username, 'approved', new Date()]);
      await pool.execute('INSERT INTO addresses (user_id, coin, address) VALUES (?, ?, ?), (?, ?, ?)', [result.insertId, 'USDT', `TQ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`, result.insertId, 'BNB', `bnb1${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`]);
      return publicUser({ id: result.insertId, email, username, status: 'approved' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return { error: 'email_exists' };
      throw error;
    }
  },

  async updateUserStatus(userId, status) {
    await ensureDatabase();
    if (!['approved', 'pending', 'suspended'].includes(status)) return { error: 'invalid_status' };
    const [result] = await pool.execute('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    return result.affectedRows ? publicUser({ ...(await getUser(userId)), status }) : null;
  },

  async adjustAsset(userId, { coin, name, amount, usdtValue }) {
    await ensureDatabase();
    const numericAmount = Number(amount);
    if (!coin || !Number.isFinite(numericAmount) || numericAmount === 0) return { error: 'invalid_asset' };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [users] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (!users.length) { await connection.rollback(); return { error: 'user_not_found' }; }
      const normalizedCoin = String(coin).trim().toUpperCase();
      const [assets] = await connection.execute('SELECT * FROM assets WHERE user_id = ? AND coin = ? FOR UPDATE', [userId, normalizedCoin]);
      const current = assets[0] || { balance: 0, usdt_value: 0 };
      const nextBalance = Number(current.balance) + numericAmount;
      if (nextBalance < 0) { await connection.rollback(); return { error: 'insufficient_balance' }; }
      await connection.execute('INSERT INTO assets (user_id, coin, name, balance, usdt_value) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), balance = VALUES(balance), usdt_value = VALUES(usdt_value)', [userId, normalizedCoin, name || normalizedCoin, nextBalance, Number.isFinite(Number(usdtValue)) ? Number(usdtValue) : Number(current.usdt_value) + numericAmount]);
      await connection.execute('INSERT INTO transactions (user_id, type, coin, amount, created_at) VALUES (?, ?, ?, ?, ?)', [userId, 'admin_adjustment', normalizedCoin, numericAmount, new Date()]);
      await connection.commit();
      return { user: publicUser(users[0]), balance: await balanceForUser(userId), assets: await getAssetsForUser(userId) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  },

  async loginByEmail(email) {
    const user = await getUserByEmail(email);
    if (!user) return null;
    if (user.status !== 'approved') return { error: 'pending' };
    return publicUser(user);
  },

  async getBalance(userId) { return balanceForUser(userId); },
  async getAssets(userId) { return (await getUser(userId)) ? { uid: Number(userId), assets: await getAssetsForUser(userId) } : null; },
  async getAddresses(userId) {
    if (!(await getUser(userId))) return null;
    const [rows] = await pool.execute('SELECT coin, address FROM addresses WHERE user_id = ?', [userId]);
    const addresses = Object.fromEntries(rows.map((row) => [row.coin, row.address]));
    return { uid: Number(userId), address: addresses.BNB, usdtAddress: addresses.USDT };
  },

  async sendFunds(userId, { coin, amount, recipient, site }) {
    await ensureDatabase();
    const numericAmount = Number(amount);
    if (!coin || !Number.isFinite(numericAmount) || numericAmount <= 0) return { error: 'invalid_amount' };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [assets] = await connection.execute('SELECT * FROM assets WHERE user_id = ? AND coin = ? FOR UPDATE', [userId, String(coin).toUpperCase()]);
      if (!assets.length) { await connection.rollback(); return { error: 'invalid_amount' }; }
      if (Number(assets[0].balance) < numericAmount) { await connection.rollback(); return { error: 'insufficient_balance' }; }
      await connection.execute('UPDATE assets SET balance = balance - ?, usdt_value = usdt_value - ? WHERE user_id = ? AND coin = ?', [numericAmount, numericAmount, userId, String(coin).toUpperCase()]);
      const [result] = await connection.execute('INSERT INTO transactions (user_id, type, coin, amount, recipient, site, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, site ? 'site_payment' : 'send', String(coin).toUpperCase(), numericAmount, recipient || null, site || null, new Date()]);
      await connection.commit();
      return { id: String(result.insertId), balance: await balanceForUser(userId) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  }
};

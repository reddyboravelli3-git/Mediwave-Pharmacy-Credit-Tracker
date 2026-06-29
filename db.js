const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'mediwave_pharmacy.db');

// Connect to SQLite Database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err);
  } else {
    console.log('Connected to SQLite database at:', DB_PATH);
  }
});

// Initialize database schema
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Create Users Table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL
        )
      `);

      // 2. Create Vendors Table
      db.run(`
        CREATE TABLE IF NOT EXISTS vendors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          city TEXT NOT NULL,
          state TEXT NOT NULL
        )
      `);

      // 3. Create Pharmacy Credit Dues Collection Table
      db.run(`
        CREATE TABLE IF NOT EXISTS pharmacy_credit_dues_collection (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vendor_id INTEGER NOT NULL,
          invoice_number TEXT UNIQUE NOT NULL,
          invoice_date TEXT NOT NULL,
          due_date TEXT NOT NULL,
          amount_due REAL NOT NULL,
          days_overdue INTEGER DEFAULT 0,
          escalation_flag INTEGER DEFAULT 0,
          assigned_to_user_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'Active',
          createdAt TEXT NOT NULL,
          FOREIGN KEY (vendor_id) REFERENCES vendors (id),
          FOREIGN KEY (assigned_to_user_id) REFERENCES users (id)
        )
      `);

      // 4. Create Payments Table
      db.run(`
        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          credit_due_id INTEGER NOT NULL,
          payment_date TEXT NOT NULL,
          amount_paid REAL NOT NULL,
          payment_method TEXT NOT NULL,
          FOREIGN KEY (credit_due_id) REFERENCES pharmacy_credit_dues_collection (id)
        )
      `);

      // 5. Create System Configuration Table
      db.run(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      // 6. Create Audit Logs Table
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          time TEXT NOT NULL,
          message TEXT NOT NULL
        )
      `);

      // Resolve schema build
      resolve();
    });
  });
}

// Seed Initial System Data
async function seedDatabase() {
  const hashAdmin = await bcrypt.hash('AdminPassword123', 10);
  const hashUser = await bcrypt.hash('UserPassword123', 10);
  const hashUser2 = await bcrypt.hash('RepSecure2026!', 10);

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Seed Users
      db.run(`INSERT OR IGNORE INTO users (id, email, password, name, role) VALUES 
        (1, 'admin@gmail.com', ?, 'Sahitya Reddy', 'admin'),
        (2, 'user@gmail.com', ?, 'Vikram Reddy', 'user'),
        (3, 'salesrep2@mediwave.com', ?, 'Ramesh Kumar', 'user')
      `, [hashAdmin, hashUser, hashUser2]);

      // 2. Seed Telangana Pharmacy Vendors
      db.run(`INSERT OR IGNORE INTO vendors (id, name, city, state) VALUES 
        (1, 'Apollo Pharmacy, Jubilee Hills', 'Hyderabad', 'Telangana'),
        (2, 'MedPlus Pharmacy, Gachibowli', 'Hyderabad', 'Telangana'),
        (3, 'Yashoda Pharmacy, Somajiguda', 'Hyderabad', 'Telangana'),
        (4, 'Care Pharmacy, Secunderabad', 'Secunderabad', 'Telangana'),
        (5, 'Royal Pharmacy, Hanamkonda', 'Warangal', 'Telangana'),
        (6, 'TruMed Pharmacy, Nizamabad', 'Nizamabad', 'Telangana')
      `);

      // 3. Seed Default System Configs
      db.run(`INSERT OR IGNORE INTO system_config (key, value) VALUES 
        ('escalationDays', '30'),
        ('creditLimit', '150000'),
        ('archiveDays', '15')
      `);

      // 4. Seed Credits
      const nowStr = new Date().toISOString();
      db.run(`INSERT OR IGNORE INTO pharmacy_credit_dues_collection 
        (id, vendor_id, invoice_number, invoice_date, due_date, amount_due, assigned_to_user_id, status, createdAt) VALUES 
        (1, 1, 'INV-2026-1001', '2026-05-10', '2026-05-24', 45000.00, 2, 'Active', '2026-05-10T10:00:00Z'),
        (2, 2, 'INV-2026-1002', '2026-06-01', '2026-06-15', 28000.00, 2, 'Completed', '2026-06-01T09:15:00Z'),
        (3, 3, 'INV-2026-1003', '2026-06-05', '2026-06-20', 62000.00, 2, 'Active', '2026-06-05T11:45:00Z'),
        (4, 4, 'INV-2026-1004', '2026-04-20', '2026-05-10', 85000.00, 3, 'Active', '2026-04-20T14:00:00Z'),
        (5, 5, 'INV-2026-1005', '2026-06-15', '2026-07-15', 35000.00, 3, 'Active', '2026-06-15T15:30:00Z')
      `);

      // 5. Seed Payments
      db.run(`INSERT OR IGNORE INTO payments (id, credit_due_id, payment_date, amount_paid, payment_method) VALUES 
        (1, 1, '2026-05-20', 15000.00, 'UPI'),
        (2, 2, '2026-06-14', 28000.00, 'Bank Transfer'),
        (3, 3, '2026-06-18', 10000.00, 'Cheque'),
        (4, 4, '2026-05-05', 25000.00, 'UPI')
      `);

      // 6. Seed Audit Logs
      db.run(`INSERT OR IGNORE INTO audit_logs (id, time, message) VALUES 
        (1, '2026-06-24T00:00:00Z', 'System database initialized and seeded with mock entries.')
      `);

      resolve();
    });
  });
}

// Reset Database Diagnostics
async function resetDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DROP TABLE IF EXISTS payments');
      db.run('DROP TABLE IF EXISTS pharmacy_credit_dues_collection');
      db.run('DROP TABLE IF EXISTS vendors');
      db.run('DROP TABLE IF EXISTS users');
      db.run('DROP TABLE IF EXISTS system_config');
      db.run('DROP TABLE IF EXISTS audit_logs');

      initDatabase()
        .then(seedDatabase)
        .then(resolve)
        .catch(reject);
    });
  });
}

module.exports = {
  db,
  initDatabase,
  seedDatabase,
  resetDatabase
};

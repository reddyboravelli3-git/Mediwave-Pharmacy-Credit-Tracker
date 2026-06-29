const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, initDatabase, seedDatabase, resetDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = 'mediwave-secret-rbac-key-2026-secure';

// Anchor Date Mock (June 24, 2026)
const MOCK_TODAY = new Date('2026-06-24');

// Middlewares
app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, '../Frontend')));

// Initialize database schema and seed
initDatabase()
  .then(() => seedDatabase())
  .then(() => console.log('SQLite Database schema initialized and pre-seeded.'))
  .catch(err => console.error('Database bootstrap error:', err));

// ==========================================================================
// UNIFIED ERROR WRAPPER & MIDDLEWARES
// ==========================================================================
function errorResponse(res, message, code = 500) {
  return res.status(code).json({
    success: false,
    message: message,
    code: code
  });
}

// Security Audit Log Helper
function logSystemAction(message) {
  const time = new Date().toISOString();
  db.run('INSERT INTO audit_logs (time, message) VALUES (?, ?)', [time, message], (err) => {
    if (err) console.error('Failed to log audit event:', err);
  });
}

// JWT Authenticator Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return errorResponse(res, 'Access denied. Security clearance token is missing.', 401);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return errorResponse(res, 'Access forbidden. Session token is expired or invalid.', 403);
    }
    req.user = user;
    next();
  });
}

// Admin-Only Role Guard Middleware
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    // Audit log violation attempt
    logSystemAction(`Unauthorized RBAC access attempt by user ${req.user ? req.user.email : 'Unknown'}`);
    return errorResponse(res, 'Access forbidden. Administrator clearance level required.', 403);
  }
}

// Helper to query config settings from db
function getSysConfig() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM system_config', (err, rows) => {
      if (err) return reject(err);
      const config = {};
      rows.forEach(r => {
        if (r.key === 'creditLimit') config[r.key] = parseFloat(r.value);
        else config[r.key] = parseInt(r.value);
      });
      resolve(config);
    });
  });
}

// ==========================================================================
// REST API ROUTES
// ==========================================================================

// 1. Auth Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return errorResponse(res, 'Email and password fields are required.', 400);
    }

    db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], async (err, user) => {
      if (err) {
        return errorResponse(res, 'Internal database query failure.', 500);
      }

      if (!user) {
        return errorResponse(res, 'Wrong credentials. Please check your email and password.', 400);
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return errorResponse(res, 'Wrong credentials. Please check your email and password.', 400);
      }

      // Generate JWT
      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: '12h' }
      );

      logSystemAction(`Session authenticated for representative: ${user.email} (${user.role.toUpperCase()})`);

      res.json({
        success: true,
        token: token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });
    });

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 1b. Auth Register Endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return errorResponse(res, 'All registration fields are required.', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, "user")',
      [email.toLowerCase(), hashedPassword, name],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return errorResponse(res, 'A user with this email address already exists.', 400);
          }
          return errorResponse(res, 'Database error during registration.', 500);
        }

        logSystemAction(`New representative registered: ${email}`);

        res.status(201).json({
          success: true,
          message: 'Registration successful. You can now log in.'
        });
      }
    );

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 1c. Auth Profile Update Endpoint
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const userId = req.user.id;

    if (!email || !name) {
      return errorResponse(res, 'Name and email fields are required.', 400);
    }

    db.get('SELECT * FROM users WHERE email = ? AND id != ?', [email.toLowerCase(), userId], async (err, existingUser) => {
      if (err) {
        return errorResponse(res, 'Internal database query failure.', 500);
      }

      if (existingUser) {
        return errorResponse(res, 'A user with this email address already exists.', 400);
      }

      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(
          'UPDATE users SET name = ?, email = ?, password = ? WHERE id = ?',
          [name, email.toLowerCase(), hashedPassword, userId],
          function (updateErr) {
            if (updateErr) {
              return errorResponse(res, 'Failed to update user profile.', 500);
            }
            sendProfileSuccess(res, userId, name, email);
          }
        );
      } else {
        db.run(
          'UPDATE users SET name = ?, email = ? WHERE id = ?',
          [name, email.toLowerCase(), userId],
          function (updateErr) {
            if (updateErr) {
              return errorResponse(res, 'Failed to update user profile.', 500);
            }
            sendProfileSuccess(res, userId, name, email);
          }
        );
      }
    });

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

function sendProfileSuccess(res, userId, name, email) {
  db.get('SELECT role FROM users WHERE id = ?', [userId], (err, user) => {
    if (err || !user) {
      return errorResponse(res, 'Internal database query failure.', 500);
    }

    logSystemAction(`Profile updated for representative: ${email} (${user.role.toUpperCase()})`);

    res.json({
      success: true,
      message: 'Profile details updated successfully.',
      user: {
        id: userId,
        email: email.toLowerCase(),
        name: name,
        role: user.role
      }
    });
  });
}

// 2. Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', project: 'Mediwave Pharmacy Tracker Backend' });
});

// 3. List Pharmacy Vendors Index
app.get('/api/vendors', authenticateToken, (req, res) => {
  try {
    db.all('SELECT * FROM vendors ORDER BY name ASC', (err, rows) => {
      if (err) {
        return errorResponse(res, 'Failed to retrieve vendors catalog.', 500);
      }
      res.json(rows);
    });
  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 4. List System Users / Representatives (Admin only filter utility)
app.get('/api/users', authenticateToken, (req, res) => {
  try {
    const { role } = req.query;
    let query = 'SELECT id, email, name, role FROM users';
    const params = [];
    
    if (role) {
      query += ' WHERE role = ?';
      params.push(role);
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        return errorResponse(res, 'Failed to fetch users records.', 500);
      }
      res.json(rows);
    });
  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 5. Query Config Rules
app.get('/api/config', authenticateToken, async (req, res) => {
  try {
    const configs = await getSysConfig();
    res.json(configs);
  } catch (err) {
    errorResponse(res, 'Failed to fetch system configurations.', 500);
  }
});

// 6. Save Config Rules (Admin only)
app.put('/api/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { escalationDays, creditLimit, archiveDays } = req.body;

    if (escalationDays === undefined || creditLimit === undefined || archiveDays === undefined) {
      return errorResponse(res, 'Missing rules params.', 400);
    }

    db.serialize(() => {
      db.run('UPDATE system_config SET value = ? WHERE key = ?', [String(escalationDays), 'escalationDays']);
      db.run('UPDATE system_config SET value = ? WHERE key = ?', [String(creditLimit), 'creditLimit']);
      db.run('UPDATE system_config SET value = ? WHERE key = ?', [String(archiveDays), 'archiveDays']);

      logSystemAction(`System billing rules configurations updated: Escalation = ${escalationDays}d, Limit = ₹${parseFloat(creditLimit).toLocaleString()}, Archive = ${archiveDays}d`);
      
      res.json({
        escalationDays: parseInt(escalationDays),
        creditLimit: parseFloat(creditLimit),
        archiveDays: parseInt(archiveDays)
      });
    });

  } catch (err) {
    errorResponse(res, 'Failed to update billing rules config.', 500);
  }
});

// 7. Get Security Audits Trail
app.get('/api/audit', authenticateToken, (req, res) => {
  try {
    db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100', (err, rows) => {
      if (err) {
        return errorResponse(res, 'Failed to fetch audits.', 500);
      }
      res.json(rows);
    });
  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 8. Purge Security Audits (Admin only)
app.delete('/api/audit', authenticateToken, requireAdmin, (req, res) => {
  try {
    db.run('DELETE FROM audit_logs', (err) => {
      if (err) {
        return errorResponse(res, 'Failed to clear audits.', 500);
      }
      logSystemAction(`Security audit trails cleared by administrator: ${req.user.email}`);
      res.json({ success: true, message: 'Audits cleared.' });
    });
  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 9. Reset Factory Diagnostics (Admin only)
app.post('/api/reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await resetDatabase();
    logSystemAction(`System database diagnostics factory reset triggered by: ${req.user.email}`);
    res.json({ success: true, message: 'Database reset to factory settings completed.' });
  } catch (err) {
    errorResponse(res, 'Factory reset diagnostic crashed.', 500);
  }
});

// ==========================================================================
// OUTSTANDING CREDITS & COLLECTIONS (CORE LEDGER API)
// ==========================================================================

// Helper to fetch details and map calculated fields dynamically
async function fetchAndCalculateCredits(userRole, userId, configRules) {
  return new Promise((resolve, reject) => {
    // Query links collection, vendors, and representative names
    let query = `
      SELECT c.*, v.name as vendor_name, v.city as vendor_city, v.state as vendor_state, u.name as assigned_rep_name
      FROM pharmacy_credit_dues_collection c
      LEFT JOIN vendors v ON c.vendor_id = v.id
      LEFT JOIN users u ON c.assigned_to_user_id = u.id
    `;
    const params = [];

    // RBAC Scoping: Standard user can ONLY access records assigned to them
    if (userRole !== 'admin') {
      query += ' WHERE c.assigned_to_user_id = ?';
      params.push(userId);
    }

    db.all(query, params, async (err, rows) => {
      if (err) return reject(err);

      try {
        const recordsList = [];
        for (let row of rows) {
          // Dynamic collections tally
          const payments = await new Promise((resPay, rejPay) => {
            db.all('SELECT * FROM payments WHERE credit_due_id = ?', [row.id], (errPay, rowsPay) => {
              if (errPay) rejPay(errPay);
              else resPay(rowsPay || []);
            });
          });

          // Calculate recovered sum
          let amount_recovered = 0;
          payments.forEach(p => amount_recovered += p.amount_paid);

          // Calculate outstanding
          const outstanding = row.amount_due - amount_recovered;

          // Calculate days overdue dynamically
          let days_overdue = 0;
          if (row.status === 'Active') {
            const dueDate = new Date(row.due_date);
            if (MOCK_TODAY > dueDate) {
              const diffTime = Math.abs(MOCK_TODAY - dueDate);
              days_overdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }
          }

          // Calculate escalation flag based on current configuration rules
          const escalation_flag = (row.status === 'Active' && days_overdue > configRules.escalationDays) ? 1 : 0;

          // Map audits list
          const auditsText = [
            { time: row.createdAt, message: `Initial database registration (Principal sum: ₹${row.amount_due.toLocaleString()})` }
          ];
          
          if (payments.length > 0) {
            payments.forEach(p => {
              auditsText.push({
                time: new Date(p.payment_date).toISOString(),
                message: `Logged collection installment of ₹${p.amount_paid.toLocaleString()} via ${p.payment_method}`
              });
            });
          }

          if (row.status === 'Completed') {
            auditsText.push({
              time: new Date().toISOString(),
              message: `Ledger outstanding cleared. File status Completed.`
            });
          } else if (row.status === 'Archived') {
            auditsText.push({
              time: new Date().toISOString(),
              message: `File archived by administrative override.`
            });
          }

          recordsList.push({
            id: row.id,
            vendor_id: row.vendor_id,
            invoice_number: row.invoice_number,
            invoice_date: row.invoice_date,
            due_date: row.due_date,
            amount_due: row.amount_due,
            amount_recovered: amount_recovered,
            days_overdue: days_overdue,
            escalation_flag: escalation_flag,
            assigned_to_user_id: row.assigned_to_user_id,
            assigned_rep_name: row.assigned_rep_name,
            status: row.status,
            vendor: {
              name: row.vendor_name,
              city: row.vendor_city,
              state: row.vendor_state
            },
            payments: payments.map(p => ({
              id: p.id,
              amount_paid: p.amount_paid,
              payment_date: p.payment_date,
              payment_method: p.payment_method
            })),
            audits: auditsText.reverse()
          });
        }
        resolve(recordsList);
      } catch (errMap) {
        reject(errMap);
      }
    });
  });
}

// 10. Fetch Credits List
app.get('/api/credits', authenticateToken, async (req, res) => {
  try {
    const configRules = await getSysConfig();
    const list = await fetchAndCalculateCredits(req.user.role, req.user.id, configRules);
    res.json(list);
  } catch (err) {
    errorResponse(res, 'Failed to query credits ledger.', 500);
  }
});

// 11. Log New Pharmacy Credit Invoice
app.post('/api/credits', authenticateToken, async (req, res) => {
  try {
    const { vendor_id, invoice_number, invoice_date, due_date, amount_due } = req.body;

    if (!vendor_id || !invoice_number || !invoice_date || !due_date || !amount_due) {
      return errorResponse(res, 'All invoice parameters are required.', 400);
    }

    const configRules = await getSysConfig();

    // Limit Validation
    if (parseFloat(amount_due) > configRules.creditLimit) {
      return errorResponse(res, `Credit Limit exception. Maximum allowed single invoice principal is ₹${configRules.creditLimit.toLocaleString()}`, 400);
    }

    // Date Bounds check
    if (new Date(due_date) < new Date(invoice_date)) {
      return errorResponse(res, 'Due date cannot precede the invoice issuance date.', 400);
    }

    // Set assigned representative user: standard user logs under their id, admin logs under their id
    const assigned_user_id = req.user.id;
    const createdAt = new Date().toISOString();

    db.run(
      `INSERT INTO pharmacy_credit_dues_collection 
      (vendor_id, invoice_number, invoice_date, due_date, amount_due, assigned_to_user_id, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)`,
      [vendor_id, invoice_number.trim(), invoice_date, due_date, parseFloat(amount_due), assigned_user_id, createdAt],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return errorResponse(res, 'An invoice with this serial number is already registered in the registry.', 400);
          }
          return errorResponse(res, 'Failed to write record to registry.', 500);
        }

        logSystemAction(`Logged credit invoice ${invoice_number} for vendor ID ${vendor_id} (Assigned rep: ${req.user.email})`);
        
        res.status(201).json({
          success: true,
          id: this.lastID,
          message: 'Pharmacy credit invoice successfully logged.'
        });
      }
    );

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 12. Edit Record (Admin only rule overrides)
app.put('/api/credits/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_due, status } = req.body;

    if (amount_due === undefined || !status) {
      return errorResponse(res, 'Missing override body details.', 400);
    }

    const configRules = await getSysConfig();

    if (parseFloat(amount_due) > configRules.creditLimit) {
      return errorResponse(res, `Rule limit violation: Cap is ₹${configRules.creditLimit.toLocaleString()}`, 400);
    }

    db.run(
      'UPDATE pharmacy_credit_dues_collection SET amount_due = ?, status = ? WHERE id = ?',
      [parseFloat(amount_due), status, id],
      function (err) {
        if (err) {
          return errorResponse(res, 'Failed to update credit file.', 500);
        }
        logSystemAction(`Admin override on credit ID ${id}: Principal adjusted to ₹${parseFloat(amount_due).toLocaleString()}, Status set to ${status}`);
        res.json({ success: true, message: 'Ledger record updated.' });
      }
    );

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 13. Log payment transaction collections
app.post('/api/credits/:id/payments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount_paid, payment_date, payment_method } = req.body;

    if (!amount_paid || !payment_date || !payment_method) {
      return errorResponse(res, 'Missing transaction payment credentials.', 400);
    }

    // 1. Fetch current credit invoice details
    db.get('SELECT * FROM pharmacy_credit_dues_collection WHERE id = ?', [id], (err, record) => {
      if (err || !record) {
        return errorResponse(res, 'Invoice record not found.', 404);
      }

      // Verify scope guard
      if (req.user.role !== 'admin' && record.assigned_to_user_id !== req.user.id) {
        return errorResponse(res, 'Unauthorized access guard blocks transaction.', 403);
      }

      // 2. Fetch payments logged to check outstanding
      db.all('SELECT amount_paid FROM payments WHERE credit_due_id = ?', [id], (errPay, paymentsList) => {
        if (errPay) return errorResponse(res, 'Internal database query failure.', 500);

        let recovered = 0;
        paymentsList.forEach(p => recovered += p.amount_paid);
        const outstanding = record.amount_due - recovered;

        if (parseFloat(amount_paid) > outstanding) {
          return errorResponse(res, `Failed. Payment amount ₹${amount_paid} exceeds the net outstanding ledger balance: ₹${outstanding}`, 400);
        }

        // 3. Log Payment entry
        db.run(
          'INSERT INTO payments (credit_due_id, payment_date, amount_paid, payment_method) VALUES (?, ?, ?, ?)',
          [id, payment_date, parseFloat(amount_paid), payment_method],
          function (errInsert) {
            if (errInsert) return errorResponse(res, 'Failed to register transaction.', 500);

            const nextOutstanding = outstanding - parseFloat(amount_paid);
            
            // Log audit
            logSystemAction(`Logged payment installment of ₹${parseFloat(amount_paid).toLocaleString()} for invoice ${record.invoice_number} via ${payment_method}`);

            // Auto-complete status check
            if (nextOutstanding <= 0.01) {
              db.run("UPDATE pharmacy_credit_dues_collection SET status = 'Completed' WHERE id = ?", [id], (errComplete) => {
                if (errComplete) console.error("Failed to auto-update status to Completed");
                logSystemAction(`Invoice ${record.invoice_number} paid in full. Auto-updated status to Completed.`);
              });
            }

            res.json({ success: true, message: 'Collection installment successfully logged.' });
          }
        );
      });
    });

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// 14. Archive Completed File (Admin only)
app.patch('/api/credits/:id/archive', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;

    db.get('SELECT * FROM pharmacy_credit_dues_collection WHERE id = ?', [id], (err, record) => {
      if (err || !record) {
        return errorResponse(res, 'Record files not found.', 404);
      }

      if (record.status !== 'Completed') {
        return errorResponse(res, 'Access denied. Credit invoices must be paid in full (Completed) before archiving.', 400);
      }

      db.run("UPDATE pharmacy_credit_dues_collection SET status = 'Archived' WHERE id = ?", [id], (errUpdate) => {
        if (errUpdate) return errorResponse(res, 'Failed to archive ledger.', 500);

        logSystemAction(`Credit invoice file ${record.invoice_number} moved to system archives by admin: ${req.user.email}`);
        res.json({ success: true, message: 'Ledger file successfully archived.' });
      });
    });

  } catch (err) {
    errorResponse(res, err.message, 500);
  }
});

// Launch server
app.listen(PORT, () => {
  console.log(`Mediwave App Express server running on port ${PORT}`);
});

// db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tss.db');

db.serialize(() => {

  // Enable foreign keys
  db.run(`PRAGMA foreign_keys = ON`);

  // USERS
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      max_hr INTEGER,
      ftp INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // WORKOUTS
  db.run(`
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      job_id TEXT UNIQUE,
      file_name TEXT,
      sport TEXT,
      on_upload TEXT,
      status TEXT DEFAULT 'pending',
      workout_date DATETIME,
      duration_seconds REAL,
      distance REAL,
      avg_hr REAL,
      avg_speed REAL,
      avg_power REAL,
      tss REAL,
      zone_json TEXT,
      rolling_json TEXT,
      processed_at DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

    db.run(`
      CREATE TABLE IF NOT EXISTS zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        sport TEXT,
        metric TEXT,
        zone INTEGER,
        min REAL,
        max REAL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

  // Insert default user if not exists
  db.get(
    `SELECT * FROM users WHERE username = ?`,
    ['ruben.moreel'],
    (err, row) => {
      if (err) {
        console.error("Error checking default user:", err);
        return;
      }

      if (!row) {
        db.run(
          `
          INSERT INTO users (username, password_hash, max_hr, ftp)
          VALUES (?, ?, ?, ?)
          `,
          [
            'ruben.moreel',
            'dev-password-hash',  // replace with real hashed password
            190,
            280
          ],
          function (err) {
            if (err) {
              console.error("Error inserting default user:", err);
              return;
            }

            const userId = this.lastID;
            console.log("Default user created with ID:", userId);
          }
        );
      } else {
        console.log("Default user already exists.");
      }
    }
  );
});


console.log("Database initialized.");

module.exports = db;

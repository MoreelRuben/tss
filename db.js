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
      email TEXT UNIQUE NOT NULL,
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
      workout_date TEXT,
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

  // ZONE TABLES
  const zoneTables = ['hr_zones', 'power_zones', 'speed_zones'];

  zoneTables.forEach(table => {
    db.run(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        sport TEXT,
        zone INTEGER,
        min REAL,
        max REAL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
  });

  // Insert default user if not exists
  db.get(
    `SELECT * FROM users WHERE email = ?`,
    ['ruben.moreel'],
    (err, row) => {
      if (err) {
        console.error("Error checking default user:", err);
        return;
      }

      if (!row) {
        db.run(
          `
          INSERT INTO users (email, password_hash, max_hr, ftp)
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

            createDefaultZones(userId);
          }
        );
      } else {
        console.log("Default user already exists.");
      }
    }
  );
});

function createDefaultZones(userId) {

  const sports = ['cycling', 'running', 'swimming'];

  const defaultHRZones = [
    { zone: 1, min: 0, max: 114 },
    { zone: 2, min: 114, max: 133 },
    { zone: 3, min: 133, max: 152 },
    { zone: 4, min: 152, max: 171 },
    { zone: 5, min: 171, max: 999 }
  ];

  sports.forEach(sport => {
    defaultHRZones.forEach(z => {
      db.run(
        `
        INSERT INTO hr_zones (user_id, sport, zone, min, max)
        VALUES (?, ?, ?, ?, ?)
        `,
        [userId, sport, z.zone, z.min, z.max]
      );
    });
  });

  console.log("Default HR zones created.");
}

console.log("Database initialized.");

module.exports = db;

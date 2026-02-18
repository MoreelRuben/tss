require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const Queue = require('bull');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');


const app = express();
const PORT = process.env.PORT || 3000;
 // npm install uuid

const db = new sqlite3.Database('./tss.db', (err) => {
    if (err) {
        console.error("Failed to connect to DB:", err.message);
        process.exit(1);
    } else {
        console.log("Connected to SQLite database.");
    }
});

// Create table if it doesn't exist
db.run(`
    CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT UNIQUE,
        file_name TEXT,
        status TEXT DEFAULT 'pending',
        tss REAL,
        avg_hr REAL,
        distance REAL,
        pace REAL,
        duration_seconds REAL,
        workout_date DATETIME,
        processed_at DATETIME
    )
`, (err) => {
    if (err) {
        console.error("Failed to create table:", err.message);
        process.exit(1);
    } else {
        console.log("Table 'workouts' ready.");
    }
});


app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
    destination: (req,file,cb)=>{
        cb(null, 'uploads/');
    },
    filename: (req,file,cb) =>{
        cb(null, file.originalname)
    }
});

const upload = multer({
    storage,
    fileFilter: (req,file,cb) => {
        if (file.mimetype === 'application/octet-stream' || file.originalname.endsWith('.tcx')){
            cb(null, true);
        }else{
            cb(new Error('Only TCX files are allowed'));
        }
    }
});

const tssQueue = new Queue('tssQueue', process.env.REDIS_URL);



app.post('/upload', upload.single('tcxfile'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const jobId = uuidv4();
    const filePath = req.file.path;
    const originalName = req.file.originalname;

    console.log('uploaded');

    
    db.run(`
        INSERT INTO workouts (job_id, file_name, status)
        VALUES (?, ?, 'pending')
    `, [jobId, originalName], (err) => {
        if (err) return res.status(500).send('DB error');

        console.log("adding to redis" + jobId)
        tssQueue.add({ jobId }); // Only ID, not full file data

        res.redirect('/calendar.html');
    });
});


app.get('/status/:id', async (req, res) => {
    const job = await tssQueue.getJob(req.params.id);
    if (!job) return res.status(404).send('Job not found');

    const state = await job.getState();
    const result = job.returnvalue || null;

    res.json({ state, result });
});

app.get('/api/workouts', (req, res) => {
    db.all("SELECT * FROM workouts ORDER BY workout_date DESC", [], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.get('/api/workouts/:id', (req, res) => {
    db.get("SELECT * FROM workouts WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json(err);
        res.json(row);
    });
});



app.listen(PORT, ()=> {
    console.log(`Server running at http://localhost:${PORT}`);
})
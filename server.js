require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const Queue = require('bull');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');


const app = express();
const PORT = process.env.PORT || 3000;
 // npm install uuid





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
    const userId = 1;
    const onUpload = req.body.onUpload;
    const originalName = req.file.originalname;
    
    db.run(`
        INSERT INTO workouts (job_id, file_name, user_id, on_upload, status)
        VALUES (?, ?, ?, ?, 'pending')
    `, [jobId, originalName, userId, onUpload], (err) => {
        if (err) return res.status(500).send('DB error' + err);

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
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const Queue = require('bull');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');


const app = express();
const PORT = process.env.PORT || 3000;
 // npm install uuid




app.use(express.json()); // parse JSON body
app.use(express.urlencoded({ extended: true }));
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

//_____________________________________________________________________

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if(!token) return res.status(401).json({error: 'No token provided'});

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({error: 'Invalid token'});
        req.user = user;
        next();
    })
}

//_______________________________________________________________________

app.post('/api/register', async (req,res) => {
    const {username, password } = req.body;
    if(!username || !password) return res.status(400).json({error: 'Missing username or password'});

    try{
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)',
            [username, hashedPassword],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, username });
            }
        );
    }catch(err){
        res.status(500).json({error: err.message});
    }
})

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(403).json({ error: 'Incorrect password' });

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    });
});

app.get('/api/user', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.get('SELECT id, username FROM users WHERE id = ?', [userId], (err, userRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!userRow) return res.status(404).json({ error: 'User not found' });

        db.all('SELECT * FROM zones WHERE user_id = ? ORDER BY zone ASC', [userId], (err, zonesRows) => {
            if (err) return res.status(500).json({ error: err.message });

            res.json({
                user: userRow,
                zones: zonesRows
            });
        });
    });
});

//___________________________________________________________________________________


app.post('/upload', authenticateToken, upload.single('tcxfile'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const jobId = uuidv4();
    const userId = req.user.id;
    const onUpload = req.body.onUpload;
    const originalName = req.file.originalname;
    
    db.run(`
        INSERT INTO workouts (job_id, file_name, user_id, on_upload, status)
        VALUES (?, ?, ?, ?, 'pending')
    `, [jobId, originalName, userId, onUpload], (err) => {
        if (err) return res.status(500).send('DB error' + err);

        console.log("adding to redis" + jobId)
        tssQueue.add({ jobId }); // Only ID, not full file data

        res.status(200).json({message: 'file uploaded succesfully'});
    });
});


//_____________________________________________________________________________________

app.get('/status/:id', async (req, res) => {
    const job = await tssQueue.getJob(req.params.id);
    if (!job) return res.status(404).send('Job not found');

    const state = await job.getState();
    const result = job.returnvalue || null;

    res.json({ state, result });
});

//______________________________________________________________________________________

app.get('/api/workouts', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.all("SELECT * FROM workouts WHERE user_id = ? ORDER BY workout_date DESC", [userId], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.get('/api/workouts/:id', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.get("SELECT * FROM workouts WHERE id = ? AND user_id = ?", [req.params.id, userId], (err, row) => {
        if (err) return res.status(500).json(err);
        res.json(row);
    });
});


app.listen(PORT, '0.0.0.0', ()=> {
    console.log(`Server running at http://localhost:${PORT}`);
})
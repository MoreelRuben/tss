// worker.js
require('dotenv').config();
const Queue = require('bull');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const xml2js = require('xml2js');

// Connect to Redis queue (same as server)

const tssQueue = new Queue('tssQueue', process.env.REDIS_URL);



const db = new sqlite3.Database('./tss.db');

function getZones(db, table, userId, sport) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM ${table} WHERE user_id = ? AND sport = ? ORDER BY zone ASC`,
      [userId, sport],
      (err, rows) => err ? reject(err) : resolve(rows)
    );
  });
}

function getWorkout(jobId){
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM workouts WHERE job_id = ?", [jobId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getUser(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM users WHERE id = ?`,
      [userId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function updateWorkout(jobId, result) {
  return new Promise((resolve, reject) => {

    const {
      durationSeconds,
      distance,
      avgHR,
      avgSpeed,
      avgPower,
      tss,
      rolling,
      zones
    } = result;

    db.run(
      `
      UPDATE workouts SET
        status = 'done',
        duration_seconds = ?,
        distance = ?,
        avg_hr = ?,
        avg_speed = ?,
        avg_power = ?,
        tss = ?,
        rolling_json = ?,
        zone_json = ?,
        processed_at = CURRENT_TIMESTAMP
      WHERE job_id = ?
      `,
      [
        durationSeconds || null,
        distance || null,
        avgHR || null,
        avgSpeed || null,
        avgPower || null,
        tss || null,
        rolling ? JSON.stringify(rolling) : null,
        zones ? JSON.stringify(zones) : null,
        jobId
      ],
      function (err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function TCXToString(filePath){
    const xml = fs.readFileSync(filePath, 'utf-8');
    const parser = new xml2js.Parser({explicitArray: false});
    const result = await parser.parseStringPromise(xml);
    return result;
}



// Worker processor
tssQueue.process(async (job) => {
    const { jobId } = job.data;
    const workout = await getWorkout(jobId);
    const user = await getUser(workout.user_id);

    const filePath = path.join(__dirname, 'uploads', workout.file_name);
    if (!fs.existsSync(filePath)) {
        throw new Error("File does not exist: " + filePath);
    }

    console.log("starting job: " + jobId + "from user" + user.email);
    const tcxString = await TCXToString(filePath);
    const data = parseTCX(tcxString);
    console.log("data")

    console.log("data is parsed");
    console.log(workout.on_upload);

    let result = {};

    if (workout.on_upload === "rolling"){
        result.rolling = {
            hr: rollingMax20min(data, "hr"),
            speed: rollingMax20min(data, "speed"),
            power: rollingMax20min(data, "power")
        };
    }else if(workout.on_upload === "zones"){
        const hrZones = await getZones("hr_zones", user.id, workout.sport);
        const powerZones = await getZones("power_zones", user.id, workout.sport);
        const speedZones = await getZones("speed_zones", user.id, workout.sport);

        result.zones = {
            hr: analyzeZones(data, hrZones, "hr"),
            power: analyzeZones(data, powerZones, "power"),
            speed: analyzeZones(data, speedZones, "speed")
        };
    }

    await updateWorkout(jobId, result);

    return result;

});

console.log("Worker running and waiting for jobs...");



function parseTCX(xml){
    const laps = xml.TrainingCenterDatabase.Activities.Activity.Lap;
    const lapsArr = Array.isArray(laps) ? laps : [laps];
    let trackpoints = [];

    lapsArr.forEach(lap => {
        const tracks = Array.isArray(lap.Track) ? lap.Track : [lap.Track];
        tracks.forEach(track => {
            if (track.Trackpoint) {
                const tps = Array.isArray(track.Trackpoint) ? track.Trackpoint : [track.Trackpoint];
                trackpoints.push(...tps);
            }
            });
    });
    const data = []
    let prevDistance = null;
    let prevTime = null;

    for (const tp of trackpoints) {
        const time = new Date(tp.Time).getTime();
        const hr = tp.HeartRateBpm ? Number(tp.HeartRateBpm.Value) : null;
        const distance = tp.DistanceMeters ? Number(tp.DistanceMeters) : null;
        const power = tp.Extensions?.TPX?.Watts ? Number(tp.Extensions.TPX.Watts) : null;

        let speed = null;
        if (prevDistance !== null && prevTime !== null && distance !== null) {
            const deltaDist = distance - prevDistance;
            const deltaTime = (time - prevTime) / 1000;
            if (deltaTime > 0) speed = deltaDist / deltaTime;
        }

        data.push({ time, hr, speed, power });

        prevDistance = distance;
        prevTime = time;
    }
    return data;
}


function rollingMax20min(data, metric){
    console.log("calc rolling max")
    const windowMs = 20 * 60 *100;

    let start = 0;
    let weightedSum = 0;
    let totalTime = 0;
    let maxAvg = 0;

    for(let end = 1; end < data.length; end++){
        const deltaTime = data[end].time - data[end - 1].time;
        const value = data[end -1][metric];

        if(value != null){
            weightedSum += value * deltaTime;
            totalTime += deltaTime;
        }

        while (data[end].time - data[start].time > windowMs){
            const removeDelta = data[start + 1].time - data[start].time;
            const removeValue =  data[start][metric];

            if(removeValue != null){
                weightedSum -= removeValue * removeDelta;
                totalTime -= removeDelta;
            }

            start++;
        }

        if(totalTime >= windowMs){
            const avg = weightedSum / totalTime;
            maxAvg = Math.max(maxAvg, avg);
        }
    }

    return maxAvg;
}

function create5Zones(maxValue) {
  return [
    { zone: 1, min: 0, max: 0.6 * maxValue },
    { zone: 2, min: 0.6 * maxValue, max: 0.7 * maxValue },
    { zone: 3, min: 0.7 * maxValue, max: 0.8 * maxValue },
    { zone: 4, min: 0.8 * maxValue, max: 0.9 * maxValue },
    { zone: 5, min: 0.9 * maxValue, max: Infinity }
  ];
}

function analyzeZones(data, zones, metric){
    const zoneTime = Array(zones.length).fill(0);
    let totalTime = 0;
    let classifiedPoints = 0;

    for (let i = 1; i < data.length; i++){
        const deltaTime = data[i].time - data[i - 1].time;
        const value = data[i -1][metric];

        totalTime += deltaTime;

        if (value == null) continue;

        classifiedPoints++;

        for(let z = 0; z < zones.length; z++){
            if(value >= zones[z].min && value < zones[z].max){
                zoneTime[z] + deltaTime;
                break;
            }
        }
    }

    return {
        zoneTime,
        zonePercent: zoneTime.map(t => (t / totalTime) * 100),
        classifiedPercent: (classifiedPoints / data.length) * 100
    };
}

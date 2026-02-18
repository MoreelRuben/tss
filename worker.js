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


async function parseTCX(filePath){
    const xml = fs.readFileSync(filePath, 'utf-8');
    const parser = new xml2js.Parser({explicitArray: false});
    const result = await parser.parseStringPromise(xml);
    return result;
}

function extractStats(activity) {
    const laps = activity.Lap instanceof Array ? activity.Lap : [activity.Lap];
    let totalSeconds = 0;
    let hrSum = 0;
    let hrCount = 0;
    let totalDistanceMeters =0;

    laps.forEach(lap => {
        // Duration from Lap.TotalTimeSeconds
        totalSeconds += parseFloat(lap.TotalTimeSeconds || 0);

        totalDistanceMeters += parseFloat(lap.DistanceMeters || 0)
        // Trackpoints HR
        if (lap.Track && lap.Track.Trackpoint) {
            const trackpoints = Array.isArray(lap.Track.Trackpoint)
                ? lap.Track.Trackpoint
                : [lap.Track.Trackpoint];

            trackpoints.forEach(tp => {
                if (tp.HeartRateBpm && tp.HeartRateBpm.Value) {
                    hrSum += parseFloat(tp.HeartRateBpm.Value);
                    hrCount++;
                }
            });
        }
    });

    const avgHR = hrCount > 0 ? hrSum / hrCount : null;

    const distanceKm = totalDistanceMeters / 1000;
    const avgPaceSecondsPerKm = distanceKm > 0 ? totalSeconds / distanceKm : null;


    return { durationSeconds: totalSeconds, distance: totalDistanceMeters, avgHR, avgPaceSecondsPerKm };
}

function calculateHRbasedTSS(durationSeconds, avgHR, maxHR = 190, fthr = 180) {
    const durationHours = durationSeconds / 3600;
    const intensityFactor = avgHR / fthr; // rough estimate
    const tss = durationHours * 100 * Math.pow(intensityFactor, 2); // rough HR TSS formula
    return Math.round(tss);
}



async function processTCX(filePath) {
    const tcx = await parseTCX(filePath);
    const activity = tcx.TrainingCenterDatabase.Activities.Activity;
    const date = activity.Id

    const { durationSeconds, distance, avgHR, avgPaceSecondsPerKm } = extractStats(activity);
    const tss = calculateHRbasedTSS(durationSeconds, avgHR);

    return {
        date,
        durationSeconds,
        avgHR,
        distance,
        pace: avgPaceSecondsPerKm,
        tss
    };
}


// Worker processor
tssQueue.process(async (job) => {
    const { jobId } = job.data;
    const workout = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM workouts WHERE job_id = ?", [jobId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
    if (!workout) {
        throw new Error("Workout not found in DB");
    }

    const filePath = path.join(__dirname, 'uploads', workout.file_name);
    if (!fs.existsSync(filePath)) {
        throw new Error("File does not exist: " + filePath);
    }

    console.log("starting job: " + jobId)
    const {date, durationSeconds, avgHR, distance, pace, tss} = await processTCX(filePath);
    

    // Update DB with result
    await new Promise((resolve, reject) => {
        db.run(
            "UPDATE workouts SET status = 'done', tss = ?, avg_hr = ?, duration_seconds = ?, distance = ?, pace = ?, workout_date = ?, processed_at = CURRENT_TIMESTAMP WHERE job_id = ?",
            [tss, avgHR, durationSeconds, distance, pace, date, jobId],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });

    console.log(`Finished processing ${filePath}, TSS=${result.tss}`);
    return result; // Bull saves this in job.returnvalue
});

console.log("Worker running and waiting for jobs...");

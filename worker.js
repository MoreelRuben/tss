// worker.js
require('dotenv').config();
const Queue = require('bull');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const xml2js = require('xml2js');

// Connect to Redis queue (same as server)

const tssQueue = new Queue('tssQueue', process.env.REDIS_URL);



const db = new sqlite3.Database('./data/tss.db');

function getZones(userId, sport, metric) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM zones WHERE user_id = ? AND sport = ? AND metric = ? ORDER BY zone ASC`,
      [userId, sport, metric],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.length > 0 ? rows: null);
      }
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
      zones,
      metricUsed
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
        metric_used = ?,
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
        metricUsed || null,
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

function setMetadata(sport,date, jobId){
    db.run(
      `
      UPDATE workouts SET
        sport = ?,
        workout_date = ?
      WHERE job_id = ?
      `,
      [
        sport,
        date,
        jobId
      ]
    );
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

    console.log("processing job with id:" + jobId)
    const tcxString = await TCXToString(filePath);
    let activity = tcxString.TrainingCenterDatabase.Activities.Activity
    let date = activity.Id
    console.log(date)
    let sport = activity.$.Sport
    setMetadata(sport, date, jobId);
    const data = parseTCX(activity);
    const metadata = getWorkoutMetaData(activity);
    let result = {};

    if (workout.on_upload === "rolling"){
        result.rolling = {
            hr: rollingMax20min(data, "hr"),
            speed: rollingMax20min(data, "speed"),
            power: rollingMax20min(data, "power")
        };

        storeZones(result.rolling, workout.user_id, sport)
    }else if(workout.on_upload === "zones"){
        const hrZones = await getZones(user.id, sport, "hr");
        const powerZones = await getZones(user.id, sport, "power");
        const speedZones = await getZones(user.id, sport, "speed");

        result.zones = {
            hr: analyzeZones(data, hrZones, "hr", sport),
            power: analyzeZones(data, powerZones, "power", sport),
            speed: analyzeZones(data, speedZones, "speed", sport)
        };

        result.avgHR = metadata.avg_hr
        result.distance = metadata.total_distance_m
        result.durationSeconds = metadata.total_time_sec
        result.avgSpeed = metadata.avg_speed_m_per_sec
        tssData = calculateTSS(result.zones, sport)
        result.tss = tssData.tss
        result.metricUsed = tssData.metricUsed
    }

    

    await updateWorkout(jobId, result);

    return result;

});

console.log("Worker running and waiting for jobs...");


function getWorkoutMetaData(activity) {
  const sport = activity.$?.Sport || activity.Sport || "Unknown";

  const laps = Array.isArray(activity.Lap)
    ? activity.Lap
    : [activity.Lap];

  let totalDistance = 0;
  let totalTime = 0;
  let hrSum = 0;
  let hrCount = 0;

  if (sport === "Other") {
    // 🔵 SWIMMING → Use Lap data only
    laps.forEach(lap => {
      const distance = parseFloat(lap.DistanceMeters || 0);
      const time = parseFloat(lap.TotalTimeSeconds || 0);

      if(distance != 0){
        totalDistance += distance;
        totalTime += time;
      }

      if (lap.AverageHeartRateBpm?.Value) {
        hrSum += parseFloat(lap.AverageHeartRateBpm.Value);
        hrCount++;
      }
    });

  } else {
    // 🟢 Running & Cycling → Use Trackpoints
    laps.forEach(lap => {
      totalTime += parseFloat(lap.TotalTimeSeconds || 0);


      if (!lap.Track) return;

      const tracks = Array.isArray(lap.Track)
        ? lap.Track
        : [lap.Track];

      tracks.forEach(track => {
        const trackpoints = Array.isArray(track.Trackpoint)
          ? track.Trackpoint
          : [track.Trackpoint];

        if (trackpoints.length >= 2) {
          const first = parseFloat(trackpoints[0].DistanceMeters || 0);
          const last = parseFloat(trackpoints[trackpoints.length - 1].DistanceMeters || 0);
          totalDistance += last - first;
        }

        trackpoints.forEach(tp => {
          if (!tp) return;
          if (tp.HeartRateBpm?.Value) {
            hrSum += parseFloat(tp.HeartRateBpm.Value);
            hrCount++;
          }
        });
      });
    });
  }

  const avgHr = hrCount > 0 ? hrSum / hrCount : 0;
  const avgSpeed = totalTime > 0 ? totalDistance / totalTime : 0;

  return {
    sport,
    total_distance_m: totalDistance,
    total_time_sec: totalTime,
    avg_hr: avgHr,
    avg_speed_m_per_sec: avgSpeed
  };
}



function parseTCX(xml) {
    const laps = xml.Lap;
    const lapsArr = Array.isArray(laps) ? laps : [laps];

    const data = [];

    lapsArr.forEach(lap => {
        const tracks = Array.isArray(lap.Track) ? lap.Track : [lap.Track];

        // ----- Compute lap average speed (for swimming) -----
        let lapSpeed = null;
        const lapDistance = lap.DistanceMeters ? Number(lap.DistanceMeters) : null;
        const lapTime = lap.TotalTimeSeconds ? Number(lap.TotalTimeSeconds) : null;

        if (lapDistance != null && lapTime > 0) {
            lapSpeed = lapDistance / lapTime; // m/s
        }

        let prevDistance = null;
        let prevTime = null;

        tracks.forEach(track => {
            if (!track.Trackpoint) return;

            const tps = Array.isArray(track.Trackpoint)
                ? track.Trackpoint
                : [track.Trackpoint];

            for (const tp of tps) {
                const time = new Date(tp.Time).getTime();
                const hr = tp.HeartRateBpm ? Number(tp.HeartRateBpm.Value) : null;
                const distance = tp.DistanceMeters ? Number(tp.DistanceMeters) : null;
                const power = tp.Extensions?.['ns3:TPX']?.['ns3:Watts']
                    ? Number(tp.Extensions['ns3:TPX']['ns3:Watts'])
                    : null;

                let speed = null;

                // ---- Normal dynamic speed (running/cycling) ----
                if (
                    prevDistance !== null &&
                    prevTime !== null &&
                    distance !== null
                ) {
                    const deltaDist = distance - prevDistance;
                    const deltaTime = (time - prevTime) / 1000;
                    if (deltaTime > 0) {
                        speed = deltaDist / deltaTime;
                    }
                }

                // ---- Swimming fallback ----
                if (speed == null && lapSpeed != null) {
                    speed = lapSpeed;
                }

                if(speed != 0){
                    data.push({ time, hr, speed, power });
                }

                prevDistance = distance;
                prevTime = time;
            }
        });
    });

    return data;
}

function rollingMax20min(data, metric){
    console.log("calc rolling max")
    const windowMs = 20 * 60 *1000;

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

function analyzeZones(data, zones, metric, sport){
    if (!data || !zones) {
          return {
              zones: [],
              classifiedPercent: 0
          };
      }
    
    const zoneStats = zones.map(z => ({
        zone: z.zone,
        min: Math.min(z.min, z.max),
        max: Math.max(z.min, z.max),
        time: 0
    }));
    let totalTime = 0;
    let classifiedPoints = 0;

    for (let i = 1; i < data.length; i++){
        const deltaTime = data[i].time - data[i - 1].time;
        const value = data[i -1][metric];

        totalTime += deltaTime;

        if (value == null) continue;

        classifiedPoints++;

        for(let z of zoneStats){
          let min = z.min;
          let max = z.max;

          if (sport === "Other" && metric === "speed") {
              max_temp = 100 / min;
              min = 100 / max;
              max = max_temp;
          }

          if (sport === "Running" && metric === "speed") {
              max_temp = 1000 / min;
              min = 1000 / max;
              max = max_temp;
          }
            if(value >= min && value < max){
                z.time += deltaTime;
                break;
            }
        }
    }

    const zonesWithPercent = zoneStats.map(z => ({
        zone: z.zone,
        min: z.min,
        max: z.max,
        time: z.time,
        percent: totalTime ? (z.time / totalTime) * 100 : 0
    }));

    return {
        zones: zonesWithPercent,
        classifiedPercent: (classifiedPoints / data.length) * 100
    };
}

function storeZones(rolling, userId, sport) {
  const metrics = ['hr', 'power', 'speed'];
  const TOTAL_ZONES = 7;

  metrics.forEach(metric => {
    const maxValue = rolling[metric];
    if (!maxValue) return;

    let zones = calculateZones(maxValue, sport, metric) || [];

    // Vul aan tot 7 zones
    while (zones.length < TOTAL_ZONES) {
      zones.push({
        zone: zones.length + 1,
        min: zones.length > 0 ? zones[zones.length - 1].max : 0,
        max: Math.round(maxValue)
      });
    }

    // Start een transactie
    db.serialize(() => {
      db.run(
        `DELETE FROM zones WHERE user_id = ? AND sport = ? AND metric = ?`,
        [userId, sport, metric]
      );

      const stmt = db.prepare(
        `INSERT INTO zones (user_id, sport, metric, zone, min, max) VALUES (?, ?, ?, ?, ?, ?)`
      );

      zones.forEach(z => {
        stmt.run([userId, sport, metric, z.zone, z.min, z.max]);
      });

      stmt.finalize(); // Zorgt dat alles wordt geschreven
    });
  });
}

function calculateTSS(json, sport) {
  console.log("start calculation");

  let zones = null;
  let IFmap = null;
  let usedMetric = null;

  // ---- CYCLING ----
  if (sport === "Biking") {
    if (json.power?.zones?.length) {
      zones = json.power.zones;
      usedMetric = "power";
      IFmap = {
        1: 0.50, 2: 0.65, 3: 0.83,
        4: 0.98, 5: 1.13, 6: 1.30, 7: 1.60
      };
    } 
    else if (json.hr?.zones?.length) {
      zones = json.hr.zones;
      usedMetric = "hr";
      IFmap = {
        1: 0.60, 2: 0.70, 3: 0.80,
        4: 0.90, 5: 1.00, 6: 1.05, 7: 1.10
      };
    } 
    else if (json.speed?.zones?.length) {
      zones = json.speed.zones;
      usedMetric = "speed";
      IFmap = {
        1: 0.65, 2: 0.75, 3: 0.85,
        4: 0.95, 5: 1.05, 6: 1.15, 7: 1.25
      };
    }
  }

  // ---- RUNNING ----
  else if (sport === "Running") {
    if (json.hr?.zones?.length) {
      zones = json.hr.zones;
      usedMetric = "hr";
      IFmap = {
        1: 0.60, 2: 0.70, 3: 0.80,
        4: 0.90, 5: 1.00, 6: 1.05, 7: 1.10
      };
    } 
    else if (json.speed?.zones?.length) {
      zones = json.speed.zones;
      usedMetric = "speed";
      IFmap = {
        1: 0.65, 2: 0.75, 3: 0.85,
        4: 0.95, 5: 1.05, 6: 1.15, 7: 1.25
      };
    }
  }

  // ---- SWIMMING / OTHER ----
  else if (sport === "Other") {
    if (json.speed?.zones?.length) {
      zones = json.speed.zones;
      usedMetric = "speed";
      IFmap = {
        1: 0.65, 2: 0.75, 3: 0.85,
        4: 0.95, 5: 1.05, 6: 1.15, 7: 1.25
      };
    } 
    else if (json.hr?.zones?.length) {
      zones = json.hr.zones;
      usedMetric = "hr";
      IFmap = {
        1: 0.60, 2: 0.70, 3: 0.80,
        4: 0.90, 5: 1.00, 6: 1.05, 7: 1.10
      };
    }
  }

  if (!zones || !zones.length) {
    console.warn("No valid zones found");
    return { tss: 0, metricUsed: null };
  }

  let totalTSS = 0;

  zones.forEach(segment => {
    const hours = segment.time / 3600000; // jij zei nu seconden
    const ifValue = IFmap[segment.zone] ?? 0;
    totalTSS += hours * Math.pow(ifValue, 2) * 100;
  });

  return {
    tss: Math.round(totalTSS),
    metricUsed: usedMetric
  };
}


function calculateZones(maxValue, sport, metric){
    if(sport === 'Running' && metric === 'hr'){
        return [
            { zone: 1, min: 0, max: Math.round(maxValue * 0.7) },
            { zone: 2, min: Math.round((maxValue * 0.7) + 1), max: Math.round(maxValue * 0.8) },
            { zone: 3, min: Math.round((maxValue * 0.8) + 1), max: Math.round(maxValue * 0.9 )},
            { zone: 4, min: Math.round((maxValue * 0.9) + 1), max: Math.round((maxValue)) },
            { zone: 5, min: Math.round(maxValue) + 1, max: Math.round(maxValue * 1.05)},
            { zone: 6, min: Math.round(maxValue * 1.05) + 1, max: Math.round(maxValue * 1.15)},
            { zone: 7, min: Math.round(maxValue * 1.15) + 1, max: 250 },
        ];
    }else if(sport === 'Running' && metric === 'speed'){
        let v = 1000 /maxValue
        return [
            { zone: 1, min: 50000, max: (v * 1.252) + 1 },
            { zone: 2, min: v  * 1.252, max: (v * 1.114) + 1 },
            { zone: 3, min: v * 1.114, max: (v * 1.056) +1 },
            { zone: 4, min: v * 1.056, max: v  + 1},
            { zone: 5, min: v, max: (v * 0.87) + 1 },
            {zone: 6, min: v * 0.87, max: (v * 0.75) + 1},
            {zone: 7, min: v * 0.75, max: 100}
        ];
    }else if(sport === 'Biking' && metric === 'hr'){
        return [
            { zone: 1, min: 0, max: Math.round(maxValue * 0.68) },
            { zone: 2, min: Math.round(maxValue * 0.68) + 1, max: Math.round(maxValue * 0.75) },
            { zone: 3, min: Math.round(maxValue * 0.75) + 1, max: Math.round(maxValue * 0.82) },
            { zone: 4, min: Math.round(maxValue * 0.82) + 1, max: Math.round(maxValue * 0.89) },
            { zone: 5, min: Math.round(maxValue * 0.89) + 1, max: Math.round(maxValue * 0.94) },
            { zone: 6, min: Math.round(maxValue * 0.94) + 1, max: Math.round(maxValue) },
            { zone: 7, min: Math.round(maxValue) + 1, max: 250 }
        ];
    }else if (sport === 'Biking' && metric === 'power') {
        return [
            { zone: 1, min: 0, max: Math.round(maxValue * 0.55) },                 // Active Recovery
            { zone: 2, min: Math.round(maxValue * 0.55) + 1, max: Math.round(maxValue * 0.75) }, // Endurance
            { zone: 3, min: Math.round(maxValue * 0.75) + 1, max: Math.round(maxValue * 0.90) }, // Tempo
            { zone: 4, min: Math.round(maxValue * 0.90) + 1, max: Math.round(maxValue * 1.05) }, // Threshold
            { zone: 5, min: Math.round(maxValue * 1.05) + 1, max: Math.round(maxValue * 1.20) }, // VO2max
            { zone: 6, min: Math.round(maxValue * 1.20) + 1, max: Math.round(maxValue * 1.50) }, // Anaerobic
            { zone: 7, min: Math.round(maxValue * 1.50) + 1, max: 2000 } // Neuromuscular sprint cap
        ];
    }
    else if(sport === 'Other' && metric === 'speed'){
      const css = 100 / maxValue
      return [
            { zone: 1, min: 50000, max: ((css) * 1.084) + 1 },
            { zone: 2, min: (css) * 1.084, max: ((css) * 1.054) + 1 },
            { zone: 3, min: (css) *1.054, max: (css * 1.027)  +1 },
            { zone: 4, min: css * 1.027 , max: css + 1},
            { zone: 5, min: css, max: (css * 0.975) + 1 },
            { zone: 6, min: css * 0.975, max: (css * 0.92) + 1},
            {zone: 7, min:(css * 0.92), max: 25}
        ];
    }
    else{
      return null
    }
}
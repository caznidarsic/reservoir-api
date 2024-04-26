const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getMonthlyDateRange, getCurrentYear, getYesterdaysDate, cleanData, getCacheTTL } = require('./utility');
const { getCacheData } = require('./cacheFunctions');
const app = express();
const redis = require('redis');
// const sqlite3 = require('sqlite3').verbose();
const port = process.env.PORT || 3000;


// Middleware to parse JSON requests
app.use(express.json());
app.use(cors({
    origin: ['https://reservoirlevels.christianznidarsic.com', 'https://www.reservoirs.fyi', 'http://localhost:3001']
}));


// initialize redis client and connect
let redisClient;
(async () => {
    redisClient = redis.createClient();
    redisClient.on("error", (error) => console.error(`Error : ${error}`));

    await redisClient.connect();
})();


// // initialize sqlite3 and connect
// const db = new sqlite3.Database('reservoir_data.db', (err) => {
//     if (err) {
//         console.error('Error opening database:', err.message);
//     } else {
//         console.log('Connected to the SQLite database.');
//     }
// })


// function to call fetchApiData() and perform caching
async function getResData(stationid, span) {
    let currentResults;
    let historicalResults;

    try {
        currentResults = await getCacheData(stationid, 'monthly_current', span);
        // console.log("currentResults: ", currentResults);
        historicalResults = await getCacheData(stationid, 'monthly_historical', span);
        // console.log("historicalResults: ", historicalResults);


        let month
        // add historical averages to the current data
        currentResults.forEach(item => {
            month = new Date(item.date).getMonth() + 1;
            item.average = historicalResults[month].average;
        })

        return currentResults;

    } catch (error) {
        console.log("error fetching data!!");
        console.log(error)
    }

}


/*
Function that takes a list of station ids as input, and outputs the total sum of average storage for all stations,
as well as the current storage for all stations.
*/
async function getMultiResData(stationids, span) {
    let singleResResults;
    let combinedResults = {};

    for (const id of stationids) {
        singleResResults = await getResData(id, span);
        console.log("singleResResults: ", singleResResults);

        singleResResults.forEach(item => {

            month = new Date(item.date).getMonth() + 1;
            if (!combinedResults[item.date]) {
                combinedResults[item.date] = { date: item.date, totalAverage: 0 };
            }
            combinedResults[item.date][item.stationId] = item.value;
            combinedResults[item.date].totalAverage += item.average;
        })
    }
    console.log("combinedResults: ", combinedResults);

    const dataList = Object.keys(combinedResults).map((key) => combinedResults[key]);
    console.log("dataList: ", dataList);
    return dataList;
}


/*
Function to get yesterday's reservoir level
*/
async function getYesterdaysResData(stationid) {
    try {
        let results = await getCacheData(stationid, "yesterday");
        return results;
    } catch (error) {
        console.log("error fetching data!!!!");
        console.log(error)
    }
}


//endpoint to get monthly reservoir data
app.get('/resdata/monthly', async (req, res) => {
    let stationids = req.query.stationid.split(',');
    let span = req.query.span;

    try {
        if (stationids.length > 1) {
            let currentResults = await getMultiResData(stationids, span);
            return res.status(200).send(JSON.stringify(currentResults));
        }

        else {
            let currentResults = await getResData(stationids, span);
            return res.status(200).send(JSON.stringify(currentResults));
        }
    } catch (error) {
        console.log("error fetching data!!");
        console.log(error)
        return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
    }

});


//endpoint to get reservoir capacity yesterday (capacity for given day is available the next day)
app.get('/resdata/daily', async (req, res) => {
    let stationid = req.query.stationid;

    try {
        let results = await getYesterdaysResData(stationid);
        return res.status(200).send(results);
    } catch (error) {
        console.log("error fetching data!!");
        console.log(error)
        return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
    }
})


// app.get('/resdata/test', async (req, res) => {

//     // db.all(`INSERT INTO storage (station_id, storage, date, month)
//     // VALUES ("ORO", 999999, "3/19/24", 1)`);
//     let stationids = ['ORO'];
//     let queryString =
//         `SELECT monthly_storage.date
//         FROM monthly_storage JOIN avg_monthly_storage
//         ON monthly_storage.station_id=avg_monthly_storage.station_id
//         AND monthly_storage.month=avg_monthly_storage.month
//     WHERE monthly_storage.station_id="${stationids}"
//     ORDER BY monthly_storage.date;`;

//     db.all(queryString, (err, rows) => {
//         if (err) {
//             console.error('Error querying data:', err.message);
//         } else {
//             console.log('Query results:');
//             rows.forEach(row => {
//                 console.log(row);
//             });
//             res.json(rows);
//         }
//     });
// })


app.get('/resdata/test', async (req, res) => {
    res.send("Hello from API!!");
})


// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

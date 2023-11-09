const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getMonthlyDateRange, getCurrentYear, getYesterdaysDate, cleanData, getCacheTTL } = require('./utility');
const { getCacheData } = require('./cacheFunctions');
const app = express();
const redis = require('redis');
const port = process.env.PORT || 3000;


// Middleware to parse JSON requests
app.use(express.json());
app.use(cors({
    origin: ['https://reservoirlevels.christianznidarsic.com', 'http://localhost:3001']
}));


// initialize redis client and connect
let redisClient;
(async () => {
    redisClient = redis.createClient();
    redisClient.on("error", (error) => console.error(`Error : ${error}`));

    await redisClient.connect();
})();


// function to call fetchApiData() and perform caching
async function getResData(stationid, span) {
    let currentResults;
    let historicalResults;

    try {
        currentResults = await getCacheData(stationid, 'monthly_current', span);
        historicalResults = await getCacheData(stationid, 'monthly_historical', span);

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

        singleResResults.forEach(item => {

            month = new Date(item.date).getMonth() + 1;
            if (!combinedResults[item.date]) {
                combinedResults[item.date] = { date: item.date, totalAverage: 0 };
            }
            combinedResults[item.date][item.stationId] = item.value;
            combinedResults[item.date].totalAverage += item.average;
        })
    }

    const dataList = Object.keys(combinedResults).map((key) => combinedResults[key]);

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


// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getMonthlyDateRange, getCurrentYear, cleanData, getCacheTTL } = require('./utility');
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

// function to fetch data from API
async function fetchCurrentApiData(stationid, span) {
    let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=${(span === '6 months' ? 'D' : 'M')}&${getMonthlyDateRange(span)}`;
    const apiResponse = await axios.get(url)
    let currentResults = cleanData(apiResponse.data, span);
    return currentResults;
}

// function to fetch historical data from API
async function fetchHistoricalApiData(stationid, span) {
    let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=${(span === '6 months' ? 'D' : 'M')}&Start=1988-1-1&End=${getCurrentYear() - 1}-12-1`;
    const apiResponse = await axios.get(url);
    let data = cleanData(apiResponse.data, span);
    const averages = {};
    let month;

    data.forEach(item => {
        month = new Date(item.date).getMonth() + 1;
        if (!averages[month]) {
            averages[month] = { month: month, total: 0, count: 0 };
        }
        averages[month].total += item.value;
        averages[month].count += 1;
    })

    Object.keys(averages).forEach(key => {
        const item = averages[key];
        item.average = Math.floor(item.total / item.count);
    });

    return averages;
}

// function to call fetchApiData() and perform caching
async function getResData(stationid, span) {
    // let stationid = req.query.stationid.split(',');
    // let span = req.query.span;
    let currentResults;
    let historicalResults;
    // let id = stationids[0]


    // try {

    //     const promises = stationids.map(async (id) => {

    //         const currentCacheResults = await redisClient.get(`monthly_storage_${id}_${span}`);
    //         if (currentCacheResults) {
    //             currentResults = JSON.parse(currentCacheResults);
    //         }
    //         else {
    //             currentResults = await fetchCurrentApiData(id, span);
    //             console.log('had to fetch from API (current)')
    //             if (currentResults.length == 0) {
    //                 throw "API returned an empty array";
    //             }
    //             await redisClient.set(`monthly_storage_${id}_${span}`, JSON.stringify(currentResults), {
    //                 EX: getCacheTTL('monthly'),
    //                 NX: true,
    //             });
    //         }


    //         const historicalCacheResults = await redisClient.get(`monthly_storage_historical_${id}_${span}`);
    //         if (historicalCacheResults) {
    //             historicalResults = JSON.parse(historicalCacheResults);
    //         }
    //         else {
    //             historicalResults = await fetchHistoricalApiData(id, span);
    //             console.log('had to fetch from API (historical)')
    //             if (!historicalResults) {
    //                 throw "API returned no data";
    //             }
    //             await redisClient.set(`monthly_storage_historical_${id}_${span}`, JSON.stringify(historicalResults), {
    //                 EX: getCacheTTL('annual'),
    //                 NX: true,
    //             });
    //         }


    //         currentResults = cleanData(currentResults, span);

    //         let month
    //         // add historical averages to the current data
    //         currentResults.forEach(item => {
    //             month = new Date(item.date).getMonth() + 1;
    //             item.average = historicalResults[month].average;
    //         })
    //         console.log(currentResults[1])
    //     })

    //     await Promise.all(promises);

    //     return res.status(200).send(JSON.stringify(currentResults));

    // } catch (error) {
    //     console.log("error fetching data!!");
    //     console.log(error)
    //     return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
    // }



    try {
        const currentCacheResults = await redisClient.get(`monthly_storage_${stationid}_${span}`);
        if (currentCacheResults) {
            currentResults = JSON.parse(currentCacheResults);
        }
        else {
            currentResults = await fetchCurrentApiData(stationid, span);
            console.log('had to fetch from API (current)')
            if (currentResults.length == 0) {
                throw "API returned an empty array";
            }
            await redisClient.set(`monthly_storage_${stationid}_${span}`, JSON.stringify(currentResults), {
                EX: getCacheTTL('monthly'),
                NX: true,
            });
        }

        const historicalCacheResults = await redisClient.get(`monthly_storage_historical_${stationid}_${span}`);
        if (historicalCacheResults) {
            historicalResults = JSON.parse(historicalCacheResults);
        }
        else {
            historicalResults = await fetchHistoricalApiData(stationid, span);
            console.log('had to fetch from API (historical)')
            if (!historicalResults) {
                throw "API returned no data";
            }
            await redisClient.set(`monthly_storage_historical_${stationid}_${span}`, JSON.stringify(historicalResults), {
                EX: getCacheTTL('annual'),
                NX: true,
            });
        }

        // currentResults = cleanData(currentResults, span);

        let month
        // add historical averages to the current data
        currentResults.forEach(item => {
            month = new Date(item.date).getMonth() + 1;
            item.average = historicalResults[month].average;
        })

        // return res.status(200).send(JSON.stringify(currentResults));
        return currentResults;

    } catch (error) {
        console.log("error fetching data!!");
        console.log(error)
        // return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
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


//endpoint to get monthly reservoir data
app.get('/resdata', async (req, res) => {
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


// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

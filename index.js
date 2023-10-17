const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getDateRange, cleanData } = require('./utility');
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
async function fetchApiData(stationid, span) {
    let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=${(span === '6 months' ? 'D' : 'M')}&${getDateRange(span)}`;
    const apiResponse = await axios.get(url)
    return apiResponse.data;
}

// function to call fetchApiData() and perform caching
async function getResData(req, res) {
    let stationid = req.query.stationid;
    let span = req.query.span;
    let results;
    let isCached = false;

    try {
        const cacheResults = await redisClient.get(`${stationid}_${span}`);
        if (cacheResults) {
            isCached = true;
            results = JSON.parse(cacheResults);
        }
        else {
            results = await fetchApiData(stationid, span);
            console.log('had to fetch from API')
            if (results.length == 0) {
                throw "API returned an empty array";
            }
            await redisClient.set(`${stationid}_${span}`, JSON.stringify(results), {
                EX: 86400,
                NX: true,
            });
        }

        return res.status(200).send(JSON.stringify(cleanData(results, span)));

    } catch (error) {
        console.log("error fetching data!!");
        console.log(error)
        return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
    }
}



//endpoint to get monthly reservoir data
app.get('/resdata', getResData);


// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

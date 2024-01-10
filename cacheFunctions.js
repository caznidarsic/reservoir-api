const redis = require('redis');
const axios = require('axios');
const { getMonthlyDateRange, getCurrentYear, getPastDate, cleanData, getCacheTTL, formatDateString } = require('./utility');


// initialize redis client and connect
let redisClient;
(async () => {
    redisClient = redis.createClient();
    redisClient.on("error", (error) => console.error(`Error : ${error}`));

    await redisClient.connect();
})();

// function to fetch data from API
async function fetchCurrentApiData(stationid, span) {
    let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=M&${getMonthlyDateRange(span)}`;
    let data = await axios.get(url);
    data = data.data;
    // console.log("had to fetch from API (monthly_current)")
    return data;
}

// function to fetch historical data from API
async function fetchHistoricalApiData(stationid, cacheId) {
    let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=M&Start=1988-1-1&End=${getCurrentYear() - 1}-12-1`;
    const apiResponse = await axios.get(url);
    let data = cleanData(apiResponse.data, cacheId);
    const averages = {};
    let month;
    let dateString = data[data.length - 1].date;

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
        item.date = dateString;
    });

    // console.log("had to fetch from API (monthly_historical)")

    return averages;
}

// // function to fetch yesterday's reservoir level from API
// async function fetchYesterdaysApiData(stationid) {
//     const yesterdaysDate = getYesterdaysDate();
//     let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=D&Start=${yesterdaysDate}&End=${yesterdaysDate}`;
//     let data = await axios.get(url);
//     data = data.data;

//     // console.log("had to fetch from API (yesterday)")

//     return data;
// }

// function to fetch past reservoir level from API
async function fetchPastApiData(stationid, daysAgo) {
    console.log("days ago: ", daysAgo);
    let date = getPastDate(daysAgo);
    let url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=D&Start=${date}&End=${date}`;
    let data = await axios.get(url);
    data = data.data;

    // console.log("had to fetch from API (yesterday)")

    return data;
}

/* 
Function to see if result has at least one non-missing value.
This is especially important for single day data. If a single day has a value of 
-9999, then it can't be used. Single day data is also more likely to have a value
of -9999, since the CDEC API data is not always updated in a timely manner.
*/
function isValid(results, cacheId) {
    // console.log("results in isValid: ", results, cacheId)
    if (cacheId === 'yesterday') {
        if (results[0].value == -9999) {
            // console.log('results are invalid ', cacheId, results[0].stationId)
            return false;
        }
    }
    else if (cacheId === 'monthly_current') {
        console.log("LAST VALUE: ", results[results.length - 1].value)
        if (results[results.length - 1].value == -9999) {
            return false;
        }
    }
    console.log("IS VALID")
    return true;
}

function resultsAreOld(results, cacheId) {
    // console.log("DATA IN resultsAreOld: ", results);

    // console.log("cacheId: ", cacheId);
    results = JSON.parse(results);
    const currentDate = new Date();
    let currentMonth = currentDate.getMonth() + 1;
    let currentYear = currentDate.getFullYear();
    let currentDay = currentDate.getDate();
    let dateString;
    let parts;

    if (cacheId === 'monthly_historical') {
        dateString = results[12].date;
        parts = dateString.split("/");

        // Ensure there are three parts (month, day, year)
        if (parts.length === 3) {
            const month = parseInt(parts[0]);
            const day = parseInt(parts[1]);
            const year = parseInt(parts[2]);

            /* historical results are old if they are not from the previous year, because we don't include the current year
            in our averages. Thus, the -1.*/
            if (year != currentYear - 1) {
                return true;
            }
        }
        else {
            throw "incorrect date format in cached data"
        }
    }

    else if (cacheId === 'monthly_current') {
        dateString = results[results.length - 1].date;
        parts = dateString.split("/");

        // Ensure there are three parts (month, day, year)
        if (parts.length === 3) {
            const month = parseInt(parts[0]);
            const day = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            /* 'monthly_current' data is valid if it goes up until the month before the current month. 
            This is because we cache monthly data up until only the previous month, because the current month's data doesn't
            become available in the CDEC API until the next month. (ex. if it is October, then the 'monthly_current' data is valid
            if it goes up until September).*/
            let validMonth = (currentMonth == 1 ? 12 : currentMonth - 1);
            let validYear = (currentMonth == 1 ? currentYear - 1 : currentYear);

            if (month != validMonth || year != validYear) {
                return true;
            }
        }
        else {
            throw "incorrect date format in cached data"
        }
    }

    else if (cacheId === 'yesterday') {
        dateString = results[results.length - 1].date;
        parts = dateString.split("/");

        // Ensure there are three parts (month, day, year)
        if (parts.length === 3) {
            const month = parseInt(parts[0]);
            const day = parseInt(parts[1]);
            const year = parseInt(parts[2]);

            if (day != currentDay - 1 || month != currentMonth || year != currentYear) {
                return true;
            }
        }
        else {
            throw "incorrect date format in cached data"
        }
    }

    return false;
}

// getCacheData("ORO", "monthly", 2)
// cacheId = {"yesterday", "monthly_current", "monthly_historical"}
async function getCacheData(stationid, cacheId, span = null) {
    console.log("cacheId: ", cacheId)

    let results;
    try {
        const cacheResults = await redisClient.get(`${cacheId}_storage_${stationid}_${span}`);

        // handle the case where there is nothing in the cache for this cacheId
        if (!cacheResults) {
            console.log('NO CACHE RESULTS ---------------------------------------')
            if (cacheId === 'yesterday') {
                results = await fetchPastApiData(stationid, 1);
                if (isValid(results, cacheId)) {
                    console.log("valid valid")
                    results = cleanData(results, cacheId);
                }
                else {
                    // if yesterdays data not available, try two days ago
                    results = await fetchPastApiData(stationid, 2);
                    if (isValid(results, cacheId)) {
                        results = cleanData(results, cacheId);
                    }
                    else {
                        throw "No data in cache and unable to fetch new data"
                    }
                }
            } else if (cacheId === 'monthly_current') {
                results = await fetchCurrentApiData(stationid, span);
                if (isValid(results, cacheId)) {
                    results = cleanData(results, cacheId);
                }
                else {
                    throw "No data in cache and unable to fetch new data"
                }
            } else if (cacheId === 'monthly_historical') {
                results = await fetchHistoricalApiData(stationid, cacheId);
                if (!results) {
                    throw "No data in cache and unable to fetch new data"
                }
            }

            // console.log('caching data...');
            await redisClient.set(`${cacheId}_storage_${stationid}_${span}`, JSON.stringify(results));
            return results;
        }

        // handle the case where the results in the cache are old/expired and need to be refreshed
        else if (resultsAreOld(cacheResults, cacheId)) {
            // console.log("results are old ", cacheId, stationid);
            if (cacheId === 'yesterday') {
                results = await fetchPastApiData(stationid, 1);
                if (isValid(results, cacheId)) {
                    results = cleanData(results, cacheId);
                }
                else {
                    // if yesterdays data not available, try two days ago
                    results = await fetchPastApiData(stationid, 2);
                    if (isValid(results, cacheId)) {
                        results = cleanData(results, cacheId);
                    }
                    else {
                        return JSON.parse(cacheResults);
                    }
                }
            } else if (cacheId === 'monthly_current') {
                console.log("YESTERDAY -----------------------------------------------")
                results = await fetchCurrentApiData(stationid, span);
                if (isValid(results, cacheId)) {
                    results = cleanData(results, cacheId);
                }
                else {
                    return JSON.parse(cacheResults);
                }
            } else if (cacheId === 'monthly_historical') {
                results = await fetchHistoricalApiData(stationid, cacheId);
                if (!results) {
                    return JSON.parse(cacheResults);
                }
            }

            // console.log('caching data...');
            await redisClient.set(`${cacheId}_storage_${stationid}_${span}`, JSON.stringify(results));
            return results;
        }

        // handle the case where the results in the cache are fresh
        // console.log("fetched fresh results", cacheId, stationid);
        return JSON.parse(cacheResults);

    } catch (error) {
        console.log("error fetching data!!!!");
        console.log(error)
        // return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
    }

}


module.exports = {
    getCacheData
}
function formatDateString(dateString) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    })
}

// function to get a current Date object in Los_Angeles time (instead of UTC)
function getCurrentDate() {
    const todayUTC = new Date();
    // the public API updates based on the Los_Angeles timezone, so our date values should be the same timezone
    const todayString = todayUTC.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
    const today = new Date(todayString);
    const date = new Date(today);
    return date;
}

function getMonthlyDateRange(span) {
    const currentDate = getCurrentDate();
    let year = currentDate.getFullYear();
    let month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    let startMonth = month;
    let startYear = year - span;
    let endMonth;
    let endYear;

    if (month == 1) {
        endMonth = 12;
        endYear = year - 1;
    }
    else {
        endMonth = month - 1;
        endYear = year;
    }

    // let day = String(currentDate.getDate()).padStart(2, '0');
    let day = 1; // setting to 1 so that no queries are made with days of months that don't exist (for example: February 31)
    let endDate = `${endYear}-${endMonth}-${day}`;
    let startDate = `${startYear}-${startMonth}-${day}`;
    console.log(`Start=${startDate}&End=${endDate}`)
    return `Start=${startDate}&End=${endDate}`
}

function getCurrentYear() {
    const currentDate = getCurrentDate();
    let year = currentDate.getFullYear();
    return `${year}`
}

// function to return a past date
function getPastDate(daysAgo) {
    const today = getCurrentDate();
    const oldDate = new Date(today);
    oldDate.setDate(today.getDate() - daysAgo);
    const year = oldDate.getFullYear();
    const month = (oldDate.getMonth() + 1).toString().padStart(2, '0');
    const day = oldDate.getDate().toString().padStart(2, '0');

    return `${year}-${month}-${day}`;
}

/* 
Function to calculate the number of seconds left in the current year or month (plus 1 hour to give the CDEC API enough time to update)
Used to set TTL for data in redis cache.

CAUTION: This function caluclates seconds left based on the machine's local time. 
Currently, the server is on Pacific time, so it works.
If moving to other servers, must update accordingly.
*/
function getCacheTTL(interval) {
    const currentDate = getCurrentDate();
    let secondsLeft;
    if (interval === 'annual') {
        const currentYear = currentDate.getFullYear();
        // Create a new Date object for the start of the next year
        const nextYearDate = new Date(currentYear + 1, 0, 1, 0, 0, 0);
        // Calculate the difference in milliseconds between the current date and the start of the next year
        const timeDifference = nextYearDate - currentDate;
        // Convert the time difference to seconds
        secondsLeft = Math.floor(timeDifference / 1000);
    }
    else if (interval === 'monthly') {
        // Get the current month
        const currentMonth = currentDate.getMonth();
        // Create a new Date object for the start of the next month
        const nextMonthDate = new Date(currentDate.getFullYear(), currentMonth + 1, 1, 0, 0, 0);
        // Calculate the difference in milliseconds between the current date and the start of the next year
        const timeDifference = nextMonthDate - currentDate;
        // Convert the time difference to seconds
        secondsLeft = Math.floor(timeDifference / 1000);
    }
    else if (interval === 'daily') {
        const endOfDay = new Date();
        // Set to one millisecond before the next day
        endOfDay.setHours(23, 59, 59, 999);
        const millisecondsRemaining = endOfDay - currentDate;
        // Convert milliseconds to seconds
        secondsLeft = Math.floor(millisecondsRemaining / 1000);
    }
    return secondsLeft + 3600; // add 1 hour to give CDEC API enough time to update.
}

function cleanData(data, cacheId) {
    //format the dates
    data = data.map(item => ({
        stationId: item.stationId,
        value: item.value,
        date: formatDateString(item.date)
    }));

    //need to remove last element of data if data is sampled monthly, since the CDEC API returns -9999 for value of current month
    // if (cacheId === 'monthly_current') {
    //     data.pop();
    // }

    //interpolating missing values (missing values are represented as -9999 by the API)
    for (let i = 0; i < data.length; i++) {
        if (data[i].value === -9999) {
            //if the missing value is the first value in the array, we cannot use the previous value for interpolation.
            //thus, we use the slope of the next two values
            if (i == 0) {
                data[i].value = data[i + 1].value - (data[i + 2].value - data[i + 1].value)
            }
            //if the missing value is the last value in the array, we cannot use the next value for interpolation.
            //thus, we use the previous value to avoid dramatic predictions! (such as steep plunges in reservoirs levels).
            //it should never come to this, as our caching algorithm doesn't return or cache data where the last value is 
            //-9999, but better safe than sorry.
            else if (i == data.length - 1) {
                data[i].value = data[i - 1].value
            }
            //if the missing value has values before and after it, we simply take the average of these two values.
            else {
                data[i].value = (data[i - 1].value + data[i + 1].value) / 2
            }
        }
    }
    return data
}

module.exports = {
    getMonthlyDateRange,
    getCurrentYear,
    getPastDate,
    cleanData,
    getCacheTTL,
    formatDateString,
}
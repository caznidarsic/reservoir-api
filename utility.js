function formatDateString(dateString) {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
    })
}

function getDateRange(span) {
    const currentDate = new Date();
    let year = currentDate.getFullYear();
    let month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    let day = String(currentDate.getDate()).padStart(2, '0');
    let endDate = `${year}-${month}-${day}`;
    // console.log(chartRange);
    year = year - span;
    let startDate = `${year}-${month}-${day}`;
    return `Start=${startDate}&End=${endDate}`
}

function cleanData(data, span) {
    //format the dates
    data = data.map(item => ({
        stationId: item.stationId,
        value: item.value,
        date: formatDateString(item.date)
    }));

    //need to remove last element of data if data is sampled monthly, since the API returns 0 for value of current month
    if (span === '1 year' || span === '2 years') {
        data.pop();
    }

    //interpolating missing values (missing values are represented as -9999 by the API)
    for (let i = 0; i < data.length; i++) {
        if (data[i].value === -9999) {
            //if the missing value is the first value in the array, we cannot use the previous value for interpolation.
            //thus, we use the slope of the next two values
            if (i == 0) {
                data[i].value = data[i + 1].value - (data[i + 2].value - data[i + 1].value)
            }
            //if the missing value is the last value in the array, we cannot use the next value for interpolation.
            //thus, we use the slope of the previous two values
            else if (i == data.length - 1) {
                data[i].value = data[i - 1].value + (data[i - 1].value - data[i - 2].value)
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
    getDateRange,
    cleanData,
}
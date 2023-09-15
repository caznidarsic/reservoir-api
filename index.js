const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { getDateRange, cleanData } = require('./utility');
const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(express.json());
app.use(cors({
    origin: 'https://reservoirlevels.christianznidarsic.com'
}));


//endpoint to get monthly reservoir data
app.get('/resdata', (req, res) => {
    let stationid = req.query.stationid;
    let span = req.query.span;
    // let frequency = req.query.frequency;

    // will need to update the span variable to include 6 month span, since span variable can only be a number based on the getDateRange() function
    const url = `https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=${stationid}&SensorNums=15&dur_code=${(span === '6 months' ? 'D' : 'M')}&${getDateRange(span)}`;

    console.log(url);

    axios.get(url)
        .then(response => {
            return res.status(200).send(JSON.stringify(cleanData(response.data, span)));
        })
        .catch(error => {
            console.log(error)
            return res.status(500).send(JSON.stringify({ message: `error fetching data` }));
        })
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

//CHANGE MADE!!!

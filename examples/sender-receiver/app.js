/* eslint-disable no-console */
const express = require('express');
const app = express();
const port = 3000;

const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const Ossa = require('ossa');
const ossa = new Ossa({
    namespace: "ossa", // Default
    redis: {
        host: 'redis',
        // host: 'localhost', // Default
        port: 6379 // Default
    },
    debug: false, // Default
    mode: 1
});

app.post('/send-notification', async (req, res) => {
    const {
        namespace,
        message
    } = req.body;

    if (!["ossa"].includes(namespace)) {
        return res.status(400).json({
            error: `Namespace should be either ossa or `
        });
    }

    try {
        const notificationID = await ossa.sendNotification({
            in: req.body.in,
            message
        });
        console.log("[namespace] notificationID: ", notificationID)
        return res.json({
            ...req.body,
            notification_id: notificationID
        })
    } catch (error) {
        throw new Error(error);
    }

});

app.listen(port, () => console.log(`Sender-receiver app listening at http://localhost:${port}`));

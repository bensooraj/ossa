/* eslint-disable no-console */
const http = require('http');

const hostname = '0.0.0.0';
const port = 3002;

const Ossa = require('ossa');

// Namespace: ossa
const ossa = new Ossa({
    namespace: "ossa", // Default
    redis: {
        host: 'redis',
        // host: 'localhost', // Default
        port: 6379 // Default
    },
    debug: false // Default
});

ossa.on('notification-received', async (notificationID, notificationPayload) => {
    // Process the payload received
    console.log("notificationPayload: ", notificationPayload)
    console.table([
        { notificationID, message: notificationPayload.message }
    ]);
});


// Node server
const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('This is receiver two');
});

server.listen(port, hostname, () => {
    console.log(`Receiver server 2 running at http://${hostname}:${port}/`);
});
const EventEmitter = require('events').EventEmitter;
const redis = require('./redis');
const { v4: uuidv4 } = require('uuid');
const ms = require('ms');
const moment = require('moment');
const { promisify } = require("util");

class Hermes extends EventEmitter {
    constructor(options) {
        super();
        // Config variables
        this.options = options;
        this.namespace = options.namespace || "hermes";
        this.hermes_payload_store = `${this.namespace}::hermes_payload_store`;
        this.hermes_processing_queue = `${this.namespace}::hermes_processing_queue`;

        this.client = redis.createRedisClient(options);

        // Subscriber | For receiving key expiration event
        this.subscriber = this.client.duplicate()
        // Enable Redis Keyspace Notifications via the CONFIG SET.
        try {
            const reply = this.subscriber.config("SET", "notify-keyspace-events", "ExKl");
            console.log("[subscriber] reply: ", reply);
        } catch (error) {
            console.log("Error enabling Redis Keyspace Notifications");
            throw new Error(error);
        }
        // Subcribe to keyevent notification channel
        this.subscriber.subscribe("__keyevent@0__:expired");
        this.subscriber.subscribe(`__keyspace@0__:${this.hermes_processing_queue}`);
        this.subscriber.on('message', this.keyspaceNotificationsHandler.bind(this));
    }

    async notify(options = {}) {
        // input check
        // if (!(options.hasOwnProperty("to") && options.to !== "")) {
        //     throw new Error("[options.to] You must specify a channel to send the message");
        // }

        // Calculate the expiration duration in seconds
        let expirationDurationInSeconds = 0;
        if (options.hasOwnProperty("on") && options.on !== "") {
            // Check if the datetime is valid
            if (moment(options.on).isValid()) {
                throw new Error(`[options.on] Invalid date format`);
            }
            // Check if the datetime is in the future
            if (moment(options.on).isBefore(moment.utc())) {
                throw new Error(`[options.on] Datetime must be a future Datetime`);
            }
            const timeDiff = moment(options.on).diff(moment.utc());
            const timeDuration = moment.duration(timeDiff);
            expirationDurationInSeconds = Math.round(timeDuration.asSeconds());
            console.log("timeDuration.asSeconds(): ", timeDuration.asSeconds());

        } else if (options.hasOwnProperty("in") && options.on !== "") {
            expirationDurationInSeconds = ms(options.in) / 1000
        }

        // start a separate multi command queue
        const multi = this.client.multi();
        const notificationID = `${this.namespace}::${uuidv4()}`;
        // Set key with expiry
        multi.setex(notificationID, expirationDurationInSeconds, new Date().toTimeString());
        // Store the payload
        multi.hset(this.hermes_payload_store, notificationID, options.payload);

        const multiExecAsync = promisify(multi.exec).bind(multi);
        // const setexAsync = promisify(this.client.setex).bind(this.client);
        try {
            const [ok, count] = await multiExecAsync();
            if (ok !== 'OK' && count) {
                throw new Error(`Response from Redis server not okay: ok => ${ok} | count: ${count}`);
            }
        } catch (error) {
            throw new Error(error);
        }
        return;
    }

    async keyspaceNotificationsHandler(channel, message) {
        const namespaceCheck = new RegExp(`^${this.namespace}::.*$`, 'i');

        if (
            channel === `__keyevent@0__:expired` &&
            namespaceCheck.test(message)
        ) {
            console.log(`[EXPIRED] Subscriber received message in channel ${channel} => ${message}`);
            // Push payload key to the processing queue
            // this.hermes_processing_queue
            const lpushAsync = promisify(this.client.lpush).bind(this.client);
            try {
                const reply = await lpushAsync(this.hermes_processing_queue, message);
                console.log("[lpushAsync]: ", reply);
            } catch (error) {
                throw new Error(error);
            }
        }

        if (
            channel === `__keyspace@0__:${this.hermes_processing_queue}` &&
            message === "lpush"
        ) {
            console.log(`[LPUSH] Subscriber received message in channel ${channel} => ${message}`);

            const blpopAsync = promisify(this.client.blpop).bind(this.client);
            try {
                const [_, notificationID] = await blpopAsync(this.hermes_processing_queue, 0);

                const multi = this.client.multi();
                multi.hget(this.hermes_payload_store, notificationID)
                multi.hdel(this.hermes_payload_store, notificationID)
                const multiExecAsync = promisify(multi.exec).bind(multi);
                try {
                    const [notificationPayload, count] = await multiExecAsync();
                    if (!count) {
                        throw new Error(`Response from Redis server not okay: notificationPayload => ${notificationPayload} | count: ${count}`);
                    }
                } catch (error) {
                    throw new Error(error);
                }
            } catch (error) {
                throw new Error(error);
            }
        }
    }

    // Set Key Value
    async setKey() {
        const setAsync = promisify(this.client.set).bind(this.client);
        try {
            await setAsync("test_date_key", new Date().toTimeString());
        } catch (error) {
            throw new Error(error);
        }
    }
}

/**
 * Expose `Hermes`.
 */
module.exports = Hermes;

module.exports.createNotifier = (options) => {
    if (!Hermes.singleton) {
        Hermes.singleton = new Hermes(options);
    }

    return Hermes.singleton;
};
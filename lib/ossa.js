const EventEmitter = require('events').EventEmitter;
const { promisify } = require("util");

const redis = require('./redis');
const { v4: uuidv4 } = require('uuid');
const ms = require('ms');
const moment = require('moment');

// Debugger
const debug = require('debug');
const log = debug('ossa');

class Ossa extends EventEmitter {
    constructor(options = {}) {
        super();

        if (options.debug) {
            // Switch on the debugging messages
            debug.enable("*");
        }

        // Config variables
        this.options = options;
        this.namespace = options.namespace || "ossa";
        this.ossa_payload_store = `${this.namespace}::ossa_payload_store`;
        this.ossa_processing_queue = `${this.namespace}::ossa_processing_queue`;

        log("Options provided: %O", this.options);
        log("namespace: %s", this.namespace);
        log("ossa_payload_store: %s", this.ossa_payload_store);
        log("ossa_processing_queue: %s", this.ossa_processing_queue);

        this.client = redis.createRedisClient(options);

        // Subscriber | For receiving key expiration event
        this.subscriber = this.client.duplicate()
        // Enable Redis Keyspace Notifications via the CONFIG SET.
        try {
            const reply = this.subscriber.config("SET", "notify-keyspace-events", "ExKl");
            log("Subcriber set config response: %s", reply)
        } catch (error) {
            log("Error enabling Redis Keyspace Notifications");
            throw new Error(error);
        }
        // Subcribe to keyevent notification channel
        this.subscriber.subscribe("__keyevent@0__:expired");
        this.subscriber.subscribe(`__keyspace@0__:${this.ossa_processing_queue}`);
        this.subscriber.on('message', this.keyspaceNotificationsHandler.bind(this));

        log(`Subscriber subscribed to: __keyevent@0__:expired`)
        log(`Subscriber subscribed to: __keyspace@0__:${this.ossa_processing_queue}`)
    }

    async sendNotification(payload = {}) {
        // Set the debugger/logger
        let _log = log.extend('sendNotification');
        _log("Payload received: %O", payload);

        // input check
        if (!(
            payload.hasOwnProperty("message") && typeof payload.message === 'string' && payload.message !== ""
        )) {
            throw new Error("[payload.message] The message must be of type string");
        }

        // Calculate the expiration duration in seconds
        let expirationDurationInSeconds = 0;
        if (payload.hasOwnProperty("on") && payload.on !== "") {
            // Check if the datetime is valid
            if (moment(payload.on).isValid()) {
                throw new Error(`[payload.on] Invalid date format`);
            }
            // Check if the datetime is in the future
            if (moment(payload.on).isBefore(moment.utc())) {
                throw new Error(`[payload.on] Datetime must be a future Datetime`);
            }
            const timeDiff = moment(payload.on).diff(moment.utc());
            const timeDuration = moment.duration(timeDiff);
            expirationDurationInSeconds = Math.round(timeDuration.asSeconds());

        } else if (payload.hasOwnProperty("in") && payload.on !== "") {
            expirationDurationInSeconds = ms(payload.in) / 1000
        }
        _log("expirationDurationInSeconds: %s", expirationDurationInSeconds);

        const notificationID = `${this.namespace}::${uuidv4()}`,
            notificationPayload = JSON.stringify(payload);
        // start a separate multi command queue
        const multi = this.client.multi();
        // Set key with expiry
        multi.setex(notificationID, expirationDurationInSeconds, new Date().toTimeString());
        // Store the payload
        multi.hset(this.ossa_payload_store, notificationID, notificationPayload);

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
        return notificationID;
    }

    async keyspaceNotificationsHandler(channel, message) {
        // Set the debugger/logger
        let _log = log.extend('keyspaceNotificationsHandler');

        const namespaceCheck = new RegExp(`^${this.namespace}::.*$`, 'i');

        if (
            channel === `__keyevent@0__:expired` &&
            namespaceCheck.test(message)
        ) {
            _log(`[EXPIRED] Subscriber received message in channel ${channel} => ${message}`);
            // Push payload key to the processing queue
            // this.ossa_processing_queue
            const lpushAsync = promisify(this.client.lpush).bind(this.client);
            try {
                const reply = await lpushAsync(this.ossa_processing_queue, message);
                _log("[lpushAsync]: %s", reply);
            } catch (error) {
                throw new Error(error);
            }
        }

        if (
            channel === `__keyspace@0__:${this.ossa_processing_queue}` &&
            message === "lpush"
        ) {
            _log(`[LPUSH] Subscriber received message in channel ${channel} => ${message}`);

            const blpopAsync = promisify(this.client.blpop).bind(this.client);
            try {
                const [_, notificationID] = await blpopAsync(this.ossa_processing_queue, 0);

                const multi = this.client.multi();
                multi.hget(this.ossa_payload_store, notificationID)
                multi.hdel(this.ossa_payload_store, notificationID)
                const multiExecAsync = promisify(multi.exec).bind(multi);
                try {
                    const [notificationPayload, count] = await multiExecAsync();
                    _log(`count => ${count} | notificationPayload => %O`, notificationPayload);
                    if (!count) {
                        throw new Error(`Response from Redis server not okay: notificationPayload => ${notificationPayload} | count: ${count}`);
                    }

                    this.emit("notification-received", notificationID, JSON.parse(notificationPayload));
                    _log(`notification-received event emitted for notificationID: ${notificationID}`);
                } catch (error) {
                    throw new Error(error);
                }
            } catch (error) {
                throw new Error(error);
            }
        }
    }
}

/**
 * Expose `Ossa`.
 */
module.exports = Ossa;

module.exports.createNotifier = (options) => {
    if (!Ossa.singleton) {
        Ossa.singleton = new Ossa(options);
    }
    return Ossa.singleton;
};
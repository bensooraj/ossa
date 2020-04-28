const EventEmitter = require('events').EventEmitter;
const { promisify } = require("util");

const redis = require('./redis');
const { v4: uuidv4 } = require('uuid');
const ms = require('ms');
const moment = require('moment');

// Debugger
const debug = require('debug');
const log = debug('ossa');

// Define a Payload
/**
 * @typedef {Object} notificationPayload
 * @property {String} message The actual associated with the notification
 * @property {(Number|String)} in Number of milliseconds to send the message after. It can also be a string of the form:
 * 
 * <pre>
 * '2 days'
 * '1d'
 * '10h'
 * '2.5 hrs'
 * '2h'
 * '1m'
 * '5s'
 * '1y'
 * '100'  
 * </pre>
 * 
 * <p>Refer the [ms module's documentation]{@link https://github.com/zeit/ms#readme}</p>
 * 
 * @property {String} on A valid timestamp string.
 * 
 * <p>Refer the [momentjs module's documentation]{@link https://momentjs.com/docs/#/parsing/is-valid/}</p>
 */

/**
 * Node.js server-side module (powered by Redis) for creating a basic notification service.
 * 
 * @extends {EventEmitter}
 */
class Ossa extends EventEmitter {
    /**
     * Creates an instance of Ossa.
     * @param {Object} options
     * @param {String} [options.namespace=ossa] Set the namespace
     * @param {(String|Object)} [options.redis] Redis client connection options. For exhaustive list of properties and defaults please refer to the [redis documentation]{@link https://github.com/NodeRedis/node-redis#rediscreateclient}
     * @param {String} [options.redis.host=127.0.0.1] IP address of the Redis server
     * @param {Number} [options.redis.port=6379] Port of the Redis server
     * @param {Number} [options.redis.db=0] If set, client will run Redis `select` command on connect. 
     * @param {Boolean} [options.debug=false] Toggle debug mode
     * @memberof Ossa
     */
    constructor(options = {}) {
        super();

        if (options.debug) {
            // Switch on the debugging messages
            debug.enable("*");
        }

        // Return a cached instance, if one exists for the namespace
        if (Ossa[options.namespace || "ossa"]) {
            return Ossa[options.namespace];
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

        // Cache the instance
        Ossa[this.namespace] = this;
    }

    /**
     *
     * sendNotification: Method for setting the notification payload along with when it should be sent
     * @param {notificationPayload} payload
     * @returns {String} notificationID (of the form `namespace::uuid`)
     * @memberof Ossa
     */
    async sendNotification(payload) {
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

    /**
     * 
     * @summary Get a scheduled notification's TTL (time to live) remaining and payload, by notificationID.
     * @description The `ttl` returned can have three possible values
     * 
     * <pre>
     *    'A positive integer'    Actual time to live in milliseconds 
     *    '-2'                    If the key does not exist, or if it has expired. Payload returned will be null.
     *    '-1'                    If the key exists but has no associated expire. Payload returned will be null.
     * </pre>
     * 
     * @param {String} notificationID of the form `namespace::uuid`
     * @returns {Array} [ttl, {@link notificationPayload}]
     * @memberof Ossa
     * 
     */
    async getNotificationByID(notificationID) {
        const namespaceCheck = new RegExp(`^${this.namespace}::.*$`, 'i');
        // input check
        if (!(
            typeof notificationID === 'string' &&
            namespaceCheck.test(notificationID)
        )) {
            throw new Error("[getNotification] notificationID is missing or the format is invalid");
        }
        // start a separate multi command queue
        const multi = this.client.multi();
        // Get the TTL of the notificationID
        multi.pttl(notificationID);
        // Get the associated payload
        multi.hget(this.ossa_payload_store, notificationID);
        // Execute
        const multiExecAsync = promisify(multi.exec).bind(multi);
        try {
            const [ttl, notificationPayload] = await multiExecAsync();
            return [ttl, JSON.parse(notificationPayload)];
        } catch (error) {
            throw new Error(error);
        }
    };

    /**
     *
     * @summary Method for updating a notification's TTL and payload, notificationID
     * @param {String} notificationID
     * @param {notificationPayload} notificationPayload
     * @returns {Number} Response will be one of:
     * 
     * <pre>
     *    0    The update was not made, because the notificationID was not found or has expired already
     *    1    The update was successful
     * </pre>
     * 
     * @memberof Ossa
     */
    async updateNotification(notificationID, notificationPayload) {
        // Set the debugger/logger
        let _log = log.extend('updateNotification');
        _log("notificationID being updated: %O", notificationID);
        _log("notificationPayload: %O", notificationPayload);

        // notificationID check
        const namespaceCheck = new RegExp(`^${this.namespace}::.*$`, 'i');
        if (!(
            typeof notificationID === 'string' &&
            namespaceCheck.test(notificationID)
        )) {
            throw new Error("[updateNotification] notificationID is missing or the format is invalid");
        }

        // input check
        if (!(
            notificationPayload.hasOwnProperty("message") && typeof notificationPayload.message === 'string' && notificationPayload.message !== ""
        )) {
            throw new Error("[notificationPayload.message] The message must be of type string");
        }

        // Calculate the expiration duration in seconds
        let expirationInMilliSeconds = 0;
        if (notificationPayload.hasOwnProperty("on") && notificationPayload.on !== "") {
            // Check if the datetime is valid
            if (moment(notificationPayload.on).isValid()) {
                throw new Error(`[notificationPayload.on] Invalid date format`);
            }
            // Check if the datetime is in the future
            if (moment(notificationPayload.on).isBefore(moment.utc())) {
                throw new Error(`[notificationPayload.on] Datetime must be a future Datetime`);
            }
            // const timeDiff = moment(notificationPayload.on).diff(moment.utc());
            // const timeDuration = moment.duration(timeDiff);
            expirationInMilliSeconds = moment(notificationPayload.on).valueOf();

        } else if (notificationPayload.hasOwnProperty("in") && notificationPayload.on !== "") {
            expirationInMilliSeconds = ms(notificationPayload.in);
        }
        _log("expirationInMilliSeconds: %s", expirationInMilliSeconds);

        // start a separate multi command queue
        const multi = this.client.multi();

        // Set key with expiry only IF IT EXISTS already
        if (notificationPayload.hasOwnProperty("on")) {
            multi.set(notificationID, moment().utc().format("YYYY-MM-DD HH:mm:ss"), "XX");
            multi.expireat(notificationID, expirationInMilliSeconds);

        } else if (notificationPayload.hasOwnProperty("in")) {
            multi.set(notificationID, moment().utc().format("YYYY-MM-DD HH:mm:ss"), "PX", expirationInMilliSeconds, "XX");
        }
        const multiExecAsync = promisify(multi.exec).bind(multi);
        try {
            const reply = await multiExecAsync();
            _log("multiExecAsync::reply: %O", reply)
            if (reply[0] === 'OK') {
                const hsetAsync = promisify(this.client.hset).bind(this.client);
                try {
                    const count = await hsetAsync(this.ossa_payload_store, notificationID, JSON.stringify(notificationPayload));
                    _log("hsetAsync::count %s", count);

                    return 1;
                } catch (error) {
                    throw new Error(error);
                }
            }
        } catch (error) {
            throw new Error(error);
        }
        return 0;
    }

    /**
     *
     * @summary Method for deleting a notification altogether, if it exists or if it hasn't expired yet
     *
     * @param {String} notificationID
     * @returns {Number}
     * 
     * <pre>
     *    0    notification was not deleted, because the notificationID was not found or has expired already
     *    1    The delete was successful
     * </pre>
     * 
     * @memberof Ossa
     */
    async deleteNotification(notificationID) {
        // Set the debugger/logger
        let _log = log.extend('deleteNotification');
        _log("notificationID being updated: %O", notificationID);

        // notificationID check
        const namespaceCheck = new RegExp(`^${this.namespace}::.*$`, 'i');
        if (!(
            typeof notificationID === 'string' &&
            namespaceCheck.test(notificationID)
        )) {
            throw new Error("[deleteNotification] notificationID is missing or the format is invalid");
        }

        // start a separate multi command queue
        const multi = this.client.multi();
        multi.del(notificationID)
        multi.hdel(this.ossa_payload_store, notificationID);
        const multiExecAsync = promisify(multi.exec).bind(multi);

        try {
            const reply = await multiExecAsync();
            _log("multiExecAsync::reply: %O", reply)
            if (reply[0] > 0) {
                return 1;
            }
        } catch (error) {
            throw new Error(error);
        }
        return 0;
    }

    /**
     * Handle the the keyspace and event notifications from the Redis subscriber and fire the `notification-received` when needed.
     *
     * @fires Ossa#notification-received
     * @private
     */
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

                    /**
                     * Emit the `notification-received` when Redis notifies of event expiry (followed by an LPUSH and BLPOP to a Redis list).
                     *
                     * @event Ossa#notification-received
                     */
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
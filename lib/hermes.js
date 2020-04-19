const EventEmitter = require('events').EventEmitter;
const redis = require('./redis');
const { v4: uuidv4 } = require('uuid');
const ms = require('ms');
const moment = require('moment');
const { promisify } = require("util");

class Hermes extends EventEmitter {
    constructor(options) {
        super();
        // console.log("Hermes::I am a debugging message")
        this.options = options;
        this.namespace = options.namespace || "hermes";
        this.client = redis.createRedisClient(options);
    }

    async notify(options = {}) {
        // input check
        if (!(options.hasOwnProperty("to") && options.to !== "")) {
            throw new Error("[options.to] You must specify a channel to send the message");
        }

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

        const setexAsync = promisify(this.client.setex).bind(this.client);
        try {
            await setexAsync(`${this.namespace}:${uuidv4()}`, expirationDurationInSeconds, new Date().toTimeString())
        } catch (error) {
            throw new Error(error);
        }

        return;
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
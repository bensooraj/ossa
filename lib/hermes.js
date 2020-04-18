const EventEmitter = require('events')
const redis = require('./redis');
const { promisify } = require("util");

class Hermes extends EventEmitter {
    constructor(options) {
        super();
        // console.log("Hermes::I am a debugging message")
        this.options = options;
        this.client = redis.createRedisClient(options);
    }

    notify() {

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
const redis = require('redis');
const url = require('url');

module.exports.createRedisClient = (options) => {

    if (typeof options.redis === "string") {
        // Parse the connection string
        const connectionInfo = url.parse(options.redis);
        if (connectionInfo.protocol !== "redis:") {
            throw new Error("The connection string does not use the redis:// protocol");
        }

        options.redis = {
            host: connectionInfo.hostname || '120.0.0.1',
            port: connectionInfo.port || 6379,
            db: (connectionInfo.pathname ? connectionInfo.pathname.substr(1) : null) || connectionInfo.query.db || 0,
            options: connectionInfo.query
        };

        if (connectionInfo.auth) {
            // Take only the password from 'username:password'
            options.redis.auth = connectionInfo.auth.replace(/.*?:/, '');
        }
    }

    options.redis = options.redis || {};


    // Create the client
    const redisClient = redis.createClient({
        host: options.redis.host || '120.0.0.1',
        port: options.redis.port || 6379
    })

    // Authenticate the client if password is specified
    if (options.redis.auth) {
        redisClient.auth(options.redis.auth);
    }

    // Select a db if specified
    const db = Number(options.redis.db || 0);
    if (db >= 0) {
        redisClient.select(db);
    }

    return redisClient;
};
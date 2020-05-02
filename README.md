# Ossa

[![npm version](https://badge.fury.io/js/ossa.svg)](https://badge.fury.io/js/ossa)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fbensooraj%2Fossa.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fbensooraj%2Fossa?ref=badge_shield)

Ossa is a Node.js server-side module (powered by Redis) for creating a basic notification service.

It's API is dead simple. Developers are welcome to test it out in their pet projects!

**Note: This is not production ready.**

## Installation

`$ npm install kue`

## Getting started:

#### Create the notifier:

```js
const Ossa = require('ossa');
const ossa = new Ossa({
    namespace: "ossa", // Default
    redis: {
        host: 'localhost', // Default
        port: 6379 // Default
    },
    debug: false // Default
});
```

#### Send a notification/message:

```js
try {
    const notificationID = await ossa.sendNotification({
        in: '10s',
        // on: moment().utc().add(30, 'seconds'),
        // on: '2020-05-02 03:23:00',
        // on: '2020-05-01T21:59:16Z',
        message: JSON.stringify({
            name: "Ben",
            age: 1000,
        })
    });
    console.log("notificationID: ", notificationID)
} catch (error) {
    throw new Error(error);
}

// Output:
// notificationID:  ossa::f1799e87-6740-4394-bf5e-d6e55eae3914
```

There are two ways to schedule a notification:
1. **`in`**: Time duration in millisecods. Acceptable values are: `'2 days'`, `'1d'`, `'10h'`, `'2.5 hrs'`, `'2h'`, `'1m'`, `'5s'`, `'1y'` and `'100'`.

2. **`on`**: An ISO compliant future date. You can pass in a [momentjs][1] date object as well. Some possible values are: `moment().utc().add(30, 'seconds')`, `'2020-05-02 03:23:00'`, `'2020-05-01T21:59:16Z'` etc.

3. **`message`**: The notification payload to be sent/delivered to the receiver, at the scheduled time. Must be a  `string`.

#### Listen for the notification/message to be delivered:

`ossa` delivers the scheduled notification/message by emitting the `notification-received` event. You can listen 

```js
// If you were listening for message/notification delivery in a different file (which in most cases you would be),
// you just have to pass the same `namespace` when instantiating the an Ossa instance. It will return cached
// instance specific to that namespace.

const Ossa = require('ossa');
const ossa = new Ossa({ namespace: "ossa" });

ossa.on('notification-received', async (notificationID, notificationPayload) => {
    // Process the payload received
    console.log("notificationPayload: ", notificationPayload)
    console.table([
        { notificationID, message: notificationPayload.message }
    ]);
});

// Output:
// notificationPayload:  { in: '10s', message: '{"name":"Ben","age":1000}' }
// ┌─────────┬──────────────────────────────────────────────┬─────────────────────────────┐
// │ (index) │                notificationID                │           message           │
// ├─────────┼──────────────────────────────────────────────┼─────────────────────────────┤
// │    0    │ 'ossa::f1799e87-6740-4394-bf5e-d6e55eae3914' │ '{"name":"Ben","age":1000}' │
// └─────────┴──────────────────────────────────────────────┴─────────────────────────────┘
```

#### Get/view the notification scheduled for delivery

You can view the notification/message scheduled for delivery using its `notificationID`. You get the both:
1. `ttl`: Time to live. Time remaining before the notification/message is delivered
2. `notificationPayload`: The actual payload that will be delivered.

```js
const Ossa = require('ossa');
const ossa = new Ossa({ namespace: "ossa" });

const notificationID = "ossa::f1799e87-6740-4394-bf5e-d6e55eae3914";
try {
    const [ttl, notificationPayload] = await ossa.getNotificationByID(notificationID);
    console.log("Message received: ", notificationPayload.message)
} catch (error) {
    throw new Error(error);
}
```

#### Update/Reschedule the notification

```js
const notificationID = "ossa::f1799e87-6740-4394-bf5e-d6e55eae3914";
const notificationPayload = {
    in: '20s',
    message: JSON.stringify({
        name: "Ben S",
        age: 100,
        some: "more"
        and: "some more"
    })
}
try {
    const response = await ossa.updateNotification(notificationID, notificationPayload);
} catch (error) {
    throw new Error(error);
}
```

The `response` will be `1` if the update was successful, `0` if it wasn't.

[1]: https://momentjs.com/docs/#/use-it/node-js/

## License
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fbensooraj%2Fossa.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fbensooraj%2Fossa?ref=badge_large)
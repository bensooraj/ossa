Ossa is a Node.js server-side module (powered by Redis) for creating a basic notification service.

It's API is dead simple. Developers are welcome to test it out in their pet projects!

**Note: This is not production ready.**

Example:

Create the notifier:

```js
const Ossa = require('ossa');
const ossa = Ossa.createNotifier({
    // namespace: "rambo_notifications",
    redis: {
        host: 'localhost',
        port: 6379
    },
    // debug: true
});
```

Send a notification/message:

```js
try {
    const notificationID = await ossa.sendNotification({
        in: '10s',
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

Wait for the notification/message to be delivered:

```js
ossa.on('notification-received', async (notificationID, notificationPayload) => {
    console.log("notificationPayload: ", notificationPayload)
    console.table([
        { notificationID, message: notificationPayload.message }
    ]);
    // Do whatever you want to do with 
});

// Output:
// notificationPayload:  { in: '10s', message: '{"name":"Ben","age":1000}' }
// ┌─────────┬──────────────────────────────────────────────┬─────────────────────────────┐
// │ (index) │                notificationID                │           message           │
// ├─────────┼──────────────────────────────────────────────┼─────────────────────────────┤
// │    0    │ 'ossa::f1799e87-6740-4394-bf5e-d6e55eae3914' │ '{"name":"Ben","age":1000}' │
// └─────────┴──────────────────────────────────────────────┴─────────────────────────────┘
```
const describe = require('mocha').describe;
const chai = require('chai');
const expect = chai.expect;

const Ossa = require('../../lib/ossa');

describe('ossa => Constructor', () => {

    const ossa = Ossa.createNotifier({
        namespace: "rambo_notifications",
        redis: {
            host: 'localhost',
            port: 6379
        }
        // debug: true
    });

    describe('verify that the necesasry options are set', () => {
        console.log("123: ", typeof ossa);
    })
});
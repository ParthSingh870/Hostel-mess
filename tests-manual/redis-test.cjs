require('dotenv').config();

const Redis = require('ioredis');

const redis = new Redis(
    process.env.REDIS_URL || 'redis://localhost:6379'
);

async function testRedis() {
    try {
        console.log('Pinging Redis...');
        console.log(await redis.ping());//test redis connection

        await redis.set('hello', 'world', 'EX', 30);//set world in hello key with expiry of 30 seconds

        console.log('Stored value:', await redis.get('hello'));//print the value of hello key
        console.log('TTL:', await redis.ttl('hello'));//print the time to live of hello key
    } catch (error) {
        console.error('Redis test failed:', error.message);
    } finally {
        redis.disconnect();
    }
}

testRedis();
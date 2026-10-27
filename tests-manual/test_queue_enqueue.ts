// tests-manual/test_queue_enqueue.ts
import { kitchenQueue, enqueueOrder } from '../src/queues/kitchen.queue.js';
import { redisConnection } from '../src/config/redis.js';

async function testQueue() {
    const testOrderId = `order-test-${Date.now()}`;

    try {
        console.log('--- TEST 1: Enqueuing new order ---');
        const job1 = await enqueueOrder(testOrderId);
        console.log(`Job 1 created successfully -> ID: ${job1.id}, Name: ${job1.name}, Data:`, job1.data);

        console.log('\n--- TEST 2: Attempting duplicate enqueue with same orderId ---');
        const job2 = await enqueueOrder(testOrderId);
        console.log(`Job 2 result -> ID: ${job2.id}`);

        if (job1.id === job2.id) {
            console.log('✅ PASS: Deduplication worked! Same jobId returned, no duplicate job created.');
        } else {
            console.log('❌ FAIL: Duplicate job was created.');
        }

        console.log('\n--- Current Kitchen Queue Job Counts ---');
        const counts = await kitchenQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
        console.log(counts);

        // Cleanup the test job
        await job1.remove();
        console.log('\nCleaned up test job from Redis.');
    } catch (err: any) {
        console.error('Queue test error:', err.message);
    } finally {
        await kitchenQueue.close();
        await redisConnection.quit();
        process.exit(0);
    }
}

testQueue();

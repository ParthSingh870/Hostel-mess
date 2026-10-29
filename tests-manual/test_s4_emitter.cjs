// tests-manual/test_s4_emitter.cjs
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

function connectStudent(userId) {
    return new Promise((resolve, reject) => {
        const token = jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

        const req1 = http.get('http://localhost:3000/socket.io/?EIO=4&transport=polling', (res) => {
            let raw = '';
            res.on('data', (c) => (raw += c));
            res.on('end', () => {
                let sid;
                try {
                    sid = JSON.parse(raw.substring(1)).sid;
                } catch (e) {
                    return reject(new Error('Failed to parse handshake response: ' + raw));
                }

                const post = http.request(
                    {
                        hostname: 'localhost',
                        port: 3000,
                        path: `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                    },
                    () => {
                        const client = {
                            userId,
                            sid,
                            receivedEvents: [],
                            pollingActive: true,
                            close: () => {
                                client.pollingActive = false;
                                const closeReq = http.request({
                                    hostname: 'localhost',
                                    port: 3000,
                                    path: `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                                    method: 'POST',
                                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                                });
                                closeReq.write('41');
                                closeReq.end();
                            },
                            poll: function pollNext() {
                                http.get(
                                    `http://localhost:3000/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                                    (pRes) => {
                                        let pData = '';
                                        pRes.on('data', (c) => (pData += c));
                                        pRes.on('end', () => {
                                            if (pData.includes('order:status')) {
                                                client.receivedEvents.push(pData);
                                            }
                                            if (client.pollingActive) pollNext();
                                        });
                                    }
                                );
                            },
                        };

                        client.poll();
                        resolve(client);
                    }
                );
                post.on('error', reject);
                post.write('40' + JSON.stringify({ token }));
                post.end();
            });
        });

        req1.on('error', (e) => {
            reject(new Error(`Cannot connect to server at port 3000 (${e.code || e.message}). Ensure "npm run dev" is running.`));
        });
    });
}

async function run() {
    console.log('[Test S4] Connecting student "student_emitter_test" to Socket.io server...');
    const client = await connectStudent('student_emitter_test');
    console.log(`[Test S4] Client connected with sid: ${client.sid}`);

    // Wait 300ms for room join
    await new Promise((r) => setTimeout(r, 300));

    console.log('\n[Test S4] Publishing via Redis Emitter: order:status for "student_emitter_test"...');
    const { Emitter } = require('@socket.io/redis-emitter');
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const emitter = new Emitter(redis);

    emitter.to('student_emitter_test').emit('order:status', {
        orderId: 'test-order-s4',
        status: 'PREPARING',
    });

    console.log('[Test S4] Publishing via Redis Emitter: order:status for "other_student" (isolation check)...');
    emitter.to('other_student').emit('order:status', {
        orderId: 'other-order-99',
        status: 'READY',
    });

    // Wait 1.5s to capture events
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\n--- VERIFICATION RESULTS ---');
    console.log(`Events received by student_emitter_test: ${client.receivedEvents.length}`);
    if (client.receivedEvents.length > 0) {
        console.log(`Received payload: ${client.receivedEvents[0]}`);
    }

    const correctTargetReceived = client.receivedEvents.some(
        (e) => e.includes('test-order-s4') && e.includes('PREPARING')
    );
    const leakedEvent = client.receivedEvents.some((e) => e.includes('other-order-99'));

    console.log(`Targeted order update received: ${correctTargetReceived ? 'YES (Expected)' : 'NO'}`);
    console.log(`Isolated (no leak from other student): ${!leakedEvent ? 'YES (Expected)' : 'NO (Leaked!)'}`);

    client.close();
    await redis.quit();
    console.log('\n[Test S4] Done.');
    process.exit(0);
}

run().catch((err) => {
    console.error('Error running S4 test:', err.message || err);
    process.exit(1);
});

// tests-manual/test_s3_rooms.cjs
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

// Helper to create a polling Socket.io connection for a given student
function connectStudent(userId) {
    return new Promise((resolve, reject) => {
        const token = jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

        // 1. Engine.io handshake
        http.get('http://localhost:3000/socket.io/?EIO=4&transport=polling', (res) => {
            let raw = '';
            res.on('data', (c) => (raw += c));
            res.on('end', () => {
                const sid = JSON.parse(raw.substring(1)).sid;

                // 2. Socket.io CONNECT packet
                const post = http.request(
                    {
                        hostname: 'localhost',
                        port: 3000,
                        path: `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                    },
                    () => {
                        // 3. Connect listener
                        const client = {
                            userId,
                            sid,
                            receivedMessages: [],
                            close: () => {
                                // Send close packet
                                const closeReq = http.request({
                                    hostname: 'localhost',
                                    port: 3000,
                                    path: `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                                    method: 'POST',
                                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                                });
                                closeReq.write('41'); // 41 = DISCONNECT packet
                                closeReq.end();
                            },
                            poll: function pollNext() {
                                http.get(
                                    `http://localhost:3000/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                                    (pRes) => {
                                        let pData = '';
                                        pRes.on('data', (c) => (pData += c));
                                        pRes.on('end', () => {
                                            if (pData.includes('test:message')) {
                                                client.receivedMessages.push(pData);
                                            }
                                            if (client.pollingActive) pollNext();
                                        });
                                    }
                                );
                            },
                            emit: (targetUserId, message) => {
                                const emitReq = http.request({
                                    hostname: 'localhost',
                                    port: 3000,
                                    path: `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                                    method: 'POST',
                                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                                });
                                // 42 = EVENT packet: 4 (message) + 2 (event) + JSON payload
                                emitReq.write(
                                    '42' +
                                        JSON.stringify([
                                            'test:emit_to_user',
                                            { targetUserId, message },
                                        ])
                                );
                                emitReq.end();
                            },
                        };

                        client.pollingActive = true;
                        client.poll();
                        resolve(client);
                    }
                );
                post.write('40' + JSON.stringify({ token }));
                post.end();
            });
        }).on('error', reject);
    });
}

async function run() {
    console.log('[Test S3] Connecting Student Alpha and Student Beta at the same time...');

    const studentA = await connectStudent('student_alpha');
    console.log(`[Test S3] Student Alpha connected (sid: ${studentA.sid})`);

    const studentB = await connectStudent('student_beta');
    console.log(`[Test S3] Student Beta connected (sid: ${studentB.sid})`);

    console.log('\n[Test S3] Emitting targeted message ONLY to room "student_alpha"...');
    studentA.emit('student_alpha', 'Hello Alpha! Your food is cooking.');

    // Wait 1.5 seconds to receive messages
    await new Promise((r) => setTimeout(r, 1500));

    console.log('\n--- VERIFICATION RESULTS ---');
    console.log(
        `Student Alpha received message: ${
            studentA.receivedMessages.length > 0 ? 'YES (Expected)' : 'NO'
        }`
    );
    console.log(
        `Student Beta received message:  ${
            studentB.receivedMessages.length === 0 ? 'NO (Zero messages, Isolated as Expected)' : 'YES (Leak!)'
        }`
    );

    // Disconnect both
    console.log('\n[Test S3] Disconnecting both students...');
    studentA.pollingActive = false;
    studentB.pollingActive = false;
    studentA.close();
    studentB.close();

    console.log('[Test S3] Done. Check server logs to see room joins and disconnect logs!');
    process.exit(0);
}

run().catch((err) => {
    console.error('Error running S3 test:', err.message);
    process.exit(1);
});

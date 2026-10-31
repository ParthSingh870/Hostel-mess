// tests-manual/test_s2_auth.cjs
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const mode = process.argv[2] || 'missing'; // 'missing' | 'invalid' | 'expired' | 'valid'

let token = null;
if (mode === 'invalid') {
    token = 'invalid_token_123';
} else if (mode === 'expired') {
    token = jwt.sign({ userId: 'expired_user', role: 'STUDENT' }, process.env.JWT_SECRET, {
        expiresIn: '-1s',
    });
} else if (mode === 'valid') {
    token = jwt.sign({ userId: 'student_101', role: 'STUDENT' }, process.env.JWT_SECRET, {
        expiresIn: '15m',
    });
}

console.log(`[Test S2] Connecting to Socket.io with mode: "${mode}"...`);

// 1. Engine.io handshake to obtain session ID (sid)
const req1 = http.get('http://localhost:3000/socket.io/?EIO=4&transport=polling', (res) => {
    let raw = '';
    res.on('data', (chunk) => (raw += chunk));
    res.on('end', () => {
        try {
            const sid = JSON.parse(raw.substring(1)).sid;

            // 2. Send Socket.IO CONNECT packet (40) with auth token payload
            const packet = token ? `40${JSON.stringify({ token })}` : '40';
            const postReq = http.request(
                {
                    hostname: 'localhost',
                    port: 3000,
                    path: `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                },
                () => {
                    // 3. Poll for Socket.io handshake response
                    http.get(
                        `http://localhost:3000/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                        (pollRes) => {
                            let pollData = '';
                            pollRes.on('data', (c) => (pollData += c));
                            pollRes.on('end', () => {
                                if (pollData.startsWith('44')) {
                                    // 44 = Engine.io message (4) + Socket.io connect_error (4)
                                    const err = JSON.parse(pollData.substring(2));
                                    console.log(`[Result] Handshake REJECTED: "${err.message}"`);
                                } else if (pollData.startsWith('40')) {
                                    // 40 = Engine.io message (4) + Socket.io connect_ok (0)
                                    console.log(`[Result] Handshake ACCEPTED! Connected successfully.`);
                                } else {
                                    console.log(`[Result] Server response: ${pollData}`);
                                }
                            });
                        }
                    );
                }
            );

            postReq.on('error', (e) => console.error('POST error:', e.message));
            postReq.write(packet);
            postReq.end();
        } catch (err) {
            console.error('Handshake parse error:', err.message);
        }
    });
});

req1.on('error', (e) => {
    console.error('Connection error: Is server running on port 3000? Details:', e.message);
});

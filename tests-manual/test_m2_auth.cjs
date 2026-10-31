// tests-manual/test_m2_auth.cjs
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'testrefreshsecret';

function attemptConnect(name, token) {
    return new Promise((resolve) => {
        http.get('http://localhost:3000/socket.io/?EIO=4&transport=polling', (res) => {
            let raw = '';
            res.on('data', (c) => (raw += c));
            res.on('end', () => {
                let sid;
                try {
                    sid = JSON.parse(raw.substring(1)).sid;
                } catch (e) {
                    return resolve(`[${name}] Failed: Could not get sid from server`);
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
                        http.get(
                            `http://localhost:3000/socket.io/?EIO=4&transport=polling&sid=${sid}`,
                            (pollRes) => {
                                let pollData = '';
                                pollRes.on('data', (c) => (pollData += c));
                                pollRes.on('end', () => {
                                    if (pollData.startsWith('44')) {
                                        try {
                                            const err = JSON.parse(pollData.substring(2));
                                            resolve(`[${name}] REJECTED -> "${err.message}"`);
                                        } catch (e) {
                                            resolve(`[${name}] REJECTED -> ${pollData}`);
                                        }
                                    } else if (pollData.startsWith('40')) {
                                        resolve(`[${name}] ACCEPTED (Unexpected for invalid auth!)`);
                                    } else {
                                        resolve(`[${name}] Response: ${pollData}`);
                                    }
                                });
                            }
                        );
                    }
                );

                const packet = token ? `40${JSON.stringify({ token })}` : '40';
                post.write(packet);
                post.end();
            });
        }).on('error', (err) => resolve(`[${name}] Error: ${err.message}`));
    });
}

async function runM2() {
    console.log('--- MANUAL TEST M2: NEGATIVE AUTH REJECTION SUITE ---');

    // 1. No token
    const resNoToken = await attemptConnect('1. No Token', null);
    console.log(resNoToken);

    // 2. Garbage token
    const resGarbage = await attemptConnect('2. Garbage Token', 'this_is_total_garbage_jwt_string');
    console.log(resGarbage);

    // 3. Expired token
    const expiredToken = jwt.sign({ userId: 'expired_user', role: 'STUDENT' }, JWT_SECRET, {
        expiresIn: '-10s',
    });
    const resExpired = await attemptConnect('3. Expired Token', expiredToken);
    console.log(resExpired);

    // 4. Refresh token (signed with JWT_REFRESH_SECRET)
    const refreshToken = jwt.sign({ userId: 'refresh_user', role: 'STUDENT' }, JWT_REFRESH_SECRET, {
        expiresIn: '7d',
    });
    const resRefresh = await attemptConnect('4. Refresh Token', refreshToken);
    console.log(resRefresh);

    console.log('--- M2 Finished ---');
}

runM2();

// tests-manual/test_dupe.cjs
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Resolve .env from project root regardless of execution directory
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const PORT = process.env.PORT || 3000;
const url = `http://127.0.0.1:${PORT}/api/auth/register`;

// Generate random unique email and dynamic password
const uniqueId = crypto.randomUUID().slice(0, 8);
const email = `dupe_race_${uniqueId}_${Date.now()}@test.com`;
const password = `TestPass_${crypto.randomUUID()}!`;

const payload = JSON.stringify({
    name: 'Race Tester',
    email,
    password,
});

const headers = { 'Content-Type': 'application/json' };

// Fire two duplicate register requests concurrently
Promise.all([
    fetch(url, { method: 'POST', headers, body: payload }),
    fetch(url, { method: 'POST', headers, body: payload }),
])
    .then(async ([res1, res2]) => {
        const data1 = await res1.json();
        const data2 = await res2.json();

        console.log('Response 1 -> Status:', res1.status, '| Message:', data1.message || data1.error);
        console.log('Response 2 -> Status:', res2.status, '| Message:', data2.message || data2.error);
    })
    .catch((err) => {
        console.error('Network Error:', err.message);
    });

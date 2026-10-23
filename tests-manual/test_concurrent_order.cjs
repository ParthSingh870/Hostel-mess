// tests-manual/test_concurrent_order.cjs
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Resolve .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ITEM_ID = process.env.TEST_ITEM_ID || '22222222-2222-2222-2222-222222222222';

async function runTest() {
    const uniqueId = crypto.randomUUID().slice(0, 8);
    const email = `student_race_${uniqueId}_${Date.now()}@test.com`;
    const password = `TestPass_${crypto.randomUUID()}!`;

    // 1. Register student
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Race Student', email, password }),
    });
    const regData = await regRes.json();
    console.log('Register Status:', regRes.status, '| Message:', regData.message || regData.error);

    // 2. Login student
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const loginData = await loginRes.json();
    console.log('Login Status:', loginRes.status, '| Message:', loginData.message || loginData.error);

    if (!loginData.data || !loginData.data.accessToken) {
        console.error('ERROR: Login did not return access token. Aborting.');
        return;
    }

    const token = loginData.data.accessToken;

    // 3. Prepare order payload
    const orderPayload = JSON.stringify({
        items: [{ menuItemId: ITEM_ID, quantity: 1 }],
    });

    const orderHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };

    console.log('\nFiring 2 simultaneous orders for stock = 1...');

    // 4. Concurrency: Fire both orders simultaneously
    const [res1, res2] = await Promise.all([
        fetch(`${BASE_URL}/api/orders`, { method: 'POST', headers: orderHeaders, body: orderPayload }),
        fetch(`${BASE_URL}/api/orders`, { method: 'POST', headers: orderHeaders, body: orderPayload }),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    console.log('\nOrder 1 -> Status:', res1.status, '| Message:', data1.message || data1.error);
    console.log('Order 2 -> Status:', res2.status, '| Message:', data2.message || data2.error);
}

runTest().catch((err) => console.error('Execution Error:', err.message));

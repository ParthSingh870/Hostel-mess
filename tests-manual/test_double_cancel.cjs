// tests-manual/test_double_cancel.cjs
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Resolve .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ITEM_ID = process.env.TEST_PANEER_ID || '33333333-3333-3333-3333-333333333333';

const STAFF_EMAIL = process.env.TEST_STAFF_EMAIL || 'staff_rule@test.com';
const STAFF_PASSWORD = process.env.TEST_STAFF_PASSWORD || 'password123';

async function runTest() {
    const timestamp = Date.now();
    const uniqueId = crypto.randomUUID().slice(0, 8);

    // 1. Staff user register if not exists
    await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Staff User', email: STAFF_EMAIL, password: STAFF_PASSWORD }),
    });

    // 2. Login as Staff
    const staffLoginRes = await (
        await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: STAFF_EMAIL, password: STAFF_PASSWORD }),
        })
    ).json();

    if (!staffLoginRes.data) {
        console.error('ERROR: Staff login failed. Ensure staff user exists with proper credentials.');
        return;
    }

    if (staffLoginRes.data.user.role !== 'STAFF' && staffLoginRes.data.user.role !== 'ADMIN') {
        console.log('\n======================================================');
        console.log(`User "${STAFF_EMAIL}" exists but has role STUDENT.`);
        console.log('Please promote in Neon SQL:');
        console.log(`UPDATE "User" SET role = 'STAFF' WHERE email = '${STAFF_EMAIL}';`);
        console.log('======================================================\n');
        return;
    }

    const staffToken = staffLoginRes.data.accessToken;

    // 3. Register & login fresh student with dynamic random credentials
    const studentEmail = `student_cancel_${uniqueId}_${timestamp}@test.com`;
    const studentPassword = `Pass_${crypto.randomUUID()}!`;

    await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Student Cancel', email: studentEmail, password: studentPassword }),
    });

    const sLogin = await (
        await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: studentEmail, password: studentPassword }),
        })
    ).json();

    if (!sLogin.data || !sLogin.data.accessToken) {
        console.error('ERROR: Student login failed. Aborting.');
        return;
    }

    const studentToken = sLogin.data.accessToken;

    // 4. Student places order for 2 quantity
    const orderRes = await (
        await fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({ items: [{ menuItemId: ITEM_ID, quantity: 2 }] }),
        })
    ).json();

    if (!orderRes.data) {
        console.error('ERROR: Order placement failed:', orderRes.message || orderRes.error);
        return;
    }

    const orderId = orderRes.data.id;
    console.log(`Order placed successfully (ID: ${orderId}).`);
    console.log('Firing 2 SIMULTANEOUS CANCEL requests from STAFF...\n');

    const cancelHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staffToken}`,
    };
    const cancelPayload = JSON.stringify({ status: 'CANCELLED' });

    // 5. Concurrency: Fire both cancel requests simultaneously
    const [res1, res2] = await Promise.all([
        fetch(`${BASE_URL}/api/orders/${orderId}/status`, { method: 'PATCH', headers: cancelHeaders, body: cancelPayload }),
        fetch(`${BASE_URL}/api/orders/${orderId}/status`, { method: 'PATCH', headers: cancelHeaders, body: cancelPayload }),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    console.log('Cancel Request 1 -> Status:', res1.status, '| Message:', data1.message || data1.error);
    console.log('Cancel Request 2 -> Status:', res2.status, '| Message:', data2.message || data2.error);
}

runTest().catch((err) => console.error('Execution Error:', err.message));

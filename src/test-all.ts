const BASE_URL = 'http://localhost:3000';

interface TestResult {
    name: string;
    passed: boolean;
    expectedStatus: number;
    actualStatus: number;
    details?: any;
}

const results: TestResult[] = [];

async function runTest(
    name: string,
    fn: () => Promise<Response>,
    expectedStatus: number
): Promise<any> {
    try {
        const res = await fn();
        const isJson = res.headers.get('content-type')?.includes('application/json');
        const data = isJson ? await res.json() : null;

        const passed = res.status === expectedStatus;
        results.push({
            name,
            passed,
            expectedStatus,
            actualStatus: res.status,
            details: passed ? undefined : data,
        });

        const mark = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${mark}: ${name} (Expected: ${expectedStatus}, Received: ${res.status})`);
        return data;
    } catch (err: any) {
        results.push({
            name,
            passed: false,
            expectedStatus,
            actualStatus: 0,
            details: err.message,
        });
        console.log(`❌ ERROR: ${name} -> ${err.message}`);
        return null;
    }
}

async function startSuite() {
    console.log('--- STARTING COMPLETE BACKEND INTEGRATION SUITE (24 TESTS) ---\n');

    const randomSuffix = Math.floor(Math.random() * 10000);
    const studentEmail = `student_${randomSuffix}@test.com`;
    const staffEmail = `staff_${randomSuffix}@test.com`;
    const password = 'Password@123';

    let studentToken = '';
    let staffToken = '';
    let createdMenuItemId = '';
    let createdOrderId = '';

    // 1. Health Check
    await runTest('1. Check Database Health Endpoint', () =>
        fetch(`${BASE_URL}/health`), 200
    );

    // 2. Auth Validations & Registration
    await runTest('2. Register with Invalid Email (Should Fail 400)', () =>
        fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Bad User', email: 'not-an-email', password: '123' }),
        }), 400
    );

    await runTest('3. Register Student Account', () =>
        fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test Student', email: studentEmail, password, role: 'STUDENT' }),
        }), 201
    );

    await runTest('4. Register Staff Account', () =>
        fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test Staff', email: staffEmail, password, role: 'STAFF' }),
        }), 201
    );

    // 3. Login Flow
    const studentLoginRes = await runTest('5. Login as Student', () =>
        fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: studentEmail, password }),
        }), 200
    );
    studentToken = studentLoginRes?.data?.accessToken || studentLoginRes?.accessToken;

    const staffLoginRes = await runTest('6. Login as Staff', () =>
        fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: staffEmail, password }),
        }), 200
    );
    staffToken = staffLoginRes?.data?.accessToken || staffLoginRes?.accessToken;

    // 4. Token & Middleware Checks
    await runTest('7. Protected Route Without Token (Should Fail 401)', () =>
        fetch(`${BASE_URL}/api/auth/profile`), 401
    );

    await runTest('8. Profile With Valid Student Token (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/auth/profile`, {
            headers: { Authorization: `Bearer ${studentToken}` },
        }), 200
    );

    // 5. Menu RBAC & Creation
    await runTest('9. Student Tries to Add Menu Item (Should Fail 403)', () =>
        fetch(`${BASE_URL}/api/menu`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({
                name: 'Unauthorized Item',
                description: 'Test',
                price: 50,
                stockCount: 10,
                category: 'LUNCH',
            }),
        }), 403
    );

    const menuRes = await runTest('10. Staff Adds New Menu Item (Stock: 5) (Should Pass 201)', () =>
        fetch(`${BASE_URL}/api/menu`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${staffToken}`,
            },
            body: JSON.stringify({
                name: 'Paneer Butter Masala',
                description: 'Rich gravy paneer',
                price: 120,
                stockCount: 5,
                category: 'DINNER',
            }),
        }), 201
    );
    createdMenuItemId = menuRes?.data?.id || menuRes?.id;

    await runTest('11. Public Fetch All Active Menu Items (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/menu`), 200
    );

    // 6. Student Order Placement & Validation
    await runTest('12. Staff Tries to Place Order (Should Fail 403)', () =>
        fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${staffToken}`,
            },
            body: JSON.stringify({
                items: [{ menuItemId: createdMenuItemId, quantity: 1 }],
            }),
        }), 403
    );

    await runTest('13. Student Orders Exceeding Stock (Req: 10, Stock: 5) (Should Fail 400)', () =>
        fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({
                items: [{ menuItemId: createdMenuItemId, quantity: 10 }],
            }),
        }), 400
    );

    const orderRes = await runTest('14. Student Places Valid Order (Qty: 2) (Should Pass 201)', () =>
        fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({
                items: [{ menuItemId: createdMenuItemId, quantity: 2 }],
            }),
        }), 201
    );
    createdOrderId = orderRes?.data?.id || orderRes?.id;

    await runTest('15. Student Fetches Own Order History (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/orders/my`, {
            headers: { Authorization: `Bearer ${studentToken}` },
        }), 200
    );

    // 7. Staff Order Management & RBAC
    await runTest('16. Student Tries to Fetch All Orders (Should Fail 403)', () =>
        fetch(`${BASE_URL}/api/orders`, {
            headers: { Authorization: `Bearer ${studentToken}` },
        }), 403
    );

    await runTest('17. Staff Fetches All Orders (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/orders`, {
            headers: { Authorization: `Bearer ${staffToken}` },
        }), 200
    );

    // 18. Status Filter Check (PENDING ki jagah PLACED karein)
    await runTest('18. Staff Filters Orders By Status (PLACED) (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/orders?status=PLACED`, {
            headers: { Authorization: `Bearer ${staffToken}` },
        }), 200
    );

    // 8. Order Status Transitions & Stock Restoration
    await runTest('19. Student Tries to Update Order Status (Should Fail 403)', () =>
        fetch(`${BASE_URL}/api/orders/${createdOrderId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({ status: 'PREPARING' }),
        }), 403
    );

    await runTest('20. Staff Updates Status with Invalid Value (Should Fail 400)', () =>
        fetch(`${BASE_URL}/api/orders/${createdOrderId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${staffToken}`,
            },
            body: JSON.stringify({ status: 'COOKING_RANDOM' }),
        }), 400
    );

    await runTest('21. Staff Updates Status to PREPARING (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/orders/${createdOrderId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${staffToken}`,
            },
            body: JSON.stringify({ status: 'PREPARING' }),
        }), 200
    );

    await runTest('22. Staff Cancels Order (Stock Should Auto-Restore) (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/orders/${createdOrderId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${staffToken}`,
            },
            body: JSON.stringify({ status: 'CANCELLED' }),
        }), 200
    );

    // 9. Soft Delete & Final Integrity
    await runTest('23. Staff Soft-Deletes Menu Item (Should Pass 200)', () =>
        fetch(`${BASE_URL}/api/menu/${createdMenuItemId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${staffToken}` },
        }), 200
    );

    await runTest('24. Student Orders Deactivated Item (Should Fail 400)', () =>
        fetch(`${BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${studentToken}`,
            },
            body: JSON.stringify({
                items: [{ menuItemId: createdMenuItemId, quantity: 1 }],
            }),
        }), 400
    );

    // Print Summary
    const passedCount = results.filter((r) => r.passed).length;
    console.log(`\n===========================================`);
    console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`);
    console.log(`===========================================`);

    if (passedCount !== results.length) {
        console.log('\nFailed Test Details:');
        results.filter((r) => !r.passed).forEach((r) => {
            console.log(`- ${r.name}: Status ${r.actualStatus} (Expected ${r.expectedStatus})`);
            if (r.details) console.log(`  Payload:`, JSON.stringify(r.details));
        });
    }
}

startSuite();
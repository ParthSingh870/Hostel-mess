// tests-manual/test_s5_lifecycle.ts
import 'dotenv/config';
import http from 'http';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/prisma.js';
import { createOrder, updateOrderStatus } from '../src/services/order.service.js';
import { OrderStatus } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'testsecret';

function connectStudent(userId: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const token = jwt.sign({ userId, role: 'STUDENT' }, JWT_SECRET, { expiresIn: '15m' });

        const req = http.get('http://localhost:3000/socket.io/?EIO=4&transport=polling', (res) => {
            let raw = '';
            res.on('data', (c) => (raw += c));
            res.on('end', () => {
                const sid = JSON.parse(raw.substring(1)).sid;

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
                            receivedEvents: [] as any[],
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
                                                // Extract payload
                                                try {
                                                    const jsonStr = pData.substring(pData.indexOf('['));
                                                    const parsed = JSON.parse(jsonStr);
                                                    client.receivedEvents.push(parsed[1]);
                                                } catch (e) {
                                                    client.receivedEvents.push(pData);
                                                }
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
                post.write('40' + JSON.stringify({ token }));
                post.end();
            });
        });
        req.on('error', (e: any) =>
            reject(new Error(`Server unreachable at port 3000 (${e.code || e.message})`))
        );
    });
}

async function run() {
    console.log('--- SLICE S5 MANUAL TEST: Real-Time Order Lifecycle Events ---');

    // 1. Ensure test student and test menu item exist
    let student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
    if (!student) {
        student = await prisma.user.create({
            data: {
                name: 'Test Student S5',
                email: `student_s5_${Date.now()}@test.com`,
                password: 'hash',
                role: 'STUDENT',
            },
        });
    }

    let menuItem = await prisma.menuItem.findFirst({
        where: { isAvailable: true, stockCount: { gte: 10 } },
    });
    if (!menuItem) {
        menuItem = await prisma.menuItem.create({
            data: {
                name: 'S5 Special Thali',
                price: 80,
                stockCount: 50,
                isAvailable: true,
                category: 'LUNCH',
            },
        });
    }

    console.log(`[Test S5] Using Student ID: ${student.id}`);
    console.log(`[Test S5] Using Menu Item: ${menuItem.name} (Stock: ${menuItem.stockCount})`);

    // 2. Connect student via Socket.io
    console.log('[Test S5] Connecting student socket to server...');
    const client = await connectStudent(student.id);
    console.log(`[Test S5] Socket connected and joined room: "${student.id}"`);
    await new Promise((r) => setTimeout(r, 400));

    // 3. Place order via createOrder service (triggers PLACED emit)
    console.log('\n[Test S5] Placing order (createOrder)...');
    const order = await createOrder(student.id, {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
    });
    console.log(`[Test S5] Order created with ID: ${order.id}`);

    // Wait 1.5s for PLACED event
    await new Promise((r) => setTimeout(r, 1500));

    // 4. Update status via updateOrderStatus service (triggers CANCELLED emit)
    console.log('\n[Test S5] Updating order status to CANCELLED (updateOrderStatus)...');
    await updateOrderStatus(order.id, OrderStatus.CANCELLED);
    console.log(`[Test S5] Order status updated in database.`);

    // Wait 1.5s for CANCELLED event
    await new Promise((r) => setTimeout(r, 1500));

    // 5. Verification
    console.log('\n--- VERIFICATION RESULTS ---');
    console.log(`Total events captured by student: ${client.receivedEvents.length}`);
    client.receivedEvents.forEach((ev: any, idx: number) => {
        console.log(`  Event ${idx + 1}:`, JSON.stringify(ev));
    });

    const hasPlaced = client.receivedEvents.some(
        (e: any) => e.orderId === order.id && e.status === 'PLACED'
    );
    const hasCancelled = client.receivedEvents.some(
        (e: any) => e.orderId === order.id && e.status === 'CANCELLED'
    );

    console.log(`PLACED event received:    ${hasPlaced ? 'YES (Expected)' : 'NO'}`);
    console.log(`CANCELLED event received: ${hasCancelled ? 'YES (Expected)' : 'NO'}`);

    client.close();
    await prisma.$disconnect();
    console.log('\n[Test S5] Test completed successfully.');
    process.exit(0);
}

run().catch((err) => {
    console.error('Error running S5 test:', err.message);
    process.exit(1);
});

import 'dotenv/config';
import express from 'express';
import prisma from './config/prisma.js';
import authRoutes from './routes/auth.routes.js';
import menuRoutes from './routes/menu.routes.js';
import orderRoutes from './routes/order.routes.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';

if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET || !process.env.REDIS_URL) {
    console.error('FATAL: JWT_SECRET, JWT_REFRESH_SECRET, and REDIS_URL must be defined in environment variables.');
    process.exit(1);
}

const app = express();

app.use(express.json());

// Health Check
app.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'ok', message: 'Server and Neon DB are healthy' });
    } catch (error: any) {
        res.status(500).json({
            status: 'error',
            message: 'Database connection failed',
            details: error.message,
        });
    }
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);

// 404 handler for unknown routes (registered after all routes, before error middleware)
app.use(notFoundHandler);

// Centralized global error middleware (registered last)
app.use(errorHandler);

export default app;

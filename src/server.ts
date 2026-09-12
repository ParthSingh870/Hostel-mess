import 'dotenv/config';
import express from 'express';
import prisma from './config/prisma.js';
import authRoutes from './routes/auth.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

// Authentication routes
app.use('/api/auth', authRoutes);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
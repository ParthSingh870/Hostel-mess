import 'dotenv/config';
import express from 'express';
import prisma from './config/prisma.js';
import authRoutes from './routes/auth.routes.js';
import menuRoutes from './routes/menu.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Authentication routes
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
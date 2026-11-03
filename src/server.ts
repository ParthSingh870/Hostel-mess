import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { initSocketServer, io } from './realtime/socket.js';
import prisma from './config/prisma.js';
import { redisConnection } from './config/redis.js';

const PORT = process.env.PORT || 3000;

// Create standard Node HTTP server wrapping Express
const server = http.createServer(app);

// Attach Socket.io to the HTTP server
initSocketServer(server);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown handler for SIGTERM (Docker container stop) and SIGINT (Ctrl+C)
const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down HTTP & Socket.io server gracefully...`);
    server.close(async () => {
        try {
            if (io) {
                await io.close();
            }
            await redisConnection.quit();
            await prisma.$disconnect();
            console.log('[Server] Closed all connections cleanly. Exiting.');
            process.exit(0);
        } catch (err: any) {
            console.error('[Server] Error during graceful shutdown:', err.message);
            process.exit(1);
        }
    });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

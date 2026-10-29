import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { redisConnection } from '../config/redis.js';

export interface SocketUserData {
    userId: string;
    role: string;
}

export let io: SocketIOServer | null = null;

/**
 * Initializes and attaches Socket.io to the existing HTTP server instance.
 */
export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
    io = new SocketIOServer(httpServer, {
        cors: {
            // Read allowed CORS origin from environment or default to '*'
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST'],
        },
    });

    // S4: Redis Adapter using separate pub/sub connections via duplicate()
    // Explicitly enableOfflineQueue: true so psubscribe buffering succeeds during initial connection
    const pubClient = redisConnection.duplicate({ enableOfflineQueue: true });
    const subClient = redisConnection.duplicate({ enableOfflineQueue: true });

    pubClient.on('error', (err) => console.error('[Socket.io Redis Pub Error]:', err.message));
    subClient.on('error', (err) => console.error('[Socket.io Redis Sub Error]:', err.message));

    io.adapter(createAdapter(pubClient, subClient));

    // S2: Handshake JWT Authentication Middleware
    io.use((socket, next) => {
        // Extract token from handshake auth object (primary), or fallback to headers/query
        const token =
            socket.handshake.auth?.token ||
            (typeof socket.handshake.query?.token === 'string'
                ? socket.handshake.query.token
                : undefined) ||
            socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

        if (!token) {
            return next(new Error('Authentication error: Token missing'));
        }

        try {
            // Re-use same JWT verify logic and secret as REST auth middleware
            const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
                userId: string;
                role: string;
            };

            // Store verified identity in socket.data (userId strictly from verified token)
            socket.data.user = {
                userId: decoded.userId,
                role: decoded.role,
            };

            next();
        } catch (err: any) {
            if (err.name === 'TokenExpiredError') {
                return next(new Error('Authentication error: Token expired'));
            }
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    // Connection handler
    io.on('connection', async (socket) => {
        const user = socket.data.user as SocketUserData;
        console.log(
            `[Socket.io] Client connected: ${socket.id} (User: ${user?.userId}, Role: ${user?.role})`
        );

        // S3: Automatically join private room named strictly after userId
        if (user?.userId) {
            await socket.join(user.userId);
            console.log(`[Socket.io] Socket ${socket.id} joined private room: "${user.userId}"`);
        }

        // Test helper: Allows testing targeted room emits between students
        socket.on('test:emit_to_user', ({ targetUserId, message }) => {
            io?.to(targetUserId).emit('test:message', {
                from: user.userId,
                targetUserId,
                message,
            });
        });

        // S3: Disconnect logging with socket ID, verified user ID, and reason
        socket.on('disconnect', (reason) => {
            console.log(
                `[Socket.io] Client disconnected (${socket.id}, User: ${user?.userId}): ${reason}`
            );
        });
    });

    return io;
};

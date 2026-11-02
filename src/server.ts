import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { initSocketServer } from './realtime/socket.js';

const PORT = process.env.PORT || 3000;

// Create standard Node HTTP server wrapping Express
const server = http.createServer(app);

// Attach Socket.io to the HTTP server
initSocketServer(server);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

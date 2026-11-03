import 'dotenv/config';
import dns from 'dns';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const connectionString = process.env.DATABASE_URL || '';
const isNeon = connectionString.includes('neon.tech');

let prisma: PrismaClient;

if (isNeon) {
    // Resilient DNS resolution fallback for environments where ISP router DNS refuses *.neon.tech
    const fallbackResolver = new dns.Resolver();
    fallbackResolver.setServers(['8.8.8.8', '1.1.1.1']);

    const originalLookup = dns.lookup;
    (dns as any).lookup = (hostname: string, options: any, callback: any) => {
        let cb = callback;
        let opts = options;
        if (typeof opts === 'function') {
            cb = opts;
            opts = {};
        }

        originalLookup(hostname, opts, (err, address, family) => {
            if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
                fallbackResolver.resolve4(hostname, (fallbackErr, addresses) => {
                    if (!fallbackErr && addresses && addresses.length > 0) {
                        if (opts && opts.all) {
                            return cb(null, addresses.map((addr) => ({ address: addr, family: 4 })));
                        }
                        return cb(null, addresses[0], 4);
                    }
                    return cb(err);
                });
            } else {
                cb(err, address, family);
            }
        });
    };

    // Route database queries over standard HTTPS/WebSocket port 443
    neonConfig.webSocketConstructor = ws;

    const pool = new Pool({ connectionString });
    const adapter = new PrismaNeon(pool as any);

    prisma = new PrismaClient({ adapter } as any);
} else {
    // Standard local/Docker PostgreSQL (native TCP port 5432)
    prisma = new PrismaClient({
        datasources: {
            db: {
                url: connectionString,
            },
        },
    });
}

export default prisma;

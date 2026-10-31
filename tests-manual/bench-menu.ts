// tests-manual/bench-menu.ts
import 'dotenv/config';
import { del, MENU_CACHE_KEY, closeCacheConnection, cacheRedisClient } from '../src/cache/cache.js';

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const N = 30;

function calculateStats(latencies: number[]) {
    if (latencies.length === 0) return { min: 0, median: 0, p95: 0, avg: 0 };
    const sorted = [...latencies].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = sorted.reduce((sum, val) => sum + val, 0) / sorted.length;
    
    // Median calculation
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 
        ? sorted[mid] 
        : (sorted[mid - 1] + sorted[mid]) / 2;

    // 95th Percentile calculation
    const p95Index = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
    const p95 = sorted[p95Index];

    return {
        min: Number(min.toFixed(2)),
        median: Number(median.toFixed(2)),
        p95: Number(p95.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        max: Number(max.toFixed(2)),
    };
}

async function runBenchmark() {
    const isRedisDownMode = process.argv.includes('--redis-down');

    console.log('================================================================');
    console.log(`        MENU ENDPOINT LATENCY BENCHMARK (N=${N} requests)        `);
    if (isRedisDownMode) {
        console.log('        MODE: REDIS STOPPED (FAIL-OPEN / POSTGRES DIRECT)       ');
    } else {
        console.log('        MODE: STANDARD (CACHE MISS vs CACHE HIT)                ');
    }
    console.log('================================================================\n');

    // Health check
    try {
        const health = await fetch(`${BASE_URL}/health`);
        if (!health.ok) {
            console.error('[ERROR] Server health check failed on port', PORT);
            process.exit(1);
        }
    } catch (e: any) {
        console.error(`[ERROR] Server not reachable on ${BASE_URL}: ${e.message}`);
        console.error('Please make sure "npm run dev" is running in your terminal.');
        process.exit(1);
    }

    if (isRedisDownMode) {
        // Benchmark with Redis stopped
        console.log(`Sending ${N} requests with Redis stopped (measuring DB-only fallback latency)...`);
        const downLatencies: number[] = [];

        for (let i = 1; i <= N; i++) {
            const start = performance.now();
            const res = await fetch(`${BASE_URL}/api/menu`);
            const duration = performance.now() - start;
            downLatencies.push(duration);
            process.stdout.write(`\rProgress: [${i}/${N}] Last request: ${duration.toFixed(2)}ms`);
        }
        console.log('\n');

        const downStats = calculateStats(downLatencies);
        console.log('----------------------------------------------------------------');
        console.log('REDIS STOPPED (FAIL-OPEN / DB ONLY) RESULTS:');
        console.log('----------------------------------------------------------------');
        console.log(`Min:     ${downStats.min} ms`);
        console.log(`Median:  ${downStats.median} ms`);
        console.log(`p95:     ${downStats.p95} ms`);
        console.log(`Average: ${downStats.avg} ms`);
        console.log('----------------------------------------------------------------\n');
        process.exit(0);
    }

    // 1. Benchmark Cache MISS (N=30)
    console.log(`[Phase 1] Running N=${N} Cache MISS benchmark (del "${MENU_CACHE_KEY}" before each call)...`);
    const missLatencies: number[] = [];

    for (let i = 1; i <= N; i++) {
        await del(MENU_CACHE_KEY); // Guarantee MISS
        const start = performance.now();
        const res = await fetch(`${BASE_URL}/api/menu`);
        const duration = performance.now() - start;
        const cacheHeader = res.headers.get('x-cache');
        if (cacheHeader !== 'MISS') {
            console.warn(`\n[Warning] Request ${i} got unexpected header: ${cacheHeader}`);
        }
        missLatencies.push(duration);
        process.stdout.write(`\rProgress: [${i}/${N}] Miss latency: ${duration.toFixed(2)}ms`);
    }
    console.log('\n');

    // 2. Prime cache for Cache HIT
    console.log(`[Phase 2] Priming cache with one initial request...`);
    await fetch(`${BASE_URL}/api/menu`);

    // 3. Benchmark Cache HIT (N=30)
    console.log(`[Phase 3] Running N=${N} Cache HIT benchmark...`);
    const hitLatencies: number[] = [];

    for (let i = 1; i <= N; i++) {
        const start = performance.now();
        const res = await fetch(`${BASE_URL}/api/menu`);
        const duration = performance.now() - start;
        const cacheHeader = res.headers.get('x-cache');
        if (cacheHeader !== 'HIT') {
            console.warn(`\n[Warning] Request ${i} got unexpected header: ${cacheHeader}`);
        }
        hitLatencies.push(duration);
        process.stdout.write(`\rProgress: [${i}/${N}] Hit latency: ${duration.toFixed(2)}ms`);
    }
    console.log('\n');

    // Calculate metrics
    const missStats = calculateStats(missLatencies);
    const hitStats = calculateStats(hitLatencies);

    console.log('================================================================');
    console.log('                       RAW BENCHMARK RESULTS                    ');
    console.log('================================================================');
    console.log(`Metric   | Cache MISS (Postgres DB) | Cache HIT (Redis RAM) | Speedup`);
    console.log(`---------|--------------------------|-----------------------|--------`);
    console.log(`Min      | ${String(missStats.min + ' ms').padEnd(24)} | ${String(hitStats.min + ' ms').padEnd(21)} | ${(missStats.min / Math.max(hitStats.min, 0.01)).toFixed(1)}x`);
    console.log(`Median   | ${String(missStats.median + ' ms').padEnd(24)} | ${String(hitStats.median + ' ms').padEnd(21)} | ${(missStats.median / Math.max(hitStats.median, 0.01)).toFixed(1)}x`);
    console.log(`p95      | ${String(missStats.p95 + ' ms').padEnd(24)} | ${String(hitStats.p95 + ' ms').padEnd(21)} | ${(missStats.p95 / Math.max(hitStats.p95, 0.01)).toFixed(1)}x`);
    console.log(`Average  | ${String(missStats.avg + ' ms').padEnd(24)} | ${String(hitStats.avg + ' ms').padEnd(21)} | ${(missStats.avg / Math.max(hitStats.avg, 0.01)).toFixed(1)}x`);
    console.log('================================================================\n');

    console.log('Next step: Stop Redis with "docker stop hostel-redis" and run:');
    console.log('npm run bench:menu:down\n');

    await closeCacheConnection();
    process.exit(0);
}

runBenchmark().catch((err) => {
    console.error('Benchmark Error:', err);
    process.exit(1);
});

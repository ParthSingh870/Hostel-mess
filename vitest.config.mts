import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
        fileParallelism: false, // Run DB-touching test files serially
        testTimeout: 30000,     // 30s generous timeout for Neon cloud DB roundtrips
        hookTimeout: 30000,
        include: ['tests/**/*.test.ts'],
    },
});

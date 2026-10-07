// Must be imported before any src module: src/config/env.ts validates on load.
process.env.NODE_ENV ??= 'test';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.DATABASE_URL ??= 'mysql://test:test@localhost:3306/test';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

import 'dotenv/config';

// Tests always run against the dedicated test database, never the dev/prod one.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL must be set to run the tests');
if (!/_test(\?|$)/.test(testUrl)) throw new Error('TEST_DATABASE_URL must point at a database whose name ends with "_test"');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.AUTH_PROVIDER = 'dev';

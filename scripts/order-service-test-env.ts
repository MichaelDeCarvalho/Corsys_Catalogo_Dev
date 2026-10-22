// This suite checks preflight failures, never a remote Supabase environment.
// Configure a deliberately unavailable loopback endpoint before importing the client.
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'local-preflight-test-key';

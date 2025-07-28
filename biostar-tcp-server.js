// server.js
import net from 'net';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const BIOSTAR_URL = 'http://cgk1.clusters.zeabur.com:30112';
const BIOSTAR_ADMIN = 'admin';
const BIOSTAR_PASSWORD = 'Spartagym!';
const TCP_PORT = 51212;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

let bsSession = null;
let lastUserId = null;

// Auth with BioStar 2
async function bsLogin() {
  const res = await fetch(`${BIOSTAR_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      User: { login_id: BIOSTAR_ADMIN, password: BIOSTAR_PASSWORD },
    }),
  });
  bsSession = res.headers.get('bs-session-id');
  if (!bsSession) throw new Error('BioStar login failed');
}

// Create new user in BioStar
async function createUser(name, userId) {
  const res = await fetch(`${BIOSTAR_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({ User: { name, user_id: userId } }),
  });
  const { User } = await res.json();
  return User.id;
}

// Trigger device fingerprint scan
async function scanFingerprint(deviceId, enrollQuality = 80) {
  const res = await fetch(`${BIOSTAR_URL}/api/devices/${deviceId}/scan_fingerprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({ enroll_quality: enrollQuality, raw_image: false }),
  });
  return await res.json();
}

// Verify duplicate
async function identify(template0) {
  const res = await fetch(`${BIOSTAR_URL}/api/server_matching/identify_finger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({ template: template0 }),
  });
  return res.ok;
}

// Finalize enrollment — attach templates to user
async function commitFingerprintToUser(userDbId, template0, template1) {
  await fetch(`${BIOSTAR_URL}/api/users/${userDbId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({
      fingerprint_templates: [{ template0, template1, isNew: true }],
    }),
  });
}

// Store log in Supabase
async function storeEvent(userId, template0) {
  await supabase.from('fingerprint_logs').insert([
    { user_id: userId, template: template0, created_at: new Date().toISOString() },
  ]);
}

// Parse and handle device TCP messages
async function handleTcpMessage(hex, deviceId) {
  console.log('RAW HEX:', hex);

  // Example trigger condition: custom byte pattern
  if (hex.includes('feedcafedeadbeef')) {
    await bsLogin();

    const bioUserId = await createUser('Gym Member', `member-${Date.now()}`);
    lastUserId = bioUserId;

    const scan1 = await scanFingerprint(deviceId);
    const t0 = scan1.data?.template0;

    const scan2 = await scanFingerprint(deviceId);
    const t1 = scan2.data?.template0;

    if (t0 && t1 && !(await identify(t0))) {
      await commitFingerprintToUser(bioUserId, t0, t1);
      console.log('✅ Fingerprint enrolled for user:', bioUserId);

      await storeEvent(bioUserId, t0);
    } else {
      console.warn('⚠ Duplicate or failed scan');
    }
  }
}

// Start TCP listener
const server = net.createServer((socket) => {
  console.log('Device connected:', socket.remoteAddress);

  socket.on('data', async (data) => {
    const hex = data.toString('hex');
    try {
      await handleTcpMessage(hex, /* your deviceId */ 123);
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });
});

server.listen(TCP_PORT, () =>
  console.log(`TCP server listening on ${TCP_PORT}`)
);

// Graceful shutdown
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

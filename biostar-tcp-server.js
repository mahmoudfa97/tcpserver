import net from 'net';
import express from 'express';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(express.json());

// Supabase setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// BioStar API
const BIOSTAR_URL = 'http://cgk1.clusters.zeabur.com:30112';
const BIOSTAR_ADMIN = 'admin';
const BIOSTAR_PASSWORD = 'Spartagym1';

let bsSession = null;
let lastUserId = null;

// TCP Port
const TCP_PORT = 51212;

// HTTP Port
const HTTP_PORT = 3000;

// =================== BioStar Utility Functions ===================

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

async function createUser(name, userId) {
  const res = await fetch(`${BIOSTAR_URL}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({ User: { name, user_id: userId } }),
  });
  const { User } = await res.json();
  return User.id;
}

async function scanFingerprint(deviceId, enrollQuality = 80) {
  const res = await fetch(`${BIOSTAR_URL}/api/devices/${deviceId}/scan_fingerprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({ enroll_quality: enrollQuality, raw_image: false }),
  });
  return await res.json();
}

async function identify(template0) {
  const res = await fetch(`${BIOSTAR_URL}/api/server_matching/identify_finger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({ template: template0 }),
  });
  return res.ok;
}

async function commitFingerprintToUser(userDbId, template0, template1) {
  await fetch(`${BIOSTAR_URL}/api/users/${userDbId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'bs-session-id': bsSession },
    body: JSON.stringify({
      fingerprint_templates: [{ template0, template1, isNew: true }],
    }),
  });
}

async function storeEvent(userId, template0) {
  await supabase.from('fingerprint_logs').insert([
    { user_id: userId, template: template0, created_at: new Date().toISOString() },
  ]);
}

// =================== TCP SERVER ===================

const server = net.createServer((socket) => {
  console.log('✅ Device connected via TCP:', socket.remoteAddress);

  socket.on('data', async (data) => {
    const hex = data.toString('hex');
    console.log('📥 RAW HEX:', hex);
  try {
    if (hex.includes("feedcafedeadbeef")) {
      console.log("🔁 Trigger condition matched — starting enrollment logic...");
      // Optionally call existing functions like:
      // await handleEnrollmentViaBioStar()
    }

    // 🔍 Example: Log first 2 bytes as command ID
    const command = hex.slice(0, 4); // e.g., "4b00" or "5000"
    console.log("🧠 Command ID:", command);

    // 🔁 Extend to map command to actions
    switch (command) {
      case "4b00": // example
        console.log("✅ Received ENROLL_SUCCESS event");
        break;
      case "5000": // example
        console.log("✅ Received VERIFY_SUCCESS event");
        break;
      default:
        console.log("ℹ Unknown command:", command);
    }

  } catch (err) {
    console.error("❌ Error handling message:", err);
  }
  });
});

server.listen(TCP_PORT, () =>
  console.log(`🟢 TCP server listening on port ${TCP_PORT}`)
);

// =================== EXPRESS HTTP ROUTES ===================

// ✅ Status check
app.get('/api/status', (req, res) => {
  res.json({ success: true, message: 'TCP server online', deviceStatus: 'online' });
});

// ✅ Start enrollment
app.post('/api/enroll', async (req, res) => {
  const { memberId, memberName, deviceId } = req.body;
  try {
    await bsLogin();
    const bioUserId = await createUser(memberName || 'Gym Member', memberId);
    lastUserId = bioUserId;

    const scan1 = await scanFingerprint(deviceId);
    const t0 = scan1.data?.template0;

    const scan2 = await scanFingerprint(deviceId);
    const t1 = scan2.data?.template0;

    if (t0 && t1 && !(await identify(t0))) {
      await commitFingerprintToUser(bioUserId, t0, t1);
      await storeEvent(bioUserId, t0);
      return res.json({ success: true, message: 'Fingerprint enrolled' });
    } else {
      return res.status(400).json({ success: false, message: 'Duplicate or failed scan' });
    }
  } catch (err) {
    console.error('Enrollment Error:', err);
    return res.status(500).json({ success: false, message: 'Enrollment failed', error: err.message });
  }
});

// 🟡 Cancel enrollment (placeholder)
app.post('/api/cancel', (req, res) => {
  return res.json({ success: true, message: 'Enrollment cancelled (not implemented)' });
});

// 🟡 Delete user (placeholder)
app.post('/api/delete', (req, res) => {
  return res.json({ success: true, message: 'User deleted (not implemented)' });
});

// Start HTTP API
app.listen(HTTP_PORT, () => {
  console.log(`🟢 HTTP API listening on port ${HTTP_PORT}`);
});

import net from 'net';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const PORT = 51212;
const SUPABASE_URL = "https://gylemjegmangxyqzxhas.supabase.co"

const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bGVtamVnbWFuZ3h5cXp4aGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2MjM2NTUsImV4cCI6MjA2MDE5OTY1NX0.W5hv0fSJ6u4Q3RLoE5SF6H3MWmMsz7FUtknT3CYgJLI"

// --- Validate Configuration ---
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing Supabase URL or Service Key in environment variables.");
  process.exit(1);
}

// --- Supabase Client ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- TCP Server ---
const server = net.createServer();

server.on('connection', (socket) => {
  const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`📡 New client connected: ${remoteAddress}`);

  let buffer = '';

  socket.on('data', (data) => {
    buffer += data.toString();
    console.log(data.toString());
    // Process buffer line by line (assuming newline-delimited JSON)
    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
      const jsonString = buffer.substring(0, boundary);
      buffer = buffer.substring(boundary + 1);
      if (jsonString) {
        handleClientMessage(jsonString, socket);
      }
      boundary = buffer.indexOf('\n');
    }
  });

  socket.on('close', () => {
    console.log(`🔌 Client disconnected: ${remoteAddress}`);
  });

  socket.on('error', (err) => {
    console.error(`❌ Socket Error from ${remoteAddress}:`, err.message);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 TCP server for BioStar 2 running on port ${PORT}`);
});

// --- Message Handling Logic ---

/**
 * Handles a complete JSON message from a client.
 * @param {string} jsonString The raw JSON string from the client.
 * @param {net.Socket} socket The client's socket object.
 */
async function handleClientMessage(jsonString, socket) {
  try {
    console.log(`📨 Received: ${jsonString}`);
    const message = JSON.parse(jsonString);

    if (!message.type || !message.device_id) {
      throw new Error("Invalid message format: 'type' and 'device_id' are required.");
    }

    switch (message.type) {
      case 'enroll_success':
        await handleEnrollmentSuccess(message);
        socket.write(JSON.stringify({ status: 'ACK_ENROLL_SUCCESS' }) + '\n');
        break;
      case 'identify_success':
        await handleIdentifySuccess(message);
        socket.write(JSON.stringify({ status: 'ACK_IDENTIFY_SUCCESS' }) + '\n');
        break;
      case 'ping':
        console.log(`❤️ Ping from device ${message.device_id}`);
        socket.write(JSON.stringify({ status: 'PONG' }) + '\n');
        break;
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  } catch (err) {
    console.error("❌ Error processing message:", err.message);
    socket.write(JSON.stringify({ status: 'ERROR', message: err.message }) + '\n');
  }
}

/**
 * Handles a successful enrollment event from the device.
 * This is called *after* a fingerprint has been successfully enrolled on the device.
 * @param {object} message The parsed message object.
 * @param {string} message.member_id The ID of the member who was enrolled.
 * @param {number} message.quality The quality score of the enrolled fingerprint.
 */
async function handleEnrollmentSuccess({ member_id, quality }) {
  if (!member_id) {
    throw new Error("Missing 'member_id' for enrollment success event.");
  }

  console.log(`✅ Successful enrollment for member: ${member_id} with quality ${quality || 'N/A'}`);

  // Update the member's status in the database
  const { error } = await supabase
    .from('custom_members')
    .update({ fingerprint_enrolled: true })
    .eq('id', member_id);

  if (error) {
    console.error(`❌ Supabase error updating member ${member_id}:`, error);
    throw new Error("Failed to update member enrollment status.");
  }

  // Optionally, update the member_fingerprints table
  const { error: fpError } = await supabase
    .from('member_fingerprints')
    .update({
      enrollment_status: 'completed',
      enrolled_at: new Date().toISOString(),
      template_quality: quality,
    })
    .eq('member_id', member_id);

  if (fpError) {
    // This is not critical, so just log it
    console.warn(`⚠️ Supabase warning updating fingerprint record for ${member_id}:`, fpError);
  }
}

/**
 * Handles a successful identification event from the device.
 * @param {object} message The parsed message object.
 * @param {string} message.member_id The ID of the member who was identified.
 * @param {string} message.device_id The ID of the device that performed the identification.
 */
async function handleIdentifySuccess({ member_id, device_id }) {
  if (!member_id) {
    throw new Error("Missing 'member_id' for identification success event.");
  }

  console.log(`✅ Successful identification for member: ${member_id} on device ${device_id}`);

  // Log the check-in event in the database
  const { data: member, error: memberError } = await supabase
    .from('custom_members')
    .select('id, name, last_name')
    .eq('id', member_id)
    .single();

  if (memberError || !member) {
    console.error(`❌ Could not find member with ID ${member_id}:`, memberError);
    throw new Error("Identified member not found in database.");
  }

  const { error: checkinError } = await supabase.from('custom_checkins').insert({
    member_id: member.id,
    check_in_time: new Date().toISOString(),
    notes: `Verified by BioStar device ${device_id}`,
  });

  if (checkinError) {
    console.error(`❌ Supabase error logging check-in for ${member_id}:`, checkinError);
    throw new Error("Failed to log check-in.");
  }

  console.log(`🚪 Check-in logged for ${member.name} ${member.last_name}`);
}
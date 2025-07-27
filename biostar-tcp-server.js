const net = require("net")
const axios = require("axios")
const https = require("https")
const http = require("http")

class BioStarTCPServer {
  constructor(port = 51212) {
    this.port = port
    this.server = null
    this.clients = new Map()
    this.biostarSession = null

    // Try both HTTP and HTTPS URLs
    this.biostarUrls = [
      process.env.BIOSTAR_URL || "http://192.168.0.140:4443/api",
      "https://192.168.0.140:4443/api",
      "http://192.168.0.140:80/api",
      "http://192.168.0.140:8080/api",
    ]

    this.credentials = {
      login_id: process.env.BIOSTAR_USERNAME || "admin",
      password: process.env.BIOSTAR_PASSWORD || "Spartagym!",
    }
    this.enrollmentRequests = new Map()
    this.currentBiostarUrl = null

    // Disable SSL verification for self-signed certificates
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0
  }

  start() {
    this.server = net.createServer((socket) => {
      const clientId = `${socket.remoteAddress}:${socket.remotePort}`
      console.log(`New client connected: ${clientId}`)

      this.clients.set(clientId, {
        socket: socket,
        connectedAt: new Date(),
        lastActivity: new Date(),
      })

      socket.on("data", (data) => {
        this.handleClientData(clientId, data)
      })

      socket.on("close", () => {
        console.log(`Client disconnected: ${clientId}`)
        this.clients.delete(clientId)
      })

      socket.on("error", (err) => {
        console.error(`Socket error for ${clientId}:`, err.message)
        this.clients.delete(clientId)
      })
    })

    this.server.listen(this.port, () => {
      console.log(`BioStar TCP Server listening on port ${this.port}`)
      this.initializeBioStarConnection()
    })

    this.server.on("error", (err) => {
      console.error("Server error:", err)
    })
  }

  handleClientData(clientId, data) {
    try {
      const client = this.clients.get(clientId)
      if (client) {
        client.lastActivity = new Date()
      }

      console.log(`Received data from ${clientId}:`, data.toString("hex"))

      // Parse BioStar protocol
      this.parseBioStarProtocol(clientId, data)
    } catch (error) {
      console.error(`Error processing data from ${clientId}:`, error.message)
    }
  }

  parseBioStarProtocol(clientId, data) {
    if (data.length < 8) {
      console.log(`Data too short from ${clientId}:`, data.toString("hex"))
      return
    }

    // Parse BioStar protocol based on your logs
    const header = data.readUInt32LE(0)
    const command = data.readUInt16LE(4)
    const length = data.readUInt16LE(6)

    console.log(
      `BioStar Protocol - Header: 0x${header.toString(16)}, Command: 0x${command.toString(16)}, Length: ${length}`,
    )

    // Handle different commands based on your device logs
    switch (command) {
      case 0x179: // Unknown command from logs
        console.log("Handling command 0x179 - Device status request")
        this.sendDeviceStatusResponse(clientId)
        break

      case 0x108: // Unknown command from logs
        console.log("Handling command 0x108 - Device info request")
        this.sendDeviceInfoResponse(clientId)
        break

      case 0x0: // Empty command
        console.log("Handling command 0x0 - Keep alive")
        this.sendKeepAliveResponse(clientId)
        break

      case 0x1001: // User enrollment request
        console.log("Handling user enrollment request")
        this.handleEnrollmentRequest(clientId, data)
        break

      case 0x1002: // Fingerprint data
        console.log("Handling fingerprint data")
        this.handleFingerprintData(clientId, data)
        break

      default:
        console.log(`Unknown command: 0x${command.toString(16)}`)
        this.sendGenericResponse(clientId, command)
    }
  }

  sendDeviceStatusResponse(clientId) {
    const client = this.clients.get(clientId)
    if (!client) return

    // Create response based on BioStar protocol
    const response = Buffer.alloc(16)
    response.writeUInt32LE(0x10101316, 0) // Header from logs
    response.writeUInt16LE(0x179, 4) // Echo command
    response.writeUInt16LE(8, 6) // Data length
    response.writeUInt32LE(0x00000001, 8) // Status: OK
    response.writeUInt32LE(Date.now() & 0xffffffff, 12) // Timestamp

    client.socket.write(response)
    console.log(`Sent device status response to ${clientId}`)
  }

  sendDeviceInfoResponse(clientId) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(32)
    response.writeUInt32LE(0x10101316, 0) // Header
    response.writeUInt16LE(0x108, 4) // Echo command
    response.writeUInt16LE(24, 6) // Data length
    response.write("BioStar2 Device v2.8.3", 8) // Device info

    client.socket.write(response)
    console.log(`Sent device info response to ${clientId}`)
  }

  sendKeepAliveResponse(clientId) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(8)
    response.writeUInt32LE(0x3c3c7b7b, 0) // Header from logs
    response.writeUInt16LE(0x0, 4) // Echo command
    response.writeUInt16LE(0, 6) // No data

    client.socket.write(response)
    console.log(`Sent keep alive response to ${clientId}`)
  }

  sendGenericResponse(clientId, originalCommand) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(12)
    response.writeUInt32LE(0x10101316, 0) // Header
    response.writeUInt16LE(originalCommand, 4) // Echo command
    response.writeUInt16LE(4, 6) // Data length
    response.writeUInt32LE(0x00000001, 8) // Status: OK

    client.socket.write(response)
    console.log(`Sent generic response to ${clientId} for command 0x${originalCommand.toString(16)}`)
  }

  async tryConnection(url) {
    try {
      console.log(`Trying connection to: ${url}`)

      const isHttps = url.startsWith("https")
      const axiosConfig = {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
      }

      if (isHttps) {
        axiosConfig.httpsAgent = new https.Agent({
          rejectUnauthorized: false,
          secureProtocol: "TLSv1_2_method", // Try specific TLS version
        })
      }

      const response = await axios.post(
        `${url}/login`,
        {
          User: {
            login_id: this.credentials.login_id,
            password: this.credentials.password,
          },
        },
        axiosConfig,
      )

      if (response.data && response.data.Response) {
        this.biostarSession = response.data.Response.session_id
        this.currentBiostarUrl = url
        console.log(`✅ BioStar authentication successful with ${url}!`)
        console.log("Session ID:", this.biostarSession)
        return true
      }

      return false
    } catch (error) {
      console.log(`❌ Failed to connect to ${url}:`, error.message)
      return false
    }
  }

  async initializeBioStarConnection() {
    console.log("🔄 Initializing BioStar connection...")
    console.log(`Username: ${this.credentials.login_id}`)

    // Try each URL until one works
    for (const url of this.biostarUrls) {
      const success = await this.tryConnection(url)
      if (success) {
        return true
      }
    }

    console.error("❌ Failed to connect to any BioStar URL")
    console.log("Retrying BioStar connection in 60 seconds...")
    setTimeout(() => this.initializeBioStarConnection(), 60000)
    return false
  }

  async enrollUser(userData) {
    try {
      if (!this.biostarSession || !this.currentBiostarUrl) {
        console.log("No active session, attempting to authenticate...")
        const authSuccess = await this.initializeBioStarConnection()
        if (!authSuccess) {
          throw new Error("Failed to authenticate with BioStar")
        }
      }

      console.log("Enrolling user in BioStar:", userData)

      const isHttps = this.currentBiostarUrl.startsWith("https")
      const axiosConfig = {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "bs-session-id": this.biostarSession,
        },
        timeout: 30000,
      }

      if (isHttps) {
        axiosConfig.httpsAgent = new https.Agent({
          rejectUnauthorized: false,
          secureProtocol: "TLSv1_2_method",
        })
      }

      const response = await axios.post(
        `${this.currentBiostarUrl}/users`,
        {
          User: {
            user_id: userData.user_id,
            name: userData.name,
            email: userData.email || "",
            phone: userData.phone || "",
            start_datetime: userData.start_datetime || new Date().toISOString(),
            expiry_datetime: userData.expiry_datetime || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        axiosConfig,
      )

      console.log("User enrolled successfully in BioStar:", response.data)
      return response.data
    } catch (error) {
      console.error("BioStar enrollment error:", error.message)

      if (error.response && error.response.status === 401) {
        console.log("Session expired, re-authenticating...")
        this.biostarSession = null
        this.currentBiostarUrl = null
        await this.initializeBioStarConnection()
      }

      throw error
    }
  }

  handleEnrollmentRequest(clientId, data) {
    console.log(`Processing enrollment request from ${clientId}`)

    // Extract user data from the protocol data
    if (data.length >= 16) {
      const userId = data.readUInt32LE(8)
      console.log(`Enrollment request for user ID: ${userId}`)

      // Store enrollment request
      this.enrollmentRequests.set(clientId, {
        userId: userId,
        startTime: new Date(),
        status: "pending",
      })

      // Send acknowledgment
      const response = Buffer.alloc(12)
      response.writeUInt32LE(0x10101316, 0) // Header
      response.writeUInt16LE(0x1001, 4) // Echo command
      response.writeUInt16LE(4, 6) // Data length
      response.writeUInt32LE(0x00000001, 8) // Status: OK

      const client = this.clients.get(clientId)
      if (client) {
        client.socket.write(response)
        console.log(`Sent enrollment acknowledgment to ${clientId}`)
      }
    }
  }

  handleFingerprintData(clientId, data) {
    console.log(`Processing fingerprint data from ${clientId}`)

    const enrollmentRequest = this.enrollmentRequests.get(clientId)
    if (enrollmentRequest) {
      console.log(`Fingerprint data for user ${enrollmentRequest.userId}`)

      // Update enrollment status
      enrollmentRequest.status = "completed"
      enrollmentRequest.completedTime = new Date()

      // Send success response
      const response = Buffer.alloc(12)
      response.writeUInt32LE(0x10101316, 0) // Header
      response.writeUInt16LE(0x1002, 4) // Echo command
      response.writeUInt16LE(4, 6) // Data length
      response.writeUInt32LE(0x00000001, 8) // Status: OK

      const client = this.clients.get(clientId)
      if (client) {
        client.socket.write(response)
        console.log(`Sent fingerprint acknowledgment to ${clientId}`)
      }

      // TODO: Update Supabase database with enrollment completion
      this.updateSupabaseEnrollment(enrollmentRequest)
    }
  }

  async updateSupabaseEnrollment(enrollmentRequest) {
    try {
      console.log("Updating Supabase with enrollment completion:", enrollmentRequest)

      // This would update the member_fingerprints table
      // Implementation depends on your Supabase setup
    } catch (error) {
      console.error("Error updating Supabase:", error.message)
    }
  }

  getServerStatus() {
    const connectedClients = Array.from(this.clients.entries()).map(([id, client]) => ({
      id,
      connectedAt: client.connectedAt,
      lastActivity: client.lastActivity,
      address: id.split(":")[0],
    }))

    return {
      serverRunning: true,
      biostarSession: !!this.biostarSession,
      currentBiostarUrl: this.currentBiostarUrl,
      connectedClients: connectedClients.length,
      clients: connectedClients,
      enrollmentRequests: this.enrollmentRequests.size,
      uptime: process.uptime(),
    }
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        console.log("BioStar TCP Server stopped")
      })
    }
  }
}

// Create and start server
const server = new BioStarTCPServer(51212)
server.start()

// HTTP endpoints for status and control
const express = require("express")
const app = express()
const httpPort = Number.parseInt(process.env.PORT || 3001) + 1000

app.use(express.json())

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
  if (req.method === "OPTIONS") {
    res.sendStatus(200)
  } else {
    next()
  }
})

app.get("/api/status", (req, res) => {
  res.json(server.getServerStatus())
})

app.post("/api/enroll", async (req, res) => {
  try {
    console.log("Received enrollment request:", req.body)
    const result = await server.enrollUser(req.body)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error("Enrollment error:", error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post("/api/cancel", (req, res) => {
  try {
    console.log("Received cancel request:", req.body)
    // Handle cancellation logic
    res.json({ success: true, message: "Cancellation request processed" })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post("/api/delete", (req, res) => {
  try {
    console.log("Received delete request:", req.body)
    // Handle deletion logic
    res.json({ success: true, message: "Delete request processed" })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.listen(httpPort, () => {
  console.log(`🌐 HTTP API listening on port ${httpPort}`)
  console.log(`📊 Status endpoint: http://localhost:${httpPort}/api/status`)
  console.log(`👤 Enroll endpoint: http://localhost:${httpPort}/api/enroll`)
})

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully...")
  server.stop()
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...")
  server.stop()
  process.exit(0)
})

// Periodic cleanup and status logging
setInterval(() => {
  const status = server.getServerStatus()
  console.log(
    `📊 Server Status - Clients: ${status.connectedClients}, Session: ${status.biostarSession ? "Active" : "Inactive"}, URL: ${status.currentBiostarUrl || "None"}, Uptime: ${Math.floor(status.uptime)}s`,
  )
}, 300000) // Every 5 minutes

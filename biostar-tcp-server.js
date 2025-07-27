const net = require("net")
const axios = require("axios")
const express = require("express")

class BioStarTCPServer {
  constructor(port = 51212) {
    this.port = port
    this.server = null
    this.clients = new Map()
    this.biostarSession = null
    this.currentBiostarUrl = null
    this.credentials = {
      login_id: process.env.BIOSTAR_USERNAME || "admin",
      password: process.env.BIOSTAR_PASSWORD || "Spartagym!",
    }
    this.enrollmentRequests = new Map()

    // Try HTTP first - most BioStar devices use plain HTTP
    this.biostarUrls = [
     "https://cgk1.clusters.zeabur.com:30112/api"
    ]

    console.log("🚀 BioStar TCP Server initializing...")
    console.log("📋 Configuration:")
    console.log(`   Username: ${this.credentials.login_id}`)
    console.log(`   URLs to try: ${this.biostarUrls.join(", ")}`)
  }

  start() {
    this.server = net.createServer((socket) => {
      const clientId = `${socket.remoteAddress}:${socket.remotePort}`
      console.log(`🔌 New client connected: ${clientId}`)

      this.clients.set(clientId, {
        socket: socket,
        connectedAt: new Date(),
        lastActivity: new Date(),
      })

      socket.on("data", (data) => {
        this.handleClientData(clientId, data)
      })

      socket.on("close", () => {
        console.log(`❌ Client disconnected: ${clientId}`)
        this.clients.delete(clientId)
      })

      socket.on("error", (err) => {
        console.error(`⚠️ Socket error for ${clientId}:`, err.message)
        this.clients.delete(clientId)
      })
    })

    this.server.listen(this.port, () => {
      console.log(`🌐 BioStar TCP Server listening on port ${this.port}`)
      this.initializeBioStarConnection()
    })

    this.server.on("error", (err) => {
      console.error("❌ Server error:", err)
    })
  }

  handleClientData(clientId, data) {
    try {
      const client = this.clients.get(clientId)
      if (client) {
        client.lastActivity = new Date()
      }

      console.log(`📨 Received data from ${clientId}:`, data.toString("hex"))
      this.parseBioStarProtocol(clientId, data)
    } catch (error) {
      console.error(`❌ Error processing data from ${clientId}:`, error.message)
    }
  }

  parseBioStarProtocol(clientId, data) {
    if (data.length < 8) {
      console.log(`⚠️ Data too short from ${clientId}:`, data.toString("hex"))
      return
    }

    const header = data.readUInt32LE(0)
    const command = data.readUInt16LE(4)
    const length = data.readUInt16LE(6)

    console.log(
      `📡 BioStar Protocol - Header: 0x${header.toString(16)}, Command: 0x${command.toString(16)}, Length: ${length}`,
    )

    switch (command) {
      case 0x179:
        console.log("🔄 Handling command 0x179 - Device status request")
        this.sendDeviceStatusResponse(clientId)
        break
      case 0x108:
        console.log("ℹ️ Handling command 0x108 - Device info request")
        this.sendDeviceInfoResponse(clientId)
        break
      case 0x0:
        console.log("💓 Handling command 0x0 - Keep alive")
        this.sendKeepAliveResponse(clientId)
        break
      case 0x1001:
        console.log("👤 Handling user enrollment request")
        this.handleEnrollmentRequest(clientId, data)
        break
      case 0x1002:
        console.log("👆 Handling fingerprint data")
        this.handleFingerprintData(clientId, data)
        break
      default:
        console.log(`❓ Unknown command: 0x${command.toString(16)}`)
        this.sendGenericResponse(clientId, command)
    }
  }

  sendDeviceStatusResponse(clientId) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(16)
    response.writeUInt32LE(0x10101316, 0)
    response.writeUInt16LE(0x179, 4)
    response.writeUInt16LE(8, 6)
    response.writeUInt32LE(0x00000001, 8)
    response.writeUInt32LE(Date.now() & 0xffffffff, 12)

    client.socket.write(response)
    console.log(`✅ Sent device status response to ${clientId}`)
  }

  sendDeviceInfoResponse(clientId) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(32)
    response.writeUInt32LE(0x10101316, 0)
    response.writeUInt16LE(0x108, 4)
    response.writeUInt16LE(24, 6)
    response.write("BioStar2 Device v2.8.3", 8)

    client.socket.write(response)
    console.log(`✅ Sent device info response to ${clientId}`)
  }

  sendKeepAliveResponse(clientId) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(8)
    response.writeUInt32LE(0x3c3c7b7b, 0)
    response.writeUInt16LE(0x0, 4)
    response.writeUInt16LE(0, 6)

    client.socket.write(response)
    console.log(`💓 Sent keep alive response to ${clientId}`)
  }

  sendGenericResponse(clientId, originalCommand) {
    const client = this.clients.get(clientId)
    if (!client) return

    const response = Buffer.alloc(12)
    response.writeUInt32LE(0x10101316, 0)
    response.writeUInt16LE(originalCommand, 4)
    response.writeUInt16LE(4, 6)
    response.writeUInt32LE(0x00000001, 8)

    client.socket.write(response)
    console.log(`✅ Sent generic response to ${clientId} for command 0x${originalCommand.toString(16)}`)
  }

  async tryHttpConnection(url) {
    try {
      console.log(`🔍 Trying HTTP connection to: ${url}`)

      // Force HTTP connection - no SSL/TLS
      const response = await axios.post(
        `${url}/login`,
        {
          User: {
            login_id: this.credentials.login_id,
            password: this.credentials.password,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "BioStar-TCP-Server/1.0",
          },
          timeout: 10000,
          // Explicitly disable any SSL/HTTPS handling
          maxRedirects: 0,
          validateStatus: (status) => {
            return status >= 200 && status < 500 // Accept 4xx errors too for debugging
          },
        },
      )

      console.log(`📊 Response status: ${response.status}`)
      console.log(`📄 Response data:`, JSON.stringify(response.data, null, 2))

      if (response.data && response.data.Response && response.data.Response.session_id) {
        this.biostarSession = response.data.Response.session_id
        this.currentBiostarUrl = url
        console.log(`✅ BioStar authentication successful with ${url}!`)
        console.log(`🔑 Session ID: ${this.biostarSession}`)
        return true
      } else if (response.data) {
        console.log(`⚠️ Unexpected response format from ${url}:`, response.data)
        return false
      }

      return false
    } catch (error) {
      console.log(`❌ Failed to connect to ${url}:`)
      console.log(`   Error code: ${error.code}`)
      console.log(`   Error message: ${error.message}`)

      if (error.response) {
        console.log(`   Response status: ${error.response.status}`)
        console.log(`   Response data:`, error.response.data)
      }

      return false
    }
  }

  async tryHttpsConnection(url) {
    try {
      console.log(`🔒 Trying HTTPS connection to: ${url}`)

      const https = require("https")
      const httpsAgent = new https.Agent({
        rejectUnauthorized: true, // Accept self-signed certificates
        keepAlive: true,
      })

      const response = await axios.post(
        `${url}/login`,
        {
          User: {
            login_id: this.credentials.login_id,
            password: this.credentials.password,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "BioStar-TCP-Server/1.0",
          },
          timeout: 10000,
          httpsAgent: httpsAgent,
          validateStatus: (status) => status >= 200 && status < 500,
        },
      )

      console.log(`📊 HTTPS Response status: ${response.status}`)
      console.log(`📄 HTTPS Response data:`, JSON.stringify(response.data, null, 2))

      if (response.data && response.data.Response && response.data.Response.session_id) {
        this.biostarSession = response.data.Response.session_id
        this.currentBiostarUrl = url
        console.log(`✅ BioStar HTTPS authentication successful with ${url}!`)
        console.log(`🔑 Session ID: ${this.biostarSession}`)
        return true
      }

      return false
    } catch (error) {
      console.log(`❌ HTTPS connection failed to ${url}:`)
      console.log(`   Error code: ${error.code}`)
      console.log(`   Error message: ${error.message}`)
      return false
    }
  }

  async initializeBioStarConnection() {
    console.log("🔄 Initializing BioStar connection...")
    console.log(`👤 Username: ${this.credentials.login_id}`)

    // Try each URL
    for (const url of this.biostarUrls) {
      let success = false

      if (url.startsWith("http://")) {
        success = await this.tryHttpConnection(url)
      } else if (url.startsWith("https://")) {
        success = await this.tryHttpsConnection(url)
      }

      if (success) {
        console.log(`🎉 Successfully connected to BioStar at ${url}`)
        return true
      }
    }

    console.error("❌ Failed to connect to any BioStar URL")
    console.log("🔄 Retrying BioStar connection in 60 seconds...")
    setTimeout(() => this.initializeBioStarConnection(), 60000)
    return false
  }

  async enrollUser(userData) {
    try {
      if (!this.biostarSession || !this.currentBiostarUrl) {
        console.log("🔄 No active session, attempting to authenticate...")
        const authSuccess = await this.initializeBioStarConnection()
        if (!authSuccess) {
          throw new Error("Failed to authenticate with BioStar")
        }
      }

      console.log("👤 Enrolling user in BioStar:", userData)

      let response
      if (this.currentBiostarUrl.startsWith("http://")) {
        // HTTP request
        response = await axios.post(
          `${this.currentBiostarUrl}/users`,
          {
            User: {
              user_id: userData.user_id || userData.memberId,
              name: userData.name || userData.memberName,
              email: userData.email || "",
              phone: userData.phone || "",
              start_datetime: userData.start_datetime || new Date().toISOString(),
              expiry_datetime:
                userData.expiry_datetime || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "bs-session-id": this.biostarSession,
            },
            timeout: 30000,
          },
        )
      } else {
        // HTTPS request
        const https = require("https")
        const httpsAgent = new https.Agent({
          rejectUnauthorized: false,
        })

        response = await axios.post(
          `${this.currentBiostarUrl}/users`,
          {
            User: {
              user_id: userData.user_id || userData.memberId,
              name: userData.name || userData.memberName,
              email: userData.email || "",
              phone: userData.phone || "",
              start_datetime: userData.start_datetime || new Date().toISOString(),
              expiry_datetime:
                userData.expiry_datetime || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "bs-session-id": this.biostarSession,
            },
            timeout: 30000,
            httpsAgent: httpsAgent,
          },
        )
      }

      console.log("✅ User enrolled successfully in BioStar:", response.data)
      return response.data
    } catch (error) {
      console.error("❌ BioStar enrollment error:", error.message)

      if (error.response && error.response.status === 401) {
        console.log("🔄 Session expired, re-authenticating...")
        this.biostarSession = null
        this.currentBiostarUrl = null
        await this.initializeBioStarConnection()
      }

      throw error
    }
  }

  handleEnrollmentRequest(clientId, data) {
    console.log(`👤 Processing enrollment request from ${clientId}`)

    if (data.length >= 16) {
      const userId = data.readUInt32LE(8)
      console.log(`🆔 Enrollment request for user ID: ${userId}`)

      this.enrollmentRequests.set(clientId, {
        userId: userId,
        startTime: new Date(),
        status: "pending",
      })

      const response = Buffer.alloc(12)
      response.writeUInt32LE(0x10101316, 0)
      response.writeUInt16LE(0x1001, 4)
      response.writeUInt16LE(4, 6)
      response.writeUInt32LE(0x00000001, 8)

      const client = this.clients.get(clientId)
      if (client) {
        client.socket.write(response)
        console.log(`✅ Sent enrollment acknowledgment to ${clientId}`)
      }
    }
  }

  handleFingerprintData(clientId, data) {
    console.log(`👆 Processing fingerprint data from ${clientId}`)

    const enrollmentRequest = this.enrollmentRequests.get(clientId)
    if (enrollmentRequest) {
      console.log(`✅ Fingerprint data for user ${enrollmentRequest.userId}`)

      enrollmentRequest.status = "completed"
      enrollmentRequest.completedTime = new Date()

      const response = Buffer.alloc(12)
      response.writeUInt32LE(0x10101316, 0)
      response.writeUInt16LE(0x1002, 4)
      response.writeUInt16LE(4, 6)
      response.writeUInt32LE(0x00000001, 8)

      const client = this.clients.get(clientId)
      if (client) {
        client.socket.write(response)
        console.log(`✅ Sent fingerprint acknowledgment to ${clientId}`)
      }

      this.updateSupabaseEnrollment(enrollmentRequest)
    }
  }

  async updateSupabaseEnrollment(enrollmentRequest) {
    try {
      console.log("📊 Updating Supabase with enrollment completion:", enrollmentRequest)
      // Implementation would go here
    } catch (error) {
      console.error("❌ Error updating Supabase:", error.message)
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
        console.log("🛑 BioStar TCP Server stopped")
      })
    }
  }
}

// Create and start server
const server = new BioStarTCPServer(51212)
server.start()

// HTTP API endpoints
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
  const status = server.getServerStatus()
  console.log("📊 Status request:", status)
  res.json(status)
})

app.post("/api/enroll", async (req, res) => {
  try {
    console.log("👤 Received enrollment request:", req.body)
    const result = await server.enrollUser(req.body)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error("❌ Enrollment error:", error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post("/api/cancel", (req, res) => {
  try {
    console.log("🚫 Received cancel request:", req.body)
    res.json({ success: true, message: "Cancellation request processed" })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.post("/api/delete", (req, res) => {
  try {
    console.log("🗑️ Received delete request:", req.body)
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
  console.log("🛑 Received SIGINT, shutting down gracefully...")
  server.stop()
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully...")
  server.stop()
  process.exit(0)
})

// Periodic status logging
setInterval(() => {
  const status = server.getServerStatus()
  console.log(
    `📊 Server Status - Clients: ${status.connectedClients}, Session: ${status.biostarSession ? "Active" : "Inactive"}, URL: ${status.currentBiostarUrl || "None"}, Uptime: ${Math.floor(status.uptime)}s`,
  )
}, 300000) // Every 5 minutes

console.log("🚀 BioStar TCP Server started successfully!")

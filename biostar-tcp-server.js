const net = require("net")
const axios = require("axios")

class BioStarTCPServer {
  constructor(port = 51212) {
    this.port = port
    this.server = null
    this.clients = new Map()
    this.biostarSession = null
    this.biostarBaseUrl = process.env.BIOSTAR_URL || "https://192.168.0.140:4443/api"
    this.credentials = {
      login_id: process.env.BIOSTAR_USERNAME || "admin",
      password: process.env.BIOSTAR_PASSWORD || "Spartagym!",
    }
    this.enrollmentRequests = new Map()

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
      console.log(`BioStar URL: ${this.biostarBaseUrl}`)
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

  async initializeBioStarConnection() {
    try {
      console.log("Initializing BioStar connection...")
      console.log(`Connecting to: ${this.biostarBaseUrl}`)
      console.log(`Username: ${this.credentials.login_id}`)

      const response = await axios.post(
        `${this.biostarBaseUrl}/login`,
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
          },
          timeout: 30000, // Increased timeout to 30 seconds
          httpsAgent: new (require("https").Agent)({
            rejectUnauthorized: false, // Accept self-signed certificates
          }),
        },
      )

      if (response.data && response.data.Response) {
        this.biostarSession = response.data.Response.session_id
        console.log("BioStar authentication successful!")
        console.log("Session ID:", this.biostarSession)
        return true
      } else {
        console.error("Invalid response format:", response.data)
        return false
      }
    } catch (error) {
      console.error("BioStar authentication error:", error.message)

      if (error.code === "ECONNREFUSED") {
        console.error("Connection refused - check if BioStar device is accessible")
      } else if (error.code === "ETIMEDOUT") {
        console.error("Connection timeout - device may be slow to respond")
      } else if (error.response) {
        console.error("Response status:", error.response.status)
        console.error("Response data:", error.response.data)
      }

      // Retry after 60 seconds
      console.log("Retrying BioStar connection in 60 seconds...")
      setTimeout(() => this.initializeBioStarConnection(), 60000)
      return false
    }
  }

  async enrollUser(userData) {
    try {
      if (!this.biostarSession) {
        console.log("No active session, attempting to authenticate...")
        const authSuccess = await this.initializeBioStarConnection()
        if (!authSuccess) {
          throw new Error("Failed to authenticate with BioStar")
        }
      }

      console.log("Enrolling user in BioStar:", userData)

      const response = await axios.post(
        `${this.biostarBaseUrl}/users`,
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
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "bs-session-id": this.biostarSession,
          },
          timeout: 30000,
          httpsAgent: new (require("https").Agent)({
            rejectUnauthorized: false,
          }),
        },
      )

      console.log("User enrolled successfully in BioStar:", response.data)
      return response.data
    } catch (error) {
      console.error("BioStar enrollment error:", error.message)

      if (error.response && error.response.status === 401) {
        console.log("Session expired, re-authenticating...")
        this.biostarSession = null
        await this.initializeBioStarConnection()
      }

      throw error
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

app.get("/status", (req, res) => {
  res.json(server.getServerStatus())
})

app.post("/enroll", async (req, res) => {
  try {
    const result = await server.enrollUser(req.body)
    res.json({ success: true, data: result })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
})

app.listen(httpPort, () => {
  console.log(`HTTP API listening on port ${httpPort}`)
  console.log(`Status endpoint: http://localhost:${httpPort}/status`)
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
    `Server Status - Clients: ${status.connectedClients}, Session: ${status.biostarSession ? "Active" : "Inactive"}, Uptime: ${Math.floor(status.uptime)}s`,
  )
}, 300000) // Every 5 minutes

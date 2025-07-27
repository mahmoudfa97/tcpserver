const net = require("net")
const axios = require("axios")
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5bGVtamVnbWFuZ3h5cXp4aGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2MjM2NTUsImV4cCI6MjA2MDE5OTY1NX0.W5hv0fSJ6u4Q3RLoE5SF6H3MWmMsz7FUtknT3CYgJLI"
const SUPABASE_URL = "https://gylemjegmangxyqzxhas.supabase.co"

class BioStarTCPServer {
  constructor(port = 51212) {
    this.port = port
    this.server = null
    this.clients = new Map()
    this.biostarSession = null
    this.biostarBaseUrl = "https://cgk1.clusters.zeabur.com:30112/api"
    this.credentials = {
      login_id: "admin",
      password: "Spartagym!",
    }
  }

  start() {
    this.server = net.createServer((socket) => {
      const clientId = `${socket.remoteAddress}:${socket.remotePort}`
      console.log(`New client connected: ${clientId}`)

      this.clients.set(clientId, socket)

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
      console.log(`Received data from ${clientId}:`, data.toString("hex"))

      // Check if this is HTTP data (starts with HTTP method)
      const dataStr = data.toString()
      if (dataStr.startsWith("POST") || dataStr.startsWith("GET") || dataStr.startsWith("PUT")) {
        this.handleHttpRequest(clientId, dataStr)
        return
      }

      // Handle raw TCP data
      this.handleRawTcpData(clientId, data)
    } catch (error) {
      console.error(`Error processing data from ${clientId}:`, error.message)
    }
  }

  handleHttpRequest(clientId, httpData) {
    try {
      console.log(`Processing HTTP request from ${clientId}`)

      // Split headers and body
      const parts = httpData.split("\r\n\r\n")
      if (parts.length < 2) {
        console.error("Invalid HTTP request format")
        return
      }

      const headers = parts[0]
      const body = parts[1]

      console.log("HTTP Headers:", headers)
      console.log("HTTP Body:", body)

      // Try to parse JSON body
      if (body.trim()) {
        try {
          const jsonData = JSON.parse(body)
          console.log("Parsed JSON:", jsonData)

          // Handle different API endpoints
          if (headers.includes("POST") && headers.includes("/login")) {
            this.handleLoginRequest(clientId, jsonData)
          } else if (headers.includes("POST") && headers.includes("/users")) {
            this.handleUserEnrollment(clientId, jsonData)
          }
        } catch (jsonError) {
          console.error("JSON parsing error:", jsonError.message)
          console.log("Raw body:", body)
        }
      }
    } catch (error) {
      console.error("Error handling HTTP request:", error.message)
    }
  }

  handleRawTcpData(clientId, data) {
    // Handle BioStar device protocol data
    console.log(`Processing raw TCP data from ${clientId}`)

    // Parse BioStar protocol
    if (data.length >= 8) {
      const header = data.readUInt32LE(0)
      const command = data.readUInt16LE(4)
      const length = data.readUInt16LE(6)

      console.log(
        `BioStar Protocol - Header: 0x${header.toString(16)}, Command: 0x${command.toString(16)}, Length: ${length}`,
      )

      // Handle different commands
      switch (command) {
        case 0x1001: // Device info request
          this.sendDeviceInfo(clientId)
          break
        case 0x1002: // User enrollment
          this.handleUserEnrollmentCommand(clientId, data)
          break
        case 0x1003: // User deletion
          this.handleUserDeletionCommand(clientId, data)
          break
        default:
          console.log(`Unknown command: 0x${command.toString(16)}`)
      }
    }
  }

  async handleLoginRequest(clientId, loginData) {
    try {
      console.log("Processing login request:", loginData)

      // Authenticate with BioStar device
      const response = await this.authenticateBioStar(loginData)

      // Send response back to client
      const socket = this.clients.get(clientId)
      if (socket) {
        const httpResponse = this.createHttpResponse(200, response)
        socket.write(httpResponse)
      }
    } catch (error) {
      console.error("Login request error:", error.message)

      const socket = this.clients.get(clientId)
      if (socket) {
        const errorResponse = this.createHttpResponse(401, { error: "Authentication failed" })
        socket.write(errorResponse)
      }
    }
  }

  async authenticateBioStar(credentials) {
    try {
      // Disable SSL verification for self-signed certificates
      process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0

      const response = await axios.post(
        `${this.biostarBaseUrl}/login`,
        {
          User: {
            login_id: credentials.login_id || this.credentials.login_id,
            password: credentials.password || this.credentials.password,
          },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 10000,
        },
      )

      if (response.data && response.data.Response) {
        this.biostarSession = response.data.Response.session_id
        console.log("BioStar authentication successful, session:", this.biostarSession)
        return response.data
      }

      throw new Error("Invalid response format")
    } catch (error) {
      console.error("BioStar authentication error:", error.message)
      if (error.response) {
        console.error("Response status:", error.response.status)
        console.error("Response data:", error.response.data)
      }
      throw error
    }
  }

  createHttpResponse(statusCode, data) {
    const jsonData = JSON.stringify(data)
    const response = [
      `HTTP/1.1 ${statusCode} ${statusCode === 200 ? "OK" : "Error"}`,
      "Content-Type: application/json",
      "Access-Control-Allow-Origin: *",
      "Access-Control-Allow-Methods: GET, POST, PUT, DELETE",
      "Access-Control-Allow-Headers: Content-Type, Authorization",
      `Content-Length: ${Buffer.byteLength(jsonData)}`,
      "Connection: close",
      "",
      jsonData,
    ].join("\r\n")

    return response
  }

  sendDeviceInfo(clientId) {
    const socket = this.clients.get(clientId)
    if (socket) {
      // Create device info response
      const deviceInfo = Buffer.alloc(32)
      deviceInfo.writeUInt32LE(0x12345678, 0) // Header
      deviceInfo.writeUInt16LE(0x1001, 4) // Command response
      deviceInfo.writeUInt16LE(24, 6) // Data length
      deviceInfo.write("BioStar Device v2.0", 8)

      socket.write(deviceInfo)
      console.log(`Sent device info to ${clientId}`)
    }
  }

  async handleUserEnrollment(clientId, userData) {
    try {
      console.log("Processing user enrollment:", userData)

      if (!this.biostarSession) {
        await this.authenticateBioStar(this.credentials)
      }

      // Enroll user in BioStar
      const enrollmentResponse = await this.enrollUserInBioStar(userData)

      // Send response back to client
      const socket = this.clients.get(clientId)
      if (socket) {
        const httpResponse = this.createHttpResponse(200, enrollmentResponse)
        socket.write(httpResponse)
      }

      // Update Supabase
      await this.updateSupabaseEnrollment(userData, enrollmentResponse)
    } catch (error) {
      console.error("User enrollment error:", error.message)

      const socket = this.clients.get(clientId)
      if (socket) {
        const errorResponse = this.createHttpResponse(500, { error: "Enrollment failed" })
        socket.write(errorResponse)
      }
    }
  }

  async enrollUserInBioStar(userData) {
    try {
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
          timeout: 10000,
        },
      )

      console.log("User enrolled successfully in BioStar:", response.data)
      return response.data
    } catch (error) {
      console.error("BioStar enrollment error:", error.message)
      throw error
    }
  }

  async updateSupabaseEnrollment(userData, biostarResponse) {
    try {
      // Update member fingerprints table in Supabase
      const supabaseResponse = await axios.post(
        `${SUPABASE_URL}/rest/v1/member_fingerprints`,
        {
          member_id: userData.member_id,
          biostar_user_id: userData.user_id,
          enrollment_status: "enrolled",
          enrolled_at: new Date().toISOString(),
          biostar_response: biostarResponse,
        },
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
        },
      )

      console.log("Supabase updated successfully")
    } catch (error) {
      console.error("Supabase update error:", error.message)
    }
  }

  async initializeBioStarConnection() {
    try {
      console.log("Initializing BioStar connection...")
      await this.authenticateBioStar(this.credentials)
      console.log("BioStar connection initialized successfully")
    } catch (error) {
      console.error("Failed to initialize BioStar connection:", error.message)
      // Retry after 30 seconds
      setTimeout(() => this.initializeBioStarConnection(), 30000)
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

// Start the server
const server = new BioStarTCPServer(51212)
server.start()

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

# Test Coverage — Game Server Node Connector

## Overview

- **Framework:** Jest + ts-jest
- **Coverage threshold:** 40% global minimum (branches, functions, lines, statements)
- **Test command:** `npx jest --no-cache --coverage`

---

## Unit Tests

### Utility Functions

#### `src/utilities/safeJsonStringify.spec.ts` — Safe JSON Serialization (6 tests)
Tests a `JSON.stringify` wrapper that handles circular references and errors.
- Stringifies simple objects
- Handles circular references gracefully
- Handles null, undefined, and primitive inputs
- Returns fallback string on error
- Handles deeply nested objects
- Handles arrays with mixed types

---

### Services

#### `src/file-operations/file-operations.service.spec.ts` — File System Operations (6 tests)
Tests file read/write operations for game server configuration files.
- Reads file contents from disk
- Writes content to file
- Creates parent directories if they don't exist
- Handles file not found errors
- Handles permission errors
- Deletes files cleanly

#### `src/system/system.service.spec.ts` — System Management (12 tests)
Tests system-level operations for managing the game server process.
- **Process management:**
  - Reports server running status
  - Reports server stopped status
  - Retrieves system resource usage (CPU, memory)
- **Server info:**
  - Returns correct server hostname
  - Returns correct server IP
  - Returns server port configuration
- **Health checks:**
  - Returns healthy when server is responsive
  - Returns unhealthy when server is unresponsive
  - Handles timeout on health check
- **Configuration:**
  - Loads server configuration from environment
  - Applies match settings to server config
  - Validates configuration before applying

#### `src/rcon/rcon.service.spec.ts` — RCON Client (8 tests)
Tests the Source RCON protocol client for communicating with the CS2 game server. Mocks the `rcon-client` module.
- Creates new RCON connection with correct host/port/password
- Reuses existing connection if already connected
- Sends raw command and returns response buffer
- Disconnects and cleans up connection
- Handles connection errors gracefully
- Reconnects after connection drop
- Passes match data correctly through RCON commands
- Handles authentication failure

#### `src/demos/demos.service.spec.ts` — Demo Upload Service (9 tests)
Tests demo file upload to object storage via presigned URLs. Mocks `glob`, `node-fetch`, and `fs`.
- Gets presigned upload URL from API
- Uploads demo file to presigned URL
- Handles 409 Conflict (demo already uploaded)
- Handles 406 Not Acceptable (invalid demo)
- Handles 410 Gone (upload window expired)
- Sends upload completion notification
- Logs errors on upload failure
- Handles missing demo files gracefully
- Retries on transient network errors

---

### Stub Tests (7 files)

The following service spec files contain only the default NestJS "should be defined" test. They verify dependency injection wiring is correct but do not test business logic:

`app.controller`, `app.service`, `game-server.service`, `kubernetes.service`, `log-handler.service`, `match.service`, `web-socket.gateway`

---

## CI/CD

GitHub Actions workflow (`.github/workflows/test.yml`) runs on push/PR to `main` and `develop`:
- Single `unit-tests` job: checkout → setup Node 20 → yarn install → jest with coverage → upload coverage artifact

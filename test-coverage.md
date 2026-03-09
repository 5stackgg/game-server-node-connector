# Test Coverage — Game Server Node Connector

## Overview

- **Framework:** Jest + ts-jest
- **Test suites:** 14
- **Total tests:** 152
- **Coverage threshold:** 40% statements/lines, 35% branches, 30% functions
- **Test command:** `npx jest --no-cache --coverage`

### Global Coverage

| Metric | Coverage |
|--------|----------|
| Statements | 52.1% |
| Branches | 46.4% |
| Functions | 54.3% |
| Lines | 52.1% |

---

## Unit Tests

### Utility Functions

#### `src/utilities/safeJsonStringify.spec.ts` — Safe JSON Serialization (6 tests)
Tests a `JSON.stringify` wrapper that handles BigInt values.
- Stringifies simple objects
- Converts BigInt values to strings
- Handles nested BigInt
- Mixed types with BigInt
- Objects without BigInt
- Empty objects

#### `src/utilities/throttle.spec.ts` — Stream Throttling (11 tests)
Tests the bandwidth-limiting Transform stream utility. Uses `jest.useFakeTimers()`.
- Returns a Readable stream
- Creates independent throttle instances for different names
- Reuses existing throttle for same name
- Uses custom highWaterMark as chunkSize
- Default chunkSize is max(1024, bytesPerSecond/8)
- setBytesPerSecond updates rate
- setBytesPerSecond is no-op on same value
- Enqueues chunks and processes within budget
- Stops sending when budget exceeded, resumes after interval reset
- Error propagation from source stream
- End event propagation from source stream

---

### Services

#### `src/system/network.service.spec.ts` — Network IP/Subnet Calculations (31 tests)
Tests pure IP math functions, network stats, and interface discovery. Mocks `os.networkInterfaces()` and `child_process.spawn`.
- **calculateIPv4NetworkAddress** (5): /24, /16, /25 boundary, all-zeros mask, all-ones mask
- **calculateIPv6NetworkAddress** (6): /64, /48, /56 partial-segment, `::1` loopback, `2001:db8::` expansion, `fe80::1` link-local
- **getNetworkStats** (5): empty map, single NIC averages, multiple NICs, clears after read, zero averages
- **captureData** (3): valid parse, malformed input, zero bytes/s
- **getNetworkLimit / setNetworkLimit** (5): initial undefined, set+get, logs on change, no-op on same value, clear to undefined
- **getLanInterface / getLanIP** (7): IPv4+IPv6 from mock, getLanIP address, skips tailscale, skips internal, empty interfaces, no IPv4, skips cni

#### `src/file-operations/file-operations.service.spec.ts` — File System Operations (27 tests)
Tests secure file operations with path validation. Mocks `fs/promises`.
- **validatePath** (8): rejects /etc, path traversal with ../, /tmp, /home, encoded traversal, /servers/../etc, accepts /servers/ and /custom-plugins
- **readFile** (3): valid read, not found, path is directory
- **createDirectory** (2): creates with recursive, no-op for existing
- **deleteFileOrDirectory** (3): delete file, delete directory, not found
- **moveFileOrDirectory** (3): source not found, into existing directory, destination is file
- **renameFileOrDirectory** (3): success, source not found, destination exists
- **uploadFile** (2): write buffer, auto-create parent dir
- **writeTextFile** (1): write with utf8
- **getFileStats** (2): existing path stats, not found

#### `src/offline-matches/offline-matches.service.spec.ts` — Offline Match YAML Generation (16 tests)
Tests Kubernetes pod manifest generation and match lifecycle. Mocks `glob`, `fs`, `get-port-please`.
- **getMatches** (3): parses YAML+JSON pairs, skips missing JSON, empty directory
- **getMatch** (2): finds by ID, returns undefined for non-existent
- **generateYamlFiles** (5): placeholder replacement + writes, port allocation, NODE_NAME missing, cleanup on error, de_dust2 default
- **updateMatchData** (1): writes formatted JSON
- **deleteMatch** (3): removes both files, handles missing files, propagates errors
- **replacePlaceholders** (2): all placeholders replaced, multiple occurrences

#### `src/webrtc/webrtc.service.spec.ts` — WebRTC LAN Detection (13 tests)
Tests LAN detection logic and WebRTC signaling. Mocks `node-datachannel`.
- **isSameLAN** (7): IPv4 same/different subnet, IPv6 same/different prefix, no candidate pair, missing ipv4 interface, mixed address types
- **handleOffer** (4): valid data, missing clientId/peerId/sessionId
- **handleCandidate** (2): forwards candidate, ignores unknown peerId

#### `src/redis/redis-manager/redis-manager.service.spec.ts` — Redis Connection Manager (9 tests)
Tests connection lifecycle and error handling. Mocks `ioredis`.
- Connection creation, reuse, and separation (3)
- Error handler suppresses ECONNRESET, EPIPE, ETIMEDOUT (3)
- Error handler logs unexpected errors (1)
- getConfig returns merged defaults (1)
- retryStrategy returns 5000 (1)

#### `src/rcon/rcon.service.spec.ts` — RCON Client (12 tests)
Tests the Source RCON protocol client for CS2 game servers. Mocks `rcon-client`.
- Creates new connection, reuses existing, creates separate for different matchIds (3)
- Throws when match data not found (1)
- Disconnect removes from pool, safe for non-existent (2)
- Passes correct host/port/password (1)
- Registers error and end event handlers (1)
- Connection timeout fires and cleans up (1)
- Send override converts UTF-8 buffer correctly (1)
- Error event handler triggers disconnect (1)
- End event handler removes connection from pool (1)

#### `src/rcon/rcon.gateway.spec.ts` — RCON WebSocket Gateway (3 tests)
Tests the WebSocket gateway for RCON command execution.
- Sends RCON command and returns result with uuid
- Connection failure sends error message
- Sends proper JSON format with event and data

#### `src/demos/demos.service.spec.ts` — Demo Upload Service (9 tests)
Tests demo file upload to object storage via presigned URLs. Mocks `glob`, `node-fetch`, `fs`.
- Returns early when no demos found
- Returns early when network limit is 0
- Requests presigned URL for each demo
- Skips demo on 409 (map unfinished)
- Deletes demo on 406 (already uploaded)
- Deletes demo on 410 (map not found)
- Notifies API after successful upload
- Logs error on presigned URL failure
- Logs error on fetch exception

#### `src/system/system.service.spec.ts` — System Metrics Parsing (20 tests)
Tests regex patterns and parsing logic for CPU/memory metrics. No service instantiation.
- CPU MHz parsing from /proc/cpuinfo
- CPU model GHz extraction
- dmidecode speed parsing
- lscpu max MHz parsing
- CPU governor path parsing

---

### Stub Tests (4 files)

The following spec files contain only the default NestJS "should be defined" test:

- `system.controller.spec.ts`
- `offline-matches.controller.spec.ts`
- `kubernetes.service.spec.ts`

---

## Per-File Coverage

| File | Lines | Functions | Notes |
|------|-------|-----------|-------|
| `offline-matches.service.ts` | 100% | 100% | Fully covered |
| `rcon.gateway.ts` | 100% | 100% | Fully covered |
| `throttle.ts` | 95% | 100% | |
| `demos.service.ts` | 92% | 67% | |
| `rcon.service.ts` | 87% | 100% | |
| `network.service.ts` | 81% | 76% | |
| `file-operations.service.ts` | 78% | 93% | |
| `webrtc.service.ts` | 67% | 50% | |
| `redis-manager.service.ts` | 56% | 45% | |

---

## CI/CD

GitHub Actions workflow (`.github/workflows/test.yml`) runs on push/PR to `main` and `develop`:
- Single `unit-tests` job: checkout → setup Node 20 → yarn install → jest with coverage → upload coverage artifact

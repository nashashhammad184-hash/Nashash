# Kayan AI Productions - Cinematic Enterprise Engine

Welcome to the official technical documentation for **Kayan AI Productions**, an advanced monolithic cinematic engine powered by Node.js, TypeScript, pnpm workspaces, and PostgreSQL.

---

## 🏗️ Architecture & Frameworks

The ecosystem is built using an enterprise monorepo workspace structured around micro-modules and clean dependency separation:
- **Core Database Layer (`lib/db`)**: Built using PostgreSQL and Drizzle ORM mapping the schema objects cleanly with strict constraints.
- **Backend API Server (`artifacts/api-server`)**: Express.js REST API with Type-safe compilers utilizing Zod schemas for input validation and TypeScript definitions for absolute consistency.
- **Frontend Studio Dashboard (`artifacts/studio`)**: Next.js / React-based interactive terminal used for timeline choreography, script processing, and cinematic rendering control.

---

## ⚡ Run Commands

### Development Mode
To clear typechecking or spin up environments across modules:
```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```

### Production Build & Assembly
To build and run the stable server runtime with zero performance memory leaks on AWS Free Tier:
```bash
pnpm --filter @workspace/api-server build
node artifacts/api-server/dist/index.mjs
```

---

## 🔐 Environment Variables (.env)

The root environment requires secure parameter bindings strictly managed in a hidden config matrix:
- \`DATABASE_URL\`: The underlying PostgreSQL transactional connection URI string.
- \`ALLOWED_ORIGINS\`: Comma-separated trusted origin domains enabled by the CORS gate (allows adaptive compilation locally during dev).
- \`ELEVENLABS_API_KEY\`: Enterprise API authentication vault utilized by the Voice Generation Pipeline.
- \`VIDEO_API_KEY\` & \`VIDEO_API_URL\`: Target configuration pointers routing live AI generation workloads to vendors like RunwayML.

---

## 🗄️ Database Schema & Storage Entities

The storage matrix maps the full lifecycle of an asset with Zero Data Loss preservation criteria:
1. **\`projects\`**: Top-level directory holding titles, world settings parameters, and synopsis structures.
2. **\`actors\`**: Global repository registering name records, classifications, and biometric properties.
3. **\`project_actors\`**: Intermediary junction mapping assignments cleanly with strict independent relation delete scopes.
4. **\`production_tasks\`**: Choreography engine task allocations featuring defensive \`assigned_actor_id\` bindings (\`ON DELETE SET NULL\`).
5. **\`shots\`**: Central scene layout recording descriptions, dialogues, audio tokens, and active generation pipelines tracking structures.
6. **\`timeline_and_render\`**: Unified sequence compilation database recording render queues and assembly logs.

---

## 🛣️ API Endpoints Roadmap

All API resource boundaries are routed strictly from the core server context:
- \`GET /api/projects/:id\` - Fetch project definitions and dependencies safely.
- \`POST /api/shots/:id/generate-voice\` - Safe pipeline processing text-to-speech rendering utilizing environment vaults.
- \`POST /api/shots/:id/generate-lipsync\` - Mapped multi-state lifecycle pipeline resolving voice and video synthesis.
- \`POST /api/shots/:id/characters\` - Assigns a character role structure to a dynamic cinematic shot matrix.

---

## 🎙️ Script Engine & Voice Pipeline

The pipeline transforms written textual literature into physical high-fidelity media assets:
- **Cinematic Production Guard**: Built-in production protection validators instantly reject placeholder identifiers or test IDs.
- **LipSync Enforcement Protocol**: The production gate strictly forbids timelines from being packaged for assembly if a dialogue block exists but the corresponding Lip Sync instance is uncompleted.

---

## 🎬 Video Provider & Final Render Engine

- **Real Assembly Pipeline**: Built entirely around a native \`FFmpeg\` compilation infrastructure that packages video layers, character voices, ambient soundscapes, sound effects, and subtitle tracks.
- **Pixel-Burn Watermarking**: The execution cycle hard-burns the required legal protection text (\`Produced by Kayan AI Productions\`) seamlessly into the binary video frames, completely bypassing vulnerable web frontend HTML overlays.

---

## 🚀 Deployment Specifications

Optimized natively for secure deployment inside lightweight cloud servers (e.g., Ubuntu AWS Free Tier) under the following conditions:
- **Runtime Target**: Node.js ESM compiled using explicit \`.mjs\` targets ensuring strict memory isolation.
- **Gateway Guards**: Built-in CORS authentication validating against active system manifests to secure against memory abuse or server degradation.

# Gift For You

A comprehensive student monitoring ecosystem with three components:

1. **Student Desktop App** (Electron) — Windows .exe that monitors activity and study time
2. **Backend Server** (Node.js + Express) — REST API + WebSocket server
3. **Teacher Dashboard** (Next.js) — Real-time web interface for teachers

## Quick Start

### 1. Server
```bash
cd server
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### 2. Student App
```bash
cd student-app
npm install
npm run dev
```

### 3. Teacher Dashboard
```bash
cd teacher-dashboard
npm install
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` in each project directory and configure as needed.

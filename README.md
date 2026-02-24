# MongoDB API for Job Claiming App

## Setup Instructions

1. **Install MongoDB**
   ```bash
   # On Mac
   brew install mongodb-community
   
   # On Ubuntu/Debian
   sudo apt-get install mongodb
   
   # Start MongoDB
   mongod
   ```

2. **Install Node.js Dependencies**
   ```bash
   cd mongodb-api
   npm install
   ```

3. **Environment Setup**
   Create `.env` file:
   ```
   MONGODB_URI=mongodb://localhost:27017/job-claimer
   JWT_SECRET=your-super-secret-jwt-key-here
   PORT=3001
   ```

4. **Start API Server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - Login user
- `GET /api/users/me` - Get current user
- `GET /api/users` - Get all users (admin only)

### Jobs
- `GET /api/jobs` - Get all jobs
- `POST /api/jobs` - Create new job

## Features

✅ **No CORS Issues** - Built-in CORS support
✅ **Fast Performance** - MongoDB optimized
✅ **Scalable** - No WordPress limitations
✅ **Secure** - JWT authentication
✅ **Simple** - Clean, modern code

## React App Integration

Update your React app to use:
```javascript
const API_BASE = 'http://localhost:3001/api';
```

This gives you complete control over your database and eliminates all WordPress/CORS issues!

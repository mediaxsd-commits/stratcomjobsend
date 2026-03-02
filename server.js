const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS Configuration
const corsOptions = {
  origin: NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, 'https://stratcom-jobs.onrender.com'].filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, process.env.UPLOAD_DIR || 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.pdf');
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 // 5MB limit
  }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schemas
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  createdAt: { type: Date, default: Date.now }
});

const JobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  scope: { type: String, required: true },
  fee: { type: Number, required: true },
  deadline: { type: String, required: true },
  status: { type: String, enum: ['open', 'claimed', 'in-progress', 'completed', 'cancelled'], default: 'open' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  category: { type: String, required: true },
  claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  claimedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  submissionFile: { 
    filename: { type: String },
    originalName: { type: String },
    uploadedAt: { type: Date },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }
});

const ActivityLogSchema = new mongoose.Schema({
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, enum: ['created', 'edited', 'claimed', 'status_changed', 'pdf_submitted', 'deleted'] },
  details: { type: String },
  previousValue: { type: String },
  newValue: { type: String },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Job = mongoose.model('Job', JobSchema);
const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);

// Create default admin user
const createDefaultAdmin = async () => {
  try {
    const existingAdmin = await User.findOne({ email: 'admin@example.com' });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = new User({
        name: 'Admin User',
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'admin',
        createdAt: new Date()
      });
      await admin.save();
      console.log('Default admin user created: admin@example.com / admin123');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
};

// Initialize database
createDefaultAdmin();

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes

// Register user
app.post('/api/users/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      role: role || 'member'
    });
    
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    
    res.status(201).json({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    
    res.json({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      token
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Get all users (admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const users = await User.find().select('name email role');
    res.json(users.map(user => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Update user (admin only)
app.put('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { name, email, role, password } = req.body;
    const updateData = { name, email, role };
    
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Update own profile
app.put('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
      user.password = await bcrypt.hash(newPassword, 10);
    }
    if (name) user.name = name;
    if (email && email !== user.email) {
      const exists = await User.findOne({ email });
      if (exists) return res.status(400).json({ error: 'Email already in use' });
      user.email = email;
    }
    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({ id: user._id.toString(), name: user.name, email: user.email, role: user.role, token });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get activity log for a job
app.get('/api/jobs/:id/activity', authenticateToken, async (req, res) => {
  try {
    const logs = await ActivityLog.find({ jobId: req.params.id })
      .populate('userId', 'name email')
      .sort({ timestamp: -1 });
    res.json(logs.map(log => ({
      id: log._id.toString(),
      jobId: log.jobId.toString(),
      user: log.userId ? { id: log.userId._id.toString(), name: log.userId.name, email: log.userId.email } : null,
      action: log.action,
      details: log.details,
      previousValue: log.previousValue,
      newValue: log.newValue,
      timestamp: log.timestamp
    })));
  } catch (error) {
    console.error('Get activity log error:', error);
    res.status(500).json({ error: 'Failed to get activity log' });
  }
});

// Job routes (with authentication)
app.get('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const { status, category, priority, search } = req.query;
    
    let query = {};
    if (status && status !== 'all') query.status = status;
    if (category && category !== 'all') query.category = category;
    if (priority && priority !== 'all') query.priority = priority;
    if (search) query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } }
    ];
    
    const jobs = await Job.find(query)
      .populate('createdBy', 'name email')
      .populate('claimedBy', 'name email')
      .sort({ createdAt: -1 });
    
    // Transform MongoDB documents to include id field and format populated objects
    const transformedJobs = jobs.map(job => {
      const jobObj = job.toObject();
      return {
        ...jobObj,
        id: job._id.toString(),
        createdBy: jobObj.createdBy ? {
          id: jobObj.createdBy._id?.toString() || jobObj.createdBy.id,
          name: jobObj.createdBy.name,
          email: jobObj.createdBy.email
        } : null,
        claimedBy: jobObj.claimedBy ? {
          id: jobObj.claimedBy._id?.toString() || jobObj.claimedBy.id,
          name: jobObj.claimedBy.name,
          email: jobObj.claimedBy.email
        } : null,
        submissionFile: jobObj.submissionFile ? {
          ...jobObj.submissionFile,
          uploadedBy: jobObj.submissionFile.uploadedBy ? {
            id: jobObj.submissionFile.uploadedBy._id?.toString() || jobObj.submissionFile.uploadedBy.id,
            name: jobObj.submissionFile.uploadedBy.name,
            email: jobObj.submissionFile.uploadedBy.email
          } : null
        } : null
      };
    });
    
    res.json(transformedJobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const jobData = {
      ...req.body,
      createdBy: req.user.userId,
      createdAt: new Date()
    };
    
    const job = new Job(jobData);
    await job.save();

    // Log activity
    await new ActivityLog({ jobId: job._id, userId: req.user.userId, action: 'created', details: `Created job: ${job.title}` }).save();
    
    // Transform MongoDB document to include id field and format populated objects
    const transformedJob = {
      ...job.toObject(),
      id: job._id.toString(),
      createdBy: job.createdBy ? {
        id: job.createdBy._id?.toString() || job.createdBy.id,
        name: job.createdBy.name,
        email: job.createdBy.email
      } : null,
      claimedBy: job.claimedBy ? {
        id: job.claimedBy._id?.toString() || job.claimedBy.id,
        name: job.claimedBy.name,
        email: job.claimedBy.email
      } : null
    };
    
    res.status(201).json(transformedJob);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Get single job
app.get('/api/jobs/:id', authenticateToken, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('claimedBy', 'name email');
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Transform MongoDB document to include id field
    const transformedJob = {
      ...job.toObject(),
      id: job._id.toString()
    };
    
    res.json(transformedJob);
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

// Update job
app.put('/api/jobs/:id', authenticateToken, async (req, res) => {
  try {
    const oldJob = await Job.findById(req.params.id);
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('createdBy', 'name email')
      .populate('claimedBy', 'name email');
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Log activity
    await new ActivityLog({ jobId: job._id, userId: req.user.userId, action: 'edited', details: `Edited job: ${job.title}` }).save();
    
    // Transform MongoDB document to include id field
    const transformedJob = {
      ...job.toObject(),
      id: job._id.toString()
    };
    
    res.json(transformedJob);
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// Delete job
app.delete('/api/jobs/:id', authenticateToken, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Log activity before deletion
    await new ActivityLog({ jobId: job._id, userId: req.user.userId, action: 'deleted', details: `Deleted job: ${job.title}` }).save();

    await Job.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// Claim job
app.post('/api/jobs/:id/claim', authenticateToken, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.status !== 'open') {
      return res.status(400).json({ error: 'Job is not available for claiming' });
    }
    
    job.status = 'claimed';
    job.claimedBy = req.user.userId;
    job.claimedAt = new Date();
    
    await job.save();

    // Log activity
    await new ActivityLog({ jobId: job._id, userId: req.user.userId, action: 'claimed', details: `Claimed job: ${job.title}`, previousValue: 'open', newValue: 'claimed' }).save();
    
    // Populate user info for response
    await job.populate('claimedBy', 'name email');
    
    // Transform MongoDB document to include id field
    const transformedJob = {
      ...job.toObject(),
      id: job._id.toString()
    };
    
    res.json(transformedJob);
  } catch (error) {
    console.error('Claim job error:', error);
    res.status(500).json({ error: 'Failed to claim job' });
  }
});

// Update job status
app.post('/api/jobs/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const previousStatus = job.status;
    job.status = status;
    await job.save();

    // Log activity
    await new ActivityLog({ jobId: job._id, userId: req.user.userId, action: 'status_changed', details: `Status: ${previousStatus} → ${status}`, previousValue: previousStatus, newValue: status }).save();
    
    // Populate user info for response
    await job.populate('claimedBy', 'name email');
    await job.populate('createdBy', 'name email');
    
    // Transform MongoDB document to include id field
    const transformedJob = {
      ...job.toObject(),
      id: job._id.toString()
    };
    
    res.json(transformedJob);
  } catch (error) {
    console.error('Update job status error:', error);
    res.status(500).json({ error: 'Failed to update job status' });
  }
});

// Upload PDF submission for completed job
app.post('/api/jobs/:id/submit', authenticateToken, upload.single('submission'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (job.claimedBy?.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the assigned user can submit work' });
    }
    
    if (job.status !== 'in-progress' && job.status !== 'completed') {
      return res.status(400).json({ error: 'Job must be in progress to submit work' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }
    
    job.submissionFile = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      uploadedAt: new Date(),
      uploadedBy: req.user.userId
    };
    
    job.status = 'completed';
    await job.save();

    // Log activity
    await new ActivityLog({ jobId: job._id, userId: req.user.userId, action: 'pdf_submitted', details: `Submitted PDF: ${req.file.originalname}`, newValue: 'completed' }).save();
    
    await job.populate('submissionFile.uploadedBy', 'name email');
    
    res.json({
      message: 'PDF submitted successfully',
      submissionFile: job.submissionFile
    });
  } catch (error) {
    console.error('Submit PDF error:', error);
    res.status(500).json({ error: 'Failed to submit PDF' });
  }
});

// Download PDF submission
app.get('/api/jobs/:id/download', authenticateToken, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    if (!job.submissionFile) {
      return res.status(404).json({ error: 'No submission file found' });
    }
    
    const filePath = path.join(__dirname, 'uploads', job.submissionFile.filename);
    res.download(filePath, job.submissionFile.originalName);
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ error: 'Failed to download PDF' });
  }
});

// Start server (local development)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MongoDB API server running on port ${PORT}`);
  });
}

// Export for Vercel serverless functions
module.exports = app;

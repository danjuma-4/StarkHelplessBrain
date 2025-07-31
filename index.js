
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Persistent storage file paths
const DATA_DIR = './data';
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Load persistent data
function loadData() {
  try {
    // Load groups
    if (fs.existsSync(GROUPS_FILE)) {
      const groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
      // Convert readBy Sets back from arrays
      Object.values(groupsData).forEach(group => {
        group.messages.forEach(message => {
          message.readBy = new Set(message.readBy || []);
        });
      });
      groups = groupsData;
    } else {
      groups = {
        'general': {
          id: 'general',
          name: 'General',
          messages: [],
          members: []
        }
      };
    }

    // Load registered users
    if (fs.existsSync(USERS_FILE)) {
      registeredUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } else {
      registeredUsers = {};
    }
  } catch (error) {
    console.error('Error loading data:', error);
    // Initialize with defaults if loading fails
    groups = {
      'general': {
        id: 'general',
        name: 'General',
        messages: [],
        members: []
      }
    };
    registeredUsers = {};
  }
}

// Save data to files
function saveData() {
  try {
    // Convert Sets to arrays for JSON serialization
    const groupsToSave = JSON.parse(JSON.stringify(groups, (key, value) => {
      if (key === 'readBy' && value instanceof Set) {
        return Array.from(value);
      }
      return value;
    }));
    
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupsToSave, null, 2));
    fs.writeFileSync(USERS_FILE, JSON.stringify(registeredUsers, null, 2));
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

// Initialize data
let groups = {};
let registeredUsers = {}; // Persistent user accounts
let users = {}; // Currently connected users
let onlineUsers = new Set();
let typingUsers = new Map(); // groupId -> Set of userIds
let messageReadStatus = new Map(); // messageId -> Set of userIds who read it

// Load data on startup
loadData();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// File upload endpoint
app.post('/upload', upload.single('attachment'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    url: `/uploads/${req.file.filename}`
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User authentication and join
  socket.on('user_join', (userData) => {
    const { username, password } = userData;
    
    // Check if user exists and password matches
    if (registeredUsers[username]) {
      if (registeredUsers[username].password !== password) {
        socket.emit('auth_error', { message: 'Invalid password' });
        return;
      }
    } else {
      // Register new user
      registeredUsers[username] = {
        username: username,
        password: password,
        avatar: userData.avatar || '👤',
        joinedAt: new Date().toISOString(),
        totalMessages: 0
      };
      saveData();
    }
    
    // Create session for connected user
    users[socket.id] = {
      id: socket.id,
      username: username,
      avatar: registeredUsers[username].avatar,
      status: userData.status || 'online',
      lastSeen: new Date().toISOString(),
      blockedUsers: new Set(),
      friends: new Set(),
      isRegistered: true
    };
    
    onlineUsers.add(socket.id);
    
    // Join general group by default
    socket.join('general');
    if (!groups['general'].members.includes(username)) {
      groups['general'].members.push(username);
    }
    
    // Send current groups and messages
    socket.emit('groups_list', Object.values(groups));
    socket.emit('messages_history', { 
      groupId: 'general', 
      messages: groups['general'].messages.map(msg => ({
        ...msg,
        readBy: Array.from(msg.readBy || [])
      }))
    });
    socket.emit('online_users', Array.from(onlineUsers).map(id => users[id]).filter(Boolean));
    socket.emit('auth_success', { message: 'Successfully logged in!' });
    
    // Notify others in the group
    socket.to('general').emit('user_joined', {
      user: users[socket.id],
      groupId: 'general'
    });
    
    // Broadcast online status
    io.emit('user_status_change', {
      userId: socket.id,
      status: 'online',
      user: users[socket.id]
    });
  });

  // Send message
  socket.on('send_message', (data) => {
    const { groupId, message, attachment, isEdited = false, originalMessageId } = data;
    const user = users[socket.id];
    
    if (!user || !groups[groupId]) return;
    
    // Stop typing indicator
    if (typingUsers.has(groupId)) {
      typingUsers.get(groupId).delete(socket.id);
      if (typingUsers.get(groupId).size === 0) {
        typingUsers.delete(groupId);
      }
      socket.to(groupId).emit('typing_stop', { userId: socket.id, groupId });
    }
    
    const messageObj = {
      id: originalMessageId || uuidv4(),
      user: user,
      message: message,
      attachment: attachment,
      timestamp: new Date().toISOString(),
      groupId: groupId,
      isEdited: isEdited,
      editedAt: isEdited ? new Date().toISOString() : null,
      readBy: new Set([socket.id]) // Message sender has read it
    };
    
    if (isEdited) {
      // Update existing message
      const messageIndex = groups[groupId].messages.findIndex(m => m.id === originalMessageId);
      if (messageIndex !== -1) {
        groups[groupId].messages[messageIndex] = messageObj;
      }
    } else {
      groups[groupId].messages.push(messageObj);
      // Update user's message count
      if (registeredUsers[user.username]) {
        registeredUsers[user.username].totalMessages++;
      }
    }
    
    messageReadStatus.set(messageObj.id, new Set([socket.id]));
    
    // Save data to persist messages
    saveData();
    
    // Send to all users in the group
    io.to(groupId).emit('new_message', {
      ...messageObj,
      readBy: Array.from(messageObj.readBy)
    });
  });

  // Create new group
  socket.on('create_group', (data) => {
    const { groupName } = data;
    const groupId = uuidv4();
    const user = users[socket.id];
    
    if (!user) return;
    
    groups[groupId] = {
      id: groupId,
      name: groupName,
      messages: [],
      members: [user.username],
      creator: user.username,
      createdAt: new Date().toISOString()
    };
    
    socket.join(groupId);
    
    // Save data to persist group
    saveData();
    
    // Send updated groups list to all users
    io.emit('groups_list', Object.values(groups));
    
    socket.emit('group_created', { groupId, group: groups[groupId] });
  });

  // Join group
  socket.on('join_group', (data) => {
    const { groupId } = data;
    const user = users[socket.id];
    
    if (!user || !groups[groupId]) return;
    
    socket.join(groupId);
    
    if (!groups[groupId].members.includes(user.username)) {
      groups[groupId].members.push(user.username);
      saveData();
    }
    
    // Send message history with readBy converted to arrays
    socket.emit('messages_history', { 
      groupId: groupId, 
      messages: groups[groupId].messages.map(msg => ({
        ...msg,
        readBy: Array.from(msg.readBy || [])
      }))
    });
    
    // Notify others in the group
    socket.to(groupId).emit('user_joined', {
      user: user,
      groupId: groupId
    });
  });

  // Leave group
  socket.on('leave_group', (data) => {
    const { groupId } = data;
    const user = users[socket.id];
    
    if (!user || !groups[groupId]) return;
    
    socket.leave(groupId);
    groups[groupId].members = groups[groupId].members.filter(id => id !== socket.id);
    
    socket.to(groupId).emit('user_left', {
      user: user,
      groupId: groupId
    });
  });

  // Typing indicators
  socket.on('typing_start', (data) => {
    const { groupId } = data;
    if (!typingUsers.has(groupId)) {
      typingUsers.set(groupId, new Set());
    }
    typingUsers.get(groupId).add(socket.id);
    socket.to(groupId).emit('typing_start', { userId: socket.id, user: users[socket.id], groupId });
  });

  socket.on('typing_stop', (data) => {
    const { groupId } = data;
    if (typingUsers.has(groupId)) {
      typingUsers.get(groupId).delete(socket.id);
      if (typingUsers.get(groupId).size === 0) {
        typingUsers.delete(groupId);
      }
    }
    socket.to(groupId).emit('typing_stop', { userId: socket.id, groupId });
  });

  // Message read receipts
  socket.on('mark_message_read', (data) => {
    const { messageId, groupId } = data;
    if (messageReadStatus.has(messageId)) {
      messageReadStatus.get(messageId).add(socket.id);
      // Find the message and update it
      const group = groups[groupId];
      if (group) {
        const message = group.messages.find(m => m.id === messageId);
        if (message) {
          message.readBy.add(socket.id);
          // Notify message sender about read receipt
          io.to(groupId).emit('message_read', {
            messageId,
            userId: socket.id,
            user: users[socket.id]
          });
        }
      }
    }
  });

  // Edit message
  socket.on('edit_message', (data) => {
    const { messageId, newMessage, groupId } = data;
    const group = groups[groupId];
    if (!group) return;
    
    const messageIndex = group.messages.findIndex(m => m.id === messageId && m.user.id === socket.id);
    if (messageIndex !== -1) {
      group.messages[messageIndex].message = newMessage;
      group.messages[messageIndex].isEdited = true;
      group.messages[messageIndex].editedAt = new Date().toISOString();
      
      io.to(groupId).emit('message_edited', {
        messageId,
        newMessage,
        editedAt: group.messages[messageIndex].editedAt
      });
    }
  });

  // Delete message
  socket.on('delete_message', (data) => {
    const { messageId, groupId } = data;
    const group = groups[groupId];
    if (!group) return;
    
    const messageIndex = group.messages.findIndex(m => m.id === messageId && m.user.id === socket.id);
    if (messageIndex !== -1) {
      group.messages.splice(messageIndex, 1);
      messageReadStatus.delete(messageId);
      
      io.to(groupId).emit('message_deleted', { messageId });
    }
  });

  // Pin/unpin message
  socket.on('toggle_pin_message', (data) => {
    const { messageId, groupId } = data;
    const group = groups[groupId];
    if (!group) return;
    
    const message = group.messages.find(m => m.id === messageId);
    if (message) {
      message.isPinned = !message.isPinned;
      io.to(groupId).emit('message_pin_toggled', {
        messageId,
        isPinned: message.isPinned
      });
    }
  });

  // User status update
  socket.on('update_status', (data) => {
    const { status, statusMessage } = data;
    const user = users[socket.id];
    if (user) {
      user.status = status;
      user.statusMessage = statusMessage;
      user.lastSeen = new Date().toISOString();
      
      io.emit('user_status_change', {
        userId: socket.id,
        status,
        statusMessage,
        user
      });
    }
  });

  // Block/unblock user
  socket.on('block_user', (data) => {
    const { targetUserId } = data;
    const user = users[socket.id];
    if (user && users[targetUserId]) {
      user.blockedUsers.add(targetUserId);
      socket.emit('user_blocked', { userId: targetUserId });
    }
  });

  socket.on('unblock_user', (data) => {
    const { targetUserId } = data;
    const user = users[socket.id];
    if (user) {
      user.blockedUsers.delete(targetUserId);
      socket.emit('user_unblocked', { userId: targetUserId });
    }
  });

  // Search functionality
  socket.on('search_messages', (data) => {
    const { query, groupId } = data;
    const group = groups[groupId];
    if (!group) return;
    
    const results = group.messages.filter(message => 
      message.message.toLowerCase().includes(query.toLowerCase()) ||
      message.user.username.toLowerCase().includes(query.toLowerCase())
    );
    
    socket.emit('search_results', { results, query });
  });

  // Archive/unarchive chat
  socket.on('archive_chat', (data) => {
    const { groupId } = data;
    const user = users[socket.id];
    if (user) {
      if (!user.archivedChats) user.archivedChats = new Set();
      user.archivedChats.add(groupId);
      socket.emit('chat_archived', { groupId });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      // Update registered user's last seen
      if (registeredUsers[user.username]) {
        registeredUsers[user.username].lastSeen = new Date().toISOString();
        saveData();
      }
      
      // Update last seen and set offline
      user.lastSeen = new Date().toISOString();
      user.status = 'offline';
      onlineUsers.delete(socket.id);
      
      // Remove from typing indicators
      typingUsers.forEach((userSet, groupId) => {
        if (userSet.has(socket.id)) {
          userSet.delete(socket.id);
          if (userSet.size === 0) {
            typingUsers.delete(groupId);
          }
          io.to(groupId).emit('typing_stop', { userId: socket.id, groupId });
        }
      });
      
      // Broadcast offline status
      io.emit('user_status_change', {
        userId: socket.id,
        status: 'offline',
        user: user
      });
      
      delete users[socket.id];
    }
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat server running on http://0.0.0.0:${PORT}`);
});

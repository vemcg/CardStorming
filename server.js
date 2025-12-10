const express = require('express');
const path = require('path');
const fs = require('fs');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

// Data directory for persistent storage
const DATA_DIR = path.join(__dirname, 'data', 'projects');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Created data directory:', DATA_DIR);
}

// Server-side state - organized by project ID (in-memory, authoritative)
const projects = new Map();

// Track which projects need to be saved (dirty flag per project)
const dirtyProjects = new Set();

// Debounced save - writes dirty projects to disk every 5 seconds
setInterval(() => {
    if (dirtyProjects.size > 0) {
        const projectsToSave = Array.from(dirtyProjects);
        dirtyProjects.clear();

        projectsToSave.forEach(projectId => {
            saveProjectToDisk(projectId);
        });
    }
}, 5000);

// Save a single project to disk
function saveProjectToDisk(projectId) {
    const project = projects.get(projectId);
    if (!project) return;

    const filePath = path.join(DATA_DIR, `${projectId}.json`);
    const serialized = serializeProject(project);
    const data = JSON.stringify(serialized, null, 2);

    fs.writeFile(filePath, data, 'utf8', (err) => {
        if (err) {
            console.error(`Error saving project ${projectId}:`, err);
        } else {
            console.log(`Saved project ${projectId} to disk`);
        }
    });
}

// Load a project from disk
function loadProjectFromDisk(projectId) {
    const filePath = path.join(DATA_DIR, `${projectId}.json`);

    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(data);
            const project = deserializeProject(parsed);
            console.log(`Loaded project ${projectId} from disk`);
            return project;
        }
    } catch (err) {
        console.error(`Error loading project ${projectId}:`, err);
    }

    return null;
}

// Mark project as dirty (needs to be saved)
function markProjectDirty(projectId) {
    dirtyProjects.add(projectId);
}

function getProject(projectId) {
    if (!projects.has(projectId)) {
        // Try to load from disk first
        const savedProject = loadProjectFromDisk(projectId);

        if (savedProject) {
            projects.set(projectId, savedProject);
        } else {
            // Create new project
            projects.set(projectId, {
                projectName: null,
                paletteCards: [],
                viewportCards: [],
                maxZIndex: 1,
                users: new Map() // initials -> {name, socketId}
            });
        }
    }
    return projects.get(projectId);
}

// Normalize z-index values for a project to prevent overflow
// Maintains relative ordering while resetting values to start from 1
function normalizeZIndex(projectId) {
    const project = projects.get(projectId);
    if (!project || project.viewportCards.length === 0) return;

    // Sort cards by current z-index
    const sortedCards = [...project.viewportCards].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    // Reassign z-index values starting from 1
    sortedCards.forEach((card, index) => {
        card.zIndex = index + 1;
    });

    // Update maxZIndex
    project.maxZIndex = sortedCards.length;

    console.log(`Normalized z-index for project ${projectId}: ${project.viewportCards.length} cards, maxZIndex reset to ${project.maxZIndex}`);

    markProjectDirty(projectId);
}

// Convert Map to plain object for JSON serialization
function serializeProject(project) {
    return {
        ...project,
        users: Array.from(project.users.entries()).map(([initials, data]) => ({
            initials,
            name: data.name
        }))
    };
}

// Convert plain object back to Map
function deserializeProject(data) {
    const users = new Map();
    if (data.users && Array.isArray(data.users)) {
        data.users.forEach(u => users.set(u.initials, { name: u.name, socketId: null }));
    }
    return {
        ...data,
        users
    };
}

// Serve static files
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin route to reset all projects
app.post('/api/reset', (req, res) => {
    projects.clear();
    console.log('All projects have been reset');
    res.json({ success: true, message: 'All projects cleared' });
});

// GET endpoint for browser access
app.get('/api/reset', (req, res) => {
    projects.clear();
    console.log('All projects have been reset');
    res.send('<html><body><h1>Database Reset Complete</h1><p>All projects have been cleared.</p><p><a href="/">Return to CardStorming</a></p></body></html>');
});

// WebSocket connection handling
io.on('connection', (socket) => {
    const projectId = socket.handshake.query.projectId || 'default';
    console.log('Client connected:', socket.id, 'Project:', projectId);

    // Join project room
    socket.join(projectId);

    // Send current state to newly connected client
    const project = getProject(projectId);
    socket.emit('state:init', project);

    // Handle user validation (check if initials are available)
    socket.on('user:validate', (data, callback) => {
        const project = getProject(data.projectId);
        const existingUser = project.users.get(data.initials);

        // User exists and is currently active (has socketId)
        if (existingUser && existingUser.socketId) {
            callback({
                available: false,
                existingName: existingUser.name,
                isActive: true
            });
            return;
        }

        // User exists but is not currently active (returning user)
        if (existingUser && !existingUser.socketId) {
            callback({
                available: true,
                existingName: existingUser.name,
                isReturning: true
            });
            return;
        }

        // Initials are completely new
        callback({
            available: true,
            existingName: null,
            isReturning: false
        });
    });

    // Handle user registration
    socket.on('user:register', (data, callback) => {
        const project = getProject(data.projectId);
        const existingUser = project.users.get(data.initials);

        // Check if initials are actively taken by another socket
        if (existingUser && existingUser.socketId && existingUser.socketId !== socket.id) {
            callback({ success: false, message: 'Initials already taken by active user' });
            return;
        }

        // If user exists (returning user), verify name matches
        if (existingUser && existingUser.name !== data.name) {
            callback({ success: false, message: `These initials belong to "${existingUser.name}"` });
            return;
        }

        // Register or re-register user
        project.users.set(data.initials, {
            name: data.name,
            socketId: socket.id
        });

        markProjectDirty(data.projectId);

        console.log(`User registered: ${data.initials} (${data.name}) in project ${data.projectId}`);

        callback({ success: true });
    });

    // Handle project rename
    socket.on('project:rename', (data) => {
        const project = getProject(data.projectId);
        project.projectName = data.name;
        markProjectDirty(data.projectId);
        io.to(data.projectId).emit('project:renamed', { name: data.name });
    });

    // Handle palette card creation
    socket.on('palette:add', (cardData) => {
        const project = getProject(projectId);
        project.paletteCards.push(cardData);
        markProjectDirty(projectId);
        io.to(projectId).emit('palette:add', cardData);
    });

    // Handle viewport card creation
    socket.on('viewport:add', (cardData) => {
        const project = getProject(projectId);

        // Check if we need to normalize z-index (prevent overflow)
        if (project.maxZIndex > 5000) {
            normalizeZIndex(projectId);
            io.to(projectId).emit('state:sync', project);
        }

        project.maxZIndex++;
        cardData.zIndex = project.maxZIndex;
        project.viewportCards.push(cardData);
        markProjectDirty(projectId);
        io.to(projectId).emit('viewport:add', cardData);
    });

    // Handle viewport card update (edit)
    socket.on('viewport:update', (data) => {
        const project = getProject(projectId);
        const { id, header, body } = data;
        const card = project.viewportCards.find(c => c.id === id);
        if (card) {
            // Check if we need to normalize z-index (prevent overflow)
            if (project.maxZIndex > 5000) {
                normalizeZIndex(projectId);
                io.to(projectId).emit('state:sync', project);
            }

            card.header = header;
            card.body = body;
            project.maxZIndex++;
            card.zIndex = project.maxZIndex;
            markProjectDirty(projectId);
            io.to(projectId).emit('viewport:update', { id, header, body, zIndex: card.zIndex });
        }
    });

    // Handle viewport card move
    socket.on('viewport:move', (data) => {
        const project = getProject(projectId);
        const { id, left, top } = data;
        const card = project.viewportCards.find(c => c.id === id);
        if (card) {
            // Check if we need to normalize z-index (prevent overflow)
            if (project.maxZIndex > 5000) {
                normalizeZIndex(projectId);
                io.to(projectId).emit('state:sync', project);
            }

            card.left = left;
            card.top = top;
            project.maxZIndex++;
            card.zIndex = project.maxZIndex;
            markProjectDirty(projectId);
            io.to(projectId).emit('viewport:move', { id, left, top, zIndex: card.zIndex });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // Clear socketId for this user but keep them in the users list
        const project = getProject(projectId);
        for (const [initials, userData] of project.users.entries()) {
            if (userData.socketId === socket.id) {
                userData.socketId = null;
                console.log(`User ${initials} (${userData.name}) disconnected but remains in project`);
                markProjectDirty(projectId);
            }
        }
    });
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`CardStorming server running on http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the server');
});

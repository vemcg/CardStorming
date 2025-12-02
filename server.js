const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

// Server-side state - organized by project ID
const projects = new Map();

function getProject(projectId) {
    if (!projects.has(projectId)) {
        projects.set(projectId, {
            projectName: null,
            paletteCards: [],
            viewportCards: [],
            maxZIndex: 1
        });
    }
    return projects.get(projectId);
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

    // Handle project rename
    socket.on('project:rename', (data) => {
        const project = getProject(data.projectId);
        project.projectName = data.name;
        io.to(data.projectId).emit('project:renamed', { name: data.name });
    });

    // Handle palette card creation
    socket.on('palette:add', (cardData) => {
        const project = getProject(projectId);
        project.paletteCards.push(cardData);
        io.to(projectId).emit('palette:add', cardData);
    });

    // Handle viewport card creation
    socket.on('viewport:add', (cardData) => {
        const project = getProject(projectId);
        project.maxZIndex++;
        cardData.zIndex = project.maxZIndex;
        project.viewportCards.push(cardData);
        io.to(projectId).emit('viewport:add', cardData);
    });

    // Handle viewport card update (edit)
    socket.on('viewport:update', (data) => {
        const project = getProject(projectId);
        const { id, header, body } = data;
        const card = project.viewportCards.find(c => c.id === id);
        if (card) {
            card.header = header;
            card.body = body;
            project.maxZIndex++;
            card.zIndex = project.maxZIndex;
            io.to(projectId).emit('viewport:update', { id, header, body, zIndex: card.zIndex });
        }
    });

    // Handle viewport card move
    socket.on('viewport:move', (data) => {
        const project = getProject(projectId);
        const { id, left, top } = data;
        const card = project.viewportCards.find(c => c.id === id);
        if (card) {
            card.left = left;
            card.top = top;
            project.maxZIndex++;
            card.zIndex = project.maxZIndex;
            io.to(projectId).emit('viewport:move', { id, left, top, zIndex: card.zIndex });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`CardStorming server running on http://localhost:${PORT}`);
    console.log('Press Ctrl+C to stop the server');
});

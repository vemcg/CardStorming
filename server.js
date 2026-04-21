const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

// MongoDB client (set during startup)
let db = null;

// In-memory cache — loaded from MongoDB at startup, kept authoritative during runtime
const projects = new Map();

// Track which projects need to be persisted
const dirtyProjects = new Set();

// Flush dirty projects to MongoDB every 5 seconds
setInterval(async () => {
    if (!db || dirtyProjects.size === 0) return;
    const toSave = Array.from(dirtyProjects);
    dirtyProjects.clear();
    for (const projectId of toSave) {
        await saveProjectToDb(projectId).catch(err =>
            console.error(`Error saving project ${projectId}:`, err)
        );
    }
}, 5000);

async function saveProjectToDb(projectId) {
    if (!db) return;
    const project = projects.get(projectId);
    if (!project) return;
    const serialized = serializeProject(project);
    await db.collection('projects').updateOne(
        { _id: projectId },
        { $set: serialized },
        { upsert: true }
    );
    console.log(`Saved project ${projectId} to MongoDB`);
}

function markProjectDirty(projectId) {
    dirtyProjects.add(projectId);
}

// Immediate save (used for deletes — fire-and-forget but logged)
function saveProjectNow(projectId) {
    saveProjectToDb(projectId).catch(err =>
        console.error(`Error in saveProjectNow for ${projectId}:`, err)
    );
}

function getProject(projectId) {
    return projects.get(projectId) || null;
}

// Create a new empty project (used by File > New)
function createProject(projectId) {
    const newProject = {
        version: 2,
        projectName: null,
        paletteCards: [],
        cards: [],
        wormholes: [],
        maxZIndex: 1,
        users: new Map()
    };
    projects.set(projectId, newProject);
    return newProject;
}

// Normalize z-index values for a project to prevent overflow
function normalizeZIndex(projectId) {
    const project = projects.get(projectId);
    if (!project || project.cards.length === 0) return;
    const sortedCards = [...project.cards].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
    sortedCards.forEach((card, index) => { card.zIndex = index + 1; });
    project.maxZIndex = sortedCards.length;
    console.log(`Normalized z-index for project ${projectId}: ${project.cards.length} cards, maxZIndex reset to ${project.maxZIndex}`);
    markProjectDirty(projectId);
}

// Convert Map to plain object for JSON serialization
function serializeProject(project) {
    return {
        ...project,
        users: Array.from(project.users.entries()).map(([initials, data]) => ({
            initials,
            name: data.name,
            userHash: data.userHash
        }))
    };
}

// Convert plain object back to Map and migrate old formats
function deserializeProject(data) {
    const users = new Map();
    if (data.users && Array.isArray(data.users)) {
        data.users.forEach(u => users.set(u.initials, {
            name: u.name,
            userHash: u.userHash,
            socketId: null
        }));
    }

    const currentVersion = data.version || 1;

    if (currentVersion === 1 && data.viewportCards && !data.cards) {
        console.log('Migrating project from v1 to v2 (viewportCards → cards)');
        data.cards = data.viewportCards.map(card => ({
            ...card,
            x: typeof card.left === 'string' ? parseFloat(card.left) : card.left,
            y: typeof card.top === 'string' ? parseFloat(card.top) : card.top
        }));
        delete data.viewportCards;
        data.version = 2;
    }

    if (Array.isArray(data.users) && data.users.length > 0) {
        console.log('Migrating project users from array format');
        data.version = 2;
    }

    return {
        version: data.version || 2,
        ...data,
        users,
        cards: data.cards || [],
        wormholes: data.wormholes || [],
        paletteCards: data.paletteCards || []
    };
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

function generateUserHash(email) {
    return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

async function saveUserToDb(userHash, userData) {
    if (!db) return false;
    await db.collection('users').updateOne(
        { _id: userHash },
        { $set: { ...userData, _id: userHash } },
        { upsert: true }
    );
    return true;
}

async function loadUserFromDb(userHash) {
    if (!db) return null;
    const doc = await db.collection('users').findOne({ _id: userHash });
    if (!doc) return null;
    const { _id, ...userData } = doc;
    return userData;
}

async function createUser(email, name, initials) {
    const userHash = generateUserHash(email);
    const existing = await loadUserFromDb(userHash);
    if (existing) {
        console.log(`User ${userHash} already exists`);
        return { userHash, user: existing, isNew: false };
    }
    const userData = {
        userHash,
        email: email.toLowerCase().trim(),
        defaultName: name.trim(),
        defaultInitials: initials.trim().toUpperCase(),
        projects: [],
        identities: {}
    };
    await saveUserToDb(userHash, userData);
    console.log(`Created new user ${userHash}`);
    return { userHash, user: userData, isNew: true };
}

async function addProjectToUser(userHash, projectHash) {
    if (!db) return false;
    await db.collection('users').updateOne(
        { _id: userHash },
        { $addToSet: { projects: projectHash } }
    );
    return true;
}

async function addIdentityToUser(userHash, projectHash, name, initials) {
    if (!db) return false;
    await db.collection('users').updateOne(
        { _id: userHash },
        { $set: { [`identities.${projectHash}`]: { name: name.trim(), initials: initials.trim().toUpperCase() } } }
    );
    return true;
}

async function getUserIdentities(userHash) {
    const userData = await loadUserFromDb(userHash);
    if (!userData) return [];
    const identities = [{
        name: userData.defaultName,
        initials: userData.defaultInitials,
        isDefault: true
    }];
    const seen = new Set([`${userData.defaultName}|${userData.defaultInitials}`]);
    for (const [, identity] of Object.entries(userData.identities || {})) {
        const key = `${identity.name}|${identity.initials}`;
        if (!seen.has(key)) {
            identities.push({ name: identity.name, initials: identity.initials, isDefault: false });
            seen.add(key);
        }
    }
    return identities;
}

// Check if name/initials pair conflicts with existing users in project
function checkIdentityConflict(projectHash, name, initials, excludeUserHash = null) {
    const project = getProject(projectHash);
    if (!project.users) project.users = new Map();
    const normalizedInitials = initials.trim().toUpperCase();
    for (const [userInitials, userData] of project.users.entries()) {
        if (userInitials === normalizedInitials) {
            if (excludeUserHash && userData.userHash === excludeUserHash) return { conflict: false };
            if (!userData.userHash && excludeUserHash) return { conflict: false };
            return { conflict: true, existingName: userData.name, existingInitials: userInitials };
        }
    }
    return { conflict: false };
}

// Add user to project ACL
function addUserToProject(projectHash, userHash, name, initials) {
    const project = getProject(projectHash);
    if (!project) return { success: false, error: 'Project not found' };
    if (!project.users) project.users = new Map();
    const normalizedInitials = initials.trim().toUpperCase();
    const conflictCheck = checkIdentityConflict(projectHash, name, normalizedInitials, userHash);
    if (conflictCheck.conflict) {
        return {
            success: false,
            error: 'CONFLICT',
            message: `Initials "${normalizedInitials}" already used by ${conflictCheck.existingName}`
        };
    }
    project.users.set(normalizedInitials, { userHash, name: name.trim(), socketId: null });
    markProjectDirty(projectHash);
    console.log(`Added user ${userHash} to project ${projectHash} as ${name} (${normalizedInitials})`);
    return { success: true };
}

// Get user's identity in a specific project
async function getUserIdentityInProject(userHash, projectHash) {
    const project = getProject(projectHash);
    if (!project || !project.users) return null;
    let migrated = false;
    for (const [initials, userData] of project.users.entries()) {
        if (userData.userHash === userHash) {
            return { name: userData.name, initials };
        } else if (!userData.userHash) {
            const user = await loadUserFromDb(userHash);
            if (user) {
                const matchesProjectIdentity = user.identities && user.identities[projectHash] &&
                    user.identities[projectHash].initials === initials &&
                    user.identities[projectHash].name === userData.name;
                const matchesDefaultIdentity = !(user.identities && user.identities[projectHash]) &&
                    user.defaultInitials === initials &&
                    user.defaultName === userData.name;
                if (matchesProjectIdentity || matchesDefaultIdentity) {
                    userData.userHash = userHash;
                    migrated = true;
                    console.log(`Migrated user entry in project ${projectHash}: ${userData.name} (${initials}) now owned by ${userHash}`);
                    if (!(user.identities && user.identities[projectHash])) {
                        await addProjectToUser(userHash, projectHash);
                        await addIdentityToUser(userHash, projectHash, userData.name, initials);
                    }
                    if (migrated) markProjectDirty(projectHash);
                    return { name: userData.name, initials };
                }
            }
        }
    }
    return null;
}

// Get all identities a user has in a specific project
async function getUserIdentitiesInProject(userHash, projectHash) {
    const project = getProject(projectHash);
    if (!project || !project.users) return [];
    const identities = [];
    let migrated = false;
    for (const [initials, userData] of project.users.entries()) {
        if (userData.userHash === userHash) {
            identities.push({ name: userData.name, initials });
        } else if (!userData.userHash) {
            const user = await loadUserFromDb(userHash);
            if (user) {
                const matchesProjectIdentity = user.identities && user.identities[projectHash] &&
                    user.identities[projectHash].initials === initials &&
                    user.identities[projectHash].name === userData.name;
                const matchesDefaultIdentity = !(user.identities && user.identities[projectHash]) &&
                    user.defaultInitials === initials &&
                    user.defaultName === userData.name;
                if (matchesProjectIdentity || matchesDefaultIdentity) {
                    userData.userHash = userHash;
                    migrated = true;
                    identities.push({ name: userData.name, initials });
                    console.log(`Migrated user entry in project ${projectHash}: ${userData.name} (${initials}) now owned by ${userHash}`);
                    if (!(user.identities && user.identities[projectHash])) {
                        await addProjectToUser(userHash, projectHash);
                        await addIdentityToUser(userHash, projectHash, userData.name, initials);
                    }
                }
            }
        }
    }
    if (migrated) markProjectDirty(projectHash);
    return identities;
}

// Middleware
app.use(express.json());

// Serve static files with correct MIME types for ES6 modules
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) res.set('Content-Type', 'application/javascript');
    }
}));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// USER API ENDPOINTS
// ============================================================================

// Register new user or get existing user
app.post('/api/user/register', async (req, res) => {
    const { email, name, initials } = req.body;
    if (!email || !name || !initials) {
        return res.status(400).json({ error: 'Missing required fields', required: ['email', 'name', 'initials'] });
    }
    const result = await createUser(email, name, initials);
    res.json(result);
});

// Get user profile
app.get('/api/user/:userHash', async (req, res) => {
    const { userHash } = req.params;
    const userData = await loadUserFromDb(userHash);
    if (!userData) return res.status(404).json({ error: 'User not found' });
    res.json(userData);
});

// Get all available identities for a user
app.get('/api/user/:userHash/identities', async (req, res) => {
    const { userHash } = req.params;
    const identities = await getUserIdentities(userHash);
    if (identities.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ identities });
});

// Get user's projects
app.get('/api/user/:userHash/projects', async (req, res) => {
    const { userHash } = req.params;
    const userData = await loadUserFromDb(userHash);
    if (!userData) return res.status(404).json({ error: 'User not found' });
    res.json({ projects: userData.projects });
});

// Check if identity conflicts in a project
app.post('/api/project/:projectHash/check-identity', (req, res) => {
    const { projectHash } = req.params;
    const { name, initials, userHash } = req.body;
    if (!initials) return res.status(400).json({ error: 'Missing initials' });
    const result = checkIdentityConflict(projectHash, name, initials, userHash);
    res.json(result);
});

// Add user to project (join project)
app.post('/api/project/:projectHash/users', async (req, res) => {
    const { projectHash } = req.params;
    const { userHash, name, initials } = req.body;
    if (!userHash || !name || !initials) {
        return res.status(400).json({ error: 'Missing required fields', required: ['userHash', 'name', 'initials'] });
    }
    const result = addUserToProject(projectHash, userHash, name, initials);
    if (result.success) {
        await addProjectToUser(userHash, projectHash);
        await addIdentityToUser(userHash, projectHash, name, initials);
    }
    res.json(result);
});

// Remove user from project (leave project)
app.post('/api/project/:projectHash/user/:userHash/leave', async (req, res) => {
    const { projectHash, userHash } = req.params;
    const project = getProject(projectHash);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.users) {
        const removed = [];
        for (const [initials, userData] of project.users.entries()) {
            if (userData.userHash === userHash) {
                project.users.delete(initials);
                removed.push(initials);
            }
        }
        if (removed.length > 0) {
            markProjectDirty(projectHash);
            console.log(`User ${userHash} left project ${projectHash} (removed identities: ${removed.join(', ')})`);
        }
    }

    if (db) {
        await db.collection('users').updateOne(
            { _id: userHash },
            {
                $pull: { projects: projectHash },
                $unset: { [`identities.${projectHash}`]: '' }
            }
        );
        console.log(`Removed project ${projectHash} from user ${userHash}`);
    }

    res.json({ success: true, message: 'Left project successfully' });
});

// Get user's identities in a specific project
app.get('/api/project/:projectHash/user/:userHash/identities', async (req, res) => {
    const { projectHash, userHash } = req.params;
    const identities = await getUserIdentitiesInProject(userHash, projectHash);
    res.json({ identities });
});

// Get all users in a project
app.get('/api/project/:projectHash/users', (req, res) => {
    const { projectHash } = req.params;
    const project = getProject(projectHash);
    if (!project || !project.users) return res.json({ users: [] });
    const users = Array.from(project.users.entries()).map(([initials, userData]) => ({
        initials,
        name: userData.name,
        userHash: userData.userHash
    }));
    res.json({ users });
});

// Get list of all projects with user counts
app.get('/api/projects/list', (req, res) => {
    try {
        const projectsList = Array.from(projects.entries()).map(([projectId, project]) => {
            let userCount = 0;
            if (project.users instanceof Map) {
                for (const [, userData] of project.users.entries()) {
                    if (userData.userHash) userCount++;
                }
            }
            return { id: projectId, name: project.projectName || 'Unnamed Project', userCount };
        });
        res.json({ projects: projectsList });
    } catch (err) {
        console.error('Error listing projects:', err);
        res.status(500).json({ error: 'Failed to list projects' });
    }
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

// List all projects endpoint
app.get('/api/projects', (req, res) => {
    try {
        const projectList = Array.from(projects.entries()).map(([projectId, project]) => ({
            id: projectId,
            name: project.projectName || 'Unnamed Project',
            cardCount: project.cards ? project.cards.length : 0,
            wormholeCount: project.wormholes ? project.wormholes.length : 0
        }));
        res.json({ success: true, projects: projectList });
    } catch (err) {
        console.error('Error listing projects:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Export a project as a self-contained JSON file
app.get('/api/project/:projectId/export', (req, res) => {
    const { projectId } = req.params;
    const project = getProject(projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    const serialized = serializeProject(project);
    const exportData = {
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        projectName: project.projectName || 'Unnamed Project',
        cards: serialized.cards || [],
        wormholes: serialized.wormholes || [],
        paletteCards: serialized.paletteCards || []
    };
    const filename = (project.projectName || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.cardstorming.json';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
});

// Import a project from an exported JSON file
app.post('/api/project/import', express.json({ limit: '10mb' }), (req, res) => {
    try {
        const { exportData, projectName } = req.body;
        if (!exportData) return res.status(400).json({ success: false, error: 'No export data provided' });
        const newId = crypto.randomBytes(8).toString('hex') + Date.now().toString(36);
        const newProject = {
            version: 2,
            projectName: projectName || exportData.projectName || 'Imported Project',
            cards: exportData.cards || [],
            wormholes: exportData.wormholes || [],
            paletteCards: exportData.paletteCards || [],
            users: new Map()
        };
        projects.set(newId, newProject);
        saveProjectNow(newId);
        res.json({ success: true, projectId: newId, projectName: newProject.projectName });
    } catch (err) {
        console.error('Error importing project:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// WebSocket connection handling
io.on('connection', (socket) => {
    let projectId = socket.handshake.query.projectId;

    if (projectId) {
        console.log('Client connected:', socket.id, 'Project:', projectId);
        socket.join(projectId);
        const project = getProject(projectId);
        if (!project) {
            console.log(`Project ${projectId} not found - not sending state:init`);
        } else {
            console.log(`Sending state to client. Wormholes in project: ${project.wormholes ? project.wormholes.length : 0}`);
            if (project.wormholes && project.wormholes.length > 0) console.log('Wormholes:', project.wormholes);
            socket.emit('state:init', project);
        }
    } else {
        console.log('Client connected without project ID:', socket.id);
    }

    socket.on('project:join', (data) => {
        const { projectId: newProjectId } = data;
        console.log(`Client ${socket.id} switching to project:`, newProjectId);
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => { if (room !== socket.id) socket.leave(room); });
        socket.join(newProjectId);
        projectId = newProjectId;
        let newProject = getProject(newProjectId);
        if (!newProject) {
            console.log(`Creating new project: ${newProjectId}`);
            newProject = createProject(newProjectId);
        }
        socket.emit('state:init', newProject);
    });

    socket.on('user:validate', (data, callback) => {
        const project = getProject(data.projectId);
        const existingUser = project.users.get(data.initials);
        if (existingUser && existingUser.socketId) {
            callback({ available: false, existingName: existingUser.name, isActive: true });
            return;
        }
        if (existingUser && !existingUser.socketId) {
            callback({ available: true, existingName: existingUser.name, isReturning: true });
            return;
        }
        callback({ available: true, existingName: null, isReturning: false });
    });

    socket.on('user:register', async (data, callback) => {
        console.log(`user:register received:`, {
            initials: data.initials, name: data.name, projectId: data.projectId,
            userHash: data.userHash, hasUserHash: !!data.userHash
        });
        const project = getProject(data.projectId);
        const existingUser = project.users.get(data.initials);
        if (existingUser && existingUser.socketId && existingUser.socketId !== socket.id) {
            callback({ success: false, message: 'Initials already taken by active user' });
            return;
        }
        if (existingUser && existingUser.name !== data.name) {
            callback({ success: false, message: `These initials belong to "${existingUser.name}"` });
            return;
        }
        project.users.set(data.initials, { name: data.name, socketId: socket.id, userHash: data.userHash });
        markProjectDirty(data.projectId);
        console.log(`User registered: ${data.initials} (${data.name}) in project ${data.projectId}`);
        if (data.userHash) {
            await addProjectToUser(data.userHash, data.projectId);
            await addIdentityToUser(data.userHash, data.projectId, data.name, data.initials);
            console.log(`Added identity for project ${data.projectId} to user ${data.userHash}`);
        } else {
            console.warn(`No userHash provided in user:register for ${data.initials} - identity will not be saved`);
        }
        callback({ success: true });
    });

    socket.on('project:rename', (data) => {
        const project = getProject(data.projectId);
        project.projectName = data.name;
        markProjectDirty(data.projectId);
        io.to(data.projectId).emit('project:renamed', { name: data.name });
    });

    socket.on('palette:add', (cardData) => {
        const project = getProject(projectId);
        project.paletteCards.push(cardData);
        markProjectDirty(projectId);
        io.to(projectId).emit('palette:add', cardData);
    });

    socket.on('viewport:add', (cardData) => {
        const project = getProject(projectId);
        if (project.maxZIndex > 5000) {
            normalizeZIndex(projectId);
            io.to(projectId).emit('state:sync', project);
        }
        project.maxZIndex++;
        cardData.zIndex = project.maxZIndex;
        project.cards.push(cardData);
        markProjectDirty(projectId);
        io.to(projectId).emit('viewport:add', cardData);
    });

    socket.on('viewport:update', (data) => {
        const project = getProject(projectId);
        if (!project) {
            console.error('viewport:update: project not found', { projectId });
            return;
        }
        const { id, header, body } = data;
        const card = project.cards.find(c => c.id === id);
        if (card) {
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

    socket.on('viewport:move', (data) => {
        const project = getProject(projectId);
        if (!project) return;
        const { id, x, y } = data;
        const card = project.cards.find(c => c.id === id);
        if (card) {
            if (project.maxZIndex > 5000) {
                normalizeZIndex(projectId);
                io.to(projectId).emit('state:sync', project);
            }
            card.x = x;
            card.y = y;
            project.maxZIndex++;
            card.zIndex = project.maxZIndex;
            markProjectDirty(projectId);
            io.to(projectId).emit('viewport:move', { id, x, y, zIndex: card.zIndex });
        }
    });

    socket.on('card:delete', (data) => {
        const project = getProject(projectId);
        const { id } = data;
        const cardIndex = project.cards.findIndex(c => c.id === id);
        if (cardIndex !== -1) {
            project.cards.splice(cardIndex, 1);
            markProjectDirty(projectId);
            io.to(projectId).emit('card:delete', { id });
        }
    });

    socket.on('viewport:clear', () => {
        const project = getProject(projectId);
        project.cards = [];
        project.wormholes = [];
        markProjectDirty(projectId);
        io.to(projectId).emit('viewport:clear');
    });

    socket.on('wormhole:add', (wormholeData) => {
        const project = getProject(projectId);
        if (project.maxZIndex > 5000) {
            normalizeZIndex(projectId);
            io.to(projectId).emit('state:sync', project);
        }
        project.maxZIndex++;
        wormholeData.zIndex = project.maxZIndex;
        console.log(`Wormhole added to project ${projectId}:`, wormholeData);
        console.log(`Total wormholes in project: ${project.wormholes.length + 1}`);
        project.wormholes.push(wormholeData);
        markProjectDirty(projectId);
        io.to(projectId).emit('wormhole:add', wormholeData);
    });

    socket.on('wormhole:move', (data) => {
        const project = getProject(projectId);
        const { id, x, y } = data;
        const wormhole = project.wormholes.find(w => w.id === id);
        if (wormhole) {
            if (project.maxZIndex > 5000) {
                normalizeZIndex(projectId);
                io.to(projectId).emit('state:sync', project);
            }
            wormhole.x = x;
            wormhole.y = y;
            project.maxZIndex++;
            wormhole.zIndex = project.maxZIndex;
            markProjectDirty(projectId);
            io.to(projectId).emit('wormhole:move', { id, x, y, zIndex: wormhole.zIndex });
        }
    });

    socket.on('wormhole:rename', (data) => {
        const project = getProject(projectId);
        const { id, name } = data;
        const wormhole = project.wormholes.find(w => w.id === id);
        if (wormhole) {
            wormhole.name = name;
            markProjectDirty(projectId);
            io.to(projectId).emit('wormhole:rename', { id, name });
            console.log(`Wormhole renamed in project ${projectId}:`, { id, name });
        }
    });

    socket.on('wormhole:delete', (data) => {
        const project = getProject(projectId);
        const { id1, id2 } = data;
        const initialCount = project.wormholes.length;
        project.wormholes = project.wormholes.filter(w => w.id !== id1 && w.id !== id2);
        const finalCount = project.wormholes.length;
        if (finalCount < initialCount) {
            markProjectDirty(projectId);
            io.to(projectId).emit('wormhole:delete', { id1, id2 });
            console.log(`Wormhole pair deleted from project ${projectId}:`, { id1, id2, removed: initialCount - finalCount });
        }
    });

    socket.on('cards:delete-all', (data) => {
        const targetProjectId = data?.projectId || projectId;
        console.log(`[DELETE] Received delete request for project ${targetProjectId}`, data);
        const project = getProject(targetProjectId);
        const cardCount = project.cards.length;
        console.log(`[DELETE] Found ${cardCount} cards in project ${targetProjectId}, clearing...`);
        project.cards = [];
        saveProjectNow(targetProjectId);
        console.log(`[DELETE] All cards deleted from project ${targetProjectId}`);
        io.to(targetProjectId).emit('cards:delete-all');
    });

    socket.on('palette:delete-all', (data) => {
        const targetProjectId = data.projectId || projectId;
        const project = getProject(targetProjectId);
        project.paletteCards = [];
        saveProjectNow(targetProjectId);
        io.to(targetProjectId).emit('palette:delete-all');
        console.log(`All palette cards deleted from project ${targetProjectId}`);
    });

    socket.on('palette:clear', () => {
        const project = getProject(projectId);
        project.paletteCards = [];
        markProjectDirty(projectId);
        io.to(projectId).emit('palette:clear');
    });

    socket.on('project:delete', async (data) => {
        const { projectId: pidToDelete } = data;
        if (pidToDelete && projects.has(pidToDelete)) {
            projects.delete(pidToDelete);
            if (db) {
                await db.collection('projects').deleteOne({ _id: pidToDelete }).catch(err =>
                    console.error(`Error deleting project ${pidToDelete} from MongoDB:`, err)
                );
            }
            console.log(`Project ${pidToDelete} deleted`);
            io.to(pidToDelete).emit('project:deleted');
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        const project = getProject(projectId);
        if (!project || !project.users) return;
        for (const [initials, userData] of project.users.entries()) {
            if (userData.socketId === socket.id) {
                userData.socketId = null;
                console.log(`User ${initials} (${userData.name}) disconnected but remains in project`);
                markProjectDirty(projectId);
            }
        }
    });
});

// ============================================================================
// STARTUP
// ============================================================================

async function initializeDb() {
    const uri = process.env.DATABASE_URL;
    if (!uri) {
        console.warn('DATABASE_URL not set — starting without MongoDB (in-memory only, data will not persist)');
        return;
    }
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db('cardstorming');
    console.log('Connected to MongoDB');

    // Load all projects into memory
    const docs = await db.collection('projects').find({}).toArray();
    for (const doc of docs) {
        const { _id, ...data } = doc;
        projects.set(_id, deserializeProject(data));
    }
    console.log(`Loaded ${docs.length} project(s) from MongoDB`);
}

initializeDb()
    .then(() => {
        httpServer.listen(PORT, () => {
            console.log(`CardStorming server running on http://localhost:${PORT}`);
            console.log('Press Ctrl+C to stop the server');
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });

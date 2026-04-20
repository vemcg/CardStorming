const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const PORT = process.env.PORT || 3000;

// Data directories for persistent storage
const DATA_DIR = path.join(__dirname, 'data', 'projects');
const USERS_DIR = path.join(__dirname, 'data', 'users');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('Created data directory:', DATA_DIR);
}
if (!fs.existsSync(USERS_DIR)) {
    fs.mkdirSync(USERS_DIR, { recursive: true });
    console.log('Created users directory:', USERS_DIR);
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
function saveProjectToDisk(projectId, sync = false) {
    const project = projects.get(projectId);
    if (!project) return;

    const filePath = path.join(DATA_DIR, `${projectId}.json`);
    const serialized = serializeProject(project);
    const data = JSON.stringify(serialized, null, 2);

    if (sync) {
        // Synchronous write for immediate saves (delete operations)
        try {
            fs.writeFileSync(filePath, data, 'utf8');
            console.log(`Saved project ${projectId} to disk (sync)`);
        } catch (err) {
            console.error(`Error saving project ${projectId} (sync):`, err);
        }
    } else {
        // Async write for background saves
        fs.writeFile(filePath, data, 'utf8', (err) => {
            if (err) {
                console.error(`Error saving project ${projectId}:`, err);
            } else {
                console.log(`Saved project ${projectId} to disk`);
            }
        });
    }
}

// Load a project from disk
function loadProjectFromDisk(projectId) {
    const filePath = path.join(DATA_DIR, `${projectId}.json`);

    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(data);

            // Check if migration will occur
            const needsMigration = (!parsed.version || parsed.version === 1) &&
                                  (parsed.viewportCards || (Array.isArray(parsed.users) && parsed.users.length > 0));

            const project = deserializeProject(parsed);
            console.log(`Loaded project ${projectId} from disk`);

            // If project was migrated, mark it dirty so it gets saved
            if (needsMigration) {
                markProjectDirty(projectId);
                console.log(`Project ${projectId} migrated - marked dirty for save`);
            }

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
            // Don't automatically create projects - return null if doesn't exist
            return null;
        }
    }
    return projects.get(projectId);
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
// Maintains relative ordering while resetting values to start from 1
function normalizeZIndex(projectId) {
    const project = projects.get(projectId);
    if (!project || project.cards.length === 0) return;

    // Sort cards by current z-index
    const sortedCards = [...project.cards].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    // Reassign z-index values starting from 1
    sortedCards.forEach((card, index) => {
        card.zIndex = index + 1;
    });

    // Update maxZIndex
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
            userHash: data.userHash // Include userHash for new auth system
        }))
    };
}

// Convert plain object back to Map and migrate old formats
function deserializeProject(data) {
    const users = new Map();
    if (data.users && Array.isArray(data.users)) {
        data.users.forEach(u => users.set(u.initials, {
            name: u.name,
            userHash: u.userHash, // Include userHash if present (new auth system)
            socketId: null
        }));
    }

    // Determine version (old projects won't have this field)
    const currentVersion = data.version || 1;

    // Migrate from v1 to v2 if needed
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

    // Migrate users array to Map if needed (v2 format has users as array in JSON but Map in memory)
    // The 'users' variable above already converted array to Map, so we're good
    // But we should mark old projects that have users array as needing conversion
    if (Array.isArray(data.users) && data.users.length > 0) {
        console.log('Migrating project users from array format');
        // The users Map is already created above from the array, so just mark it as migrated
        data.version = 2;
    }

    return {
        version: data.version || 2, // Default to v2 for new projects
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

// Generate hash from email
function generateUserHash(email) {
    return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

// Save user to disk
function saveUserToDisk(userHash, userData) {
    const filePath = path.join(USERS_DIR, `${userHash}.json`);
    const data = JSON.stringify(userData, null, 2);

    try {
        fs.writeFileSync(filePath, data, 'utf8');
        console.log(`Saved user ${userHash} to disk`);
        return true;
    } catch (err) {
        console.error(`Error saving user ${userHash}:`, err);
        return false;
    }
}

// Load user from disk
function loadUserFromDisk(userHash) {
    const filePath = path.join(USERS_DIR, `${userHash}.json`);

    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const userData = JSON.parse(data);
            console.log(`Loaded user ${userHash} from disk`);
            return userData;
        }
    } catch (err) {
        console.error(`Error loading user ${userHash}:`, err);
    }

    return null;
}

// Create new user
function createUser(email, name, initials) {
    const userHash = generateUserHash(email);

    // Check if user already exists
    const existing = loadUserFromDisk(userHash);
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

    saveUserToDisk(userHash, userData);
    console.log(`Created new user ${userHash}`);

    return { userHash, user: userData, isNew: true };
}

// Add project to user's project list
function addProjectToUser(userHash, projectHash) {
    const userData = loadUserFromDisk(userHash);
    if (!userData) {
        console.error(`User ${userHash} not found`);
        return false;
    }

    if (!userData.projects.includes(projectHash)) {
        userData.projects.push(projectHash);
        saveUserToDisk(userHash, userData);
        console.log(`Added project ${projectHash} to user ${userHash}`);
    }

    return true;
}

// Add identity to user for a specific project
function addIdentityToUser(userHash, projectHash, name, initials) {
    const userData = loadUserFromDisk(userHash);
    if (!userData) {
        console.error(`User ${userHash} not found`);
        return false;
    }

    userData.identities[projectHash] = {
        name: name.trim(),
        initials: initials.trim().toUpperCase()
    };

    saveUserToDisk(userHash, userData);
    console.log(`Added identity for project ${projectHash} to user ${userHash}`);

    return true;
}

// Get all identities for a user (default + project-specific)
function getUserIdentities(userHash) {
    const userData = loadUserFromDisk(userHash);
    if (!userData) return [];

    const identities = [
        {
            name: userData.defaultName,
            initials: userData.defaultInitials,
            isDefault: true
        }
    ];

    // Add unique project-specific identities
    const seen = new Set([`${userData.defaultName}|${userData.defaultInitials}`]);

    for (const [projectHash, identity] of Object.entries(userData.identities)) {
        const key = `${identity.name}|${identity.initials}`;
        if (!seen.has(key)) {
            identities.push({
                name: identity.name,
                initials: identity.initials,
                isDefault: false
            });
            seen.add(key);
        }
    }

    return identities;
}

// Check if name/initials pair conflicts with existing users in project
function checkIdentityConflict(projectHash, name, initials, excludeUserHash = null) {
    const project = getProject(projectHash);
    if (!project.users) {
        project.users = new Map();
    }

    // Convert initials to uppercase for comparison
    const normalizedInitials = initials.trim().toUpperCase();

    // Check if this exact initials already exists for a different user
    for (const [userInitials, userData] of project.users.entries()) {
        if (userInitials === normalizedInitials) {
            // If it's the same user (excludeUserHash matches), no conflict
            if (excludeUserHash && userData.userHash === excludeUserHash) {
                return { conflict: false };
            }
            // MIGRATION: If existing entry has no userHash (old project), allow claim
            // This lets authenticated users claim unclaimed identities during migration
            if (!userData.userHash && excludeUserHash) {
                return { conflict: false };
            }
            // Different user with same initials - conflict
            return {
                conflict: true,
                existingName: userData.name,
                existingInitials: userInitials
            };
        }
    }

    return { conflict: false };
}

// Add user to project ACL
function addUserToProject(projectHash, userHash, name, initials) {
    const project = getProject(projectHash);
    if (!project) {
        return {
            success: false,
            error: 'Project not found'
        };
    }
    if (!project.users) {
        project.users = new Map();
    }

    const normalizedInitials = initials.trim().toUpperCase();

    // Check for conflicts
    const conflictCheck = checkIdentityConflict(projectHash, name, normalizedInitials, userHash);
    if (conflictCheck.conflict) {
        return {
            success: false,
            error: 'CONFLICT',
            message: `Initials "${normalizedInitials}" already used by ${conflictCheck.existingName}`
        };
    }

    // Add user to project
    project.users.set(normalizedInitials, {
        userHash,
        name: name.trim(),
        socketId: null // Will be set when user connects
    });

    markProjectDirty(projectHash);
    console.log(`Added user ${userHash} to project ${projectHash} as ${name} (${normalizedInitials})`);

    return { success: true };
}

// Get user's identity in a specific project
function getUserIdentityInProject(userHash, projectHash) {
    const project = getProject(projectHash);
    if (!project.users) return null;

    let migrated = false;

    // Find the user in the project
    for (const [initials, userData] of project.users.entries()) {
        // Match exact userHash
        if (userData.userHash === userHash) {
            return {
                name: userData.name,
                initials: initials
            };
        }
        // MIGRATION: If userHash is undefined (old project), try to claim based on user's identity
        else if (!userData.userHash) {
            const user = loadUserFromDisk(userHash);
            if (user) {
                // First try to match on project-specific identity
                const matchesProjectIdentity = user.identities && user.identities[projectHash] &&
                    user.identities[projectHash].initials === initials &&
                    user.identities[projectHash].name === userData.name;

                // If no project-specific identity, try matching on default identity
                const matchesDefaultIdentity = !user.identities[projectHash] &&
                    user.defaultInitials === initials &&
                    user.defaultName === userData.name;

                if (matchesProjectIdentity || matchesDefaultIdentity) {
                    // Claim this identity by adding userHash
                    userData.userHash = userHash;
                    migrated = true;
                    console.log(`Migrated user entry in project ${projectHash}: ${userData.name} (${initials}) now owned by ${userHash} (matched ${matchesProjectIdentity ? 'project' : 'default'} identity)`);

                    // Also add the identity to the user file if not already there
                    if (!user.identities[projectHash]) {
                        addProjectToUser(userHash, projectHash);
                        addIdentityToUser(userHash, projectHash, userData.name, initials);
                        console.log(`Added missing identity for project ${projectHash} to user ${userHash} during migration`);
                    }

                    if (migrated) {
                        markProjectDirty(projectHash);
                    }

                    return {
                        name: userData.name,
                        initials: initials
                    };
                }
            }
        }
    }

    return null;
}

// Get all identities a user has in a specific project
function getUserIdentitiesInProject(userHash, projectHash) {
    const project = getProject(projectHash);
    if (!project || !project.users) return [];

    const identities = [];
    let migrated = false;

    for (const [initials, userData] of project.users.entries()) {
        // Match exact userHash
        if (userData.userHash === userHash) {
            identities.push({
                name: userData.name,
                initials: initials
            });
        }
        // MIGRATION: If userHash is undefined (old project), try to claim based on user's identity
        else if (!userData.userHash) {
            const user = loadUserFromDisk(userHash);
            if (user) {
                // First try to match on project-specific identity
                const matchesProjectIdentity = user.identities && user.identities[projectHash] &&
                    user.identities[projectHash].initials === initials &&
                    user.identities[projectHash].name === userData.name;

                // If no project-specific identity, try matching on default identity
                const matchesDefaultIdentity = !user.identities[projectHash] &&
                    user.defaultInitials === initials &&
                    user.defaultName === userData.name;

                if (matchesProjectIdentity || matchesDefaultIdentity) {
                    // Claim this identity by adding userHash
                    userData.userHash = userHash;
                    migrated = true;
                    identities.push({
                        name: userData.name,
                        initials: initials
                    });
                    console.log(`Migrated user entry in project ${projectHash}: ${userData.name} (${initials}) now owned by ${userHash} (matched ${matchesProjectIdentity ? 'project' : 'default'} identity)`);

                    // Also add the identity to the user file if not already there
                    if (!user.identities[projectHash]) {
                        addProjectToUser(userHash, projectHash);
                        addIdentityToUser(userHash, projectHash, userData.name, initials);
                        console.log(`Added missing identity for project ${projectHash} to user ${userHash} during migration`);
                    }
                }
            }
        }
    }

    if (migrated) {
        markProjectDirty(projectHash);
    }

    return identities;
}

// Middleware
app.use(express.json()); // Parse JSON request bodies

// Serve static files with correct MIME types for ES6 modules
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.set('Content-Type', 'application/javascript');
        }
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
app.post('/api/user/register', (req, res) => {
    const { email, name, initials } = req.body;

    if (!email || !name || !initials) {
        return res.status(400).json({
            error: 'Missing required fields',
            required: ['email', 'name', 'initials']
        });
    }

    const result = createUser(email, name, initials);
    res.json(result);
});

// Get user profile
app.get('/api/user/:userHash', (req, res) => {
    const { userHash } = req.params;
    const userData = loadUserFromDisk(userHash);

    if (!userData) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json(userData);
});

// Get all available identities for a user
app.get('/api/user/:userHash/identities', (req, res) => {
    const { userHash } = req.params;
    const identities = getUserIdentities(userHash);

    if (identities.length === 0) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({ identities });
});

// Get user's projects
app.get('/api/user/:userHash/projects', (req, res) => {
    const { userHash } = req.params;
    const userData = loadUserFromDisk(userHash);

    if (!userData) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({ projects: userData.projects });
});

// Check if identity conflicts in a project
app.post('/api/project/:projectHash/check-identity', (req, res) => {
    const { projectHash } = req.params;
    const { name, initials, userHash } = req.body;

    if (!initials) {
        return res.status(400).json({ error: 'Missing initials' });
    }

    const result = checkIdentityConflict(projectHash, name, initials, userHash);
    res.json(result);
});

// Add user to project (join project)
app.post('/api/project/:projectHash/users', (req, res) => {
    const { projectHash } = req.params;
    const { userHash, name, initials } = req.body;

    if (!userHash || !name || !initials) {
        return res.status(400).json({
            error: 'Missing required fields',
            required: ['userHash', 'name', 'initials']
        });
    }

    const result = addUserToProject(projectHash, userHash, name, initials);

    if (result.success) {
        // Add project to user's project list
        addProjectToUser(userHash, projectHash);

        // Add identity to user profile
        addIdentityToUser(userHash, projectHash, name, initials);
    }

    res.json(result);
});

// Remove user from project (leave project)
app.post('/api/project/:projectHash/user/:userHash/leave', (req, res) => {
    const { projectHash, userHash } = req.params;

    const project = getProject(projectHash);
    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    // Remove user from project
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

    // Remove project from user's project list
    const userData = loadUserFromDisk(userHash);
    if (userData && userData.projects) {
        userData.projects = userData.projects.filter(pid => pid !== projectHash);
        saveUserToDisk(userHash, userData);
        console.log(`Removed project ${projectHash} from user ${userHash}'s project list`);
    }

    // Remove identity from user's identities
    if (userData && userData.identities && userData.identities[projectHash]) {
        delete userData.identities[projectHash];
        saveUserToDisk(userHash, userData);
        console.log(`Removed identity for project ${projectHash} from user ${userHash}`);
    }

    res.json({ success: true, message: 'Left project successfully' });
});

// Get user's identities in a specific project
app.get('/api/project/:projectHash/user/:userHash/identities', (req, res) => {
    const { projectHash, userHash } = req.params;
    const identities = getUserIdentitiesInProject(userHash, projectHash);

    res.json({ identities });
});

// Get all users in a project
app.get('/api/project/:projectHash/users', (req, res) => {
    const { projectHash } = req.params;
    const project = getProject(projectHash);

    if (!project.users) {
        return res.json({ users: [] });
    }

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
        // Read all project files from disk
        const projectFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));

        const projectsList = projectFiles.map(file => {
            const projectId = file.replace('.json', '');
            const project = getProject(projectId);

            // Skip if project couldn't be loaded
            if (!project) {
                return null;
            }

            // Count users - only count users with userHash (new auth system)
            // Old users from before the auth system don't have userHash
            let userCount = 0;
            if (project.users instanceof Map) {
                for (const [initials, userData] of project.users.entries()) {
                    if (userData.userHash) {
                        userCount++;
                    }
                }
            }

            return {
                id: projectId,
                name: project.projectName || 'Unnamed Project',
                userCount: userCount
            };
        }).filter(p => p !== null); // Remove null entries

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
        const files = fs.readdirSync(DATA_DIR);
        const projectList = [];

        files.forEach(file => {
            if (file.endsWith('.json')) {
                const projectId = file.replace('.json', '');
                const filePath = path.join(DATA_DIR, file);
                const data = fs.readFileSync(filePath, 'utf8');
                const project = JSON.parse(data);

                // Extract project name (handle both string and object formats)
                let projectName = 'Unnamed Project';
                if (typeof project.projectName === 'string') {
                    projectName = project.projectName;
                } else if (project.projectName && project.projectName.name) {
                    projectName = project.projectName.name;
                }

                projectList.push({
                    id: projectId,
                    name: projectName,
                    cardCount: project.cards ? project.cards.length : 0,
                    wormholeCount: project.wormholes ? project.wormholes.length : 0
                });
            }
        });

        res.json({ success: true, projects: projectList });
    } catch (err) {
        console.error('Error listing projects:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// WebSocket connection handling
io.on('connection', (socket) => {
    let projectId = socket.handshake.query.projectId;

    // If client connects with a project ID, send initial state
    if (projectId) {
        console.log('Client connected:', socket.id, 'Project:', projectId);

        // Join project room
        socket.join(projectId);

        // Send current state to newly connected client
        const project = getProject(projectId);
        if (!project) {
            console.log(`Project ${projectId} not found - not sending state:init`);
        } else {
            console.log(`Sending state to client. Wormholes in project: ${project.wormholes ? project.wormholes.length : 0}`);
            if (project.wormholes && project.wormholes.length > 0) {
                console.log('Wormholes:', project.wormholes);
            }
            socket.emit('state:init', project);
        }
    } else {
        console.log('Client connected without project ID:', socket.id);
    }

    // Handle client joining a different project (ALWAYS register this handler)
    socket.on('project:join', (data) => {
        const { projectId: newProjectId } = data;
        console.log(`Client ${socket.id} switching to project:`, newProjectId);

        // Leave all current rooms (except the socket's own room)
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
            }
        });

        // Join new project room
        socket.join(newProjectId);

        // Update the projectId for this socket
        projectId = newProjectId;

        // Get or create project
        let newProject = getProject(newProjectId);
        if (!newProject) {
            console.log(`Creating new project: ${newProjectId}`);
            newProject = createProject(newProjectId);
        }
        socket.emit('state:init', newProject);
    });

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
        console.log(`user:register received:`, {
            initials: data.initials,
            name: data.name,
            projectId: data.projectId,
            userHash: data.userHash,
            hasUserHash: !!data.userHash
        });

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
            socketId: socket.id,
            userHash: data.userHash  // Include userHash for proper identity tracking
        });

        markProjectDirty(data.projectId);

        console.log(`User registered: ${data.initials} (${data.name}) in project ${data.projectId}`);

        // If userHash provided, update user file with project and identity
        if (data.userHash) {
            addProjectToUser(data.userHash, data.projectId);
            addIdentityToUser(data.userHash, data.projectId, data.name, data.initials);
            console.log(`Added identity for project ${data.projectId} to user ${data.userHash}`);
        } else {
            console.warn(`No userHash provided in user:register for ${data.initials} - identity will not be saved`);
        }

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
        project.cards.push(cardData);
        markProjectDirty(projectId);
        io.to(projectId).emit('viewport:add', cardData);
    });

    // Handle viewport card update (edit)
    socket.on('viewport:update', (data) => {
        const project = getProject(projectId);
        if (!project) {
            console.error('viewport:update: project not found', { projectId });
            return;
        }
        const { id, header, body } = data;
        const card = project.cards.find(c => c.id === id);
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
        if (!project) return;
        const { id, x, y } = data;
        const card = project.cards.find(c => c.id === id);
        if (card) {
            // Check if we need to normalize z-index (prevent overflow)
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

    // Handle single card delete
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

    // Handle clear viewport (delete all cards and wormholes)
    socket.on('viewport:clear', () => {
        const project = getProject(projectId);
        project.cards = [];
        project.wormholes = [];
        markProjectDirty(projectId);
        io.to(projectId).emit('viewport:clear');
    });

    // Handle wormhole creation
    socket.on('wormhole:add', (wormholeData) => {
        const project = getProject(projectId);

        // Check if we need to normalize z-index (prevent overflow)
        if (project.maxZIndex > 5000) {
            normalizeZIndex(projectId);
            io.to(projectId).emit('state:sync', project);
        }

        // Server always assigns z-index (server is authoritative)
        project.maxZIndex++;
        wormholeData.zIndex = project.maxZIndex;

        console.log(`Wormhole added to project ${projectId}:`, wormholeData);
        console.log(`Total wormholes in project: ${project.wormholes.length + 1}`);
        project.wormholes.push(wormholeData);
        markProjectDirty(projectId);
        io.to(projectId).emit('wormhole:add', wormholeData);
    });

    // Handle wormhole movement
    socket.on('wormhole:move', (data) => {
        const project = getProject(projectId);
        const { id, x, y } = data;
        const wormhole = project.wormholes.find(w => w.id === id);
        if (wormhole) {
            // Check if we need to normalize z-index (prevent overflow)
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

    // Handle wormhole rename
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

    // Handle wormhole delete
    socket.on('wormhole:delete', (data) => {
        const project = getProject(projectId);
        const { id1, id2 } = data;

        // Remove both wormhole ends
        const initialCount = project.wormholes.length;
        project.wormholes = project.wormholes.filter(w => w.id !== id1 && w.id !== id2);
        const finalCount = project.wormholes.length;

        if (finalCount < initialCount) {
            markProjectDirty(projectId);
            io.to(projectId).emit('wormhole:delete', { id1, id2 });
            console.log(`Wormhole pair deleted from project ${projectId}:`, { id1, id2, removed: initialCount - finalCount });
        }
    });

    // Handle delete all cards
    socket.on('cards:delete-all', (data) => {
        const targetProjectId = data?.projectId || projectId;
        console.log(`[DELETE] Received delete request for project ${targetProjectId}`, data);
        const project = getProject(targetProjectId);
        const cardCount = project.cards.length;
        console.log(`[DELETE] Found ${cardCount} cards in project ${targetProjectId}, clearing...`);
        project.cards = [];
        console.log(`[DELETE] Cards array cleared, saving to disk synchronously...`);
        saveProjectToDisk(targetProjectId, true); // Synchronous save to block until complete
        console.log(`[DELETE] Disk save complete, broadcasting event to room`);
        io.to(targetProjectId).emit('cards:delete-all');
        console.log(`[DELETE] All cards deleted from project ${targetProjectId}`);
    });

    // Handle delete all palette cards
    socket.on('palette:delete-all', (data) => {
        const targetProjectId = data.projectId || projectId;
        const project = getProject(targetProjectId);
        project.paletteCards = [];
        saveProjectToDisk(targetProjectId, true); // Synchronous save to block until complete
        io.to(targetProjectId).emit('palette:delete-all');
        console.log(`All palette cards deleted from project ${targetProjectId}`);
    });

    // Handle clear palette (legacy - keeping for compatibility)
    socket.on('palette:clear', () => {
        const project = getProject(projectId);
        project.paletteCards = [];
        markProjectDirty(projectId);
        io.to(projectId).emit('palette:clear');
    });

    // Handle delete project
    socket.on('project:delete', (data) => {
        const { projectId: pidToDelete } = data;
        if (pidToDelete && projects.has(pidToDelete)) {
            projects.delete(pidToDelete);
            console.log(`Project ${pidToDelete} deleted`);
            io.to(pidToDelete).emit('project:deleted');
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        // Clear socketId for this user but keep them in the users list
        const project = getProject(projectId);
        if (!project || !project.users) {
            return;
        }
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

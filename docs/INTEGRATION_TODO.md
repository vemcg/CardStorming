# Authentication Integration TODO

## Current Status

✅ **COMPLETE:**
- Server-side user management (user profiles, project ACL)
- 9 API endpoints for user/project operations
- Auth.js module with cookie management
- DialogUtils.js with registration and identity selection dialogs
- HTML structure for dialogs
- CSS styling

🚧 **IN PROGRESS:**
- Integration with app.js

## Integration Steps Required

### 1. Import Modules in app.js

Add to imports section (around line 5):
```javascript
import { Auth } from './core/Auth.js';
import { showRegistrationDialog, showIdentityDialog, showReadOnlyBanner, hideReadOnlyBanner } from './utils/DialogUtils.js';
```

### 2. Create Global Auth Instance

Add to global state section (around line 17):
```javascript
const auth = new Auth();
window.auth = auth; // For debugging
```

### 3. Initialize Auth on Startup

In `DOMContentLoaded` handler (around line 1660), add BEFORE viewport initialization:
```javascript
// Initialize authentication
await auth.init();
debugLog.info('Auth initialized', {
    authenticated: auth.isAuthenticated(),
    userHash: auth.userHash
});
```

### 4. Update UI State Based on Auth

Create new function:
```javascript
function updateUIForAuthState() {
    const authenticated = auth.isAuthenticated();
    const hasProject = isProjectOpen;
    const hasWriteAccess = auth.hasWriteAccess();

    // Disable UI elements when not authenticated or in read-only mode
    const paletteSection = document.querySelector('.palette');
    const viewport = document.querySelector('.viewport');
    const toolbar = document.querySelector('.toolbar');

    // Show/hide read-only banner
    if (hasProject && !hasWriteAccess) {
        showReadOnlyBanner();
    } else {
        hideReadOnlyBanner();
    }

    // Disable palette cards in read-only mode
    const paletteCards = document.querySelectorAll('.palette-card');
    paletteCards.forEach(card => {
        card.draggable = hasWriteAccess;
        card.style.opacity = hasWriteAccess ? '1' : '0.5';
        card.style.cursor = hasWriteAccess ? 'grab' : 'not-allowed';
    });

    // Disable toolbar buttons in read-only mode
    const toolbarButtons = toolbar.querySelectorAll('button');
    toolbarButtons.forEach(btn => {
        if (!hasWriteAccess) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    });

    // Menu items
    const newMenuItem = document.getElementById('menu-new');
    const openMenuItem = document.getElementById('menu-open');

    if (!authenticated) {
        // No user - only New is enabled (will trigger registration)
        newMenuItem.style.opacity = '1';
        openMenuItem.style.opacity = '0.5';
        openMenuItem.style.pointerEvents = 'none';
    } else {
        // Authenticated - both enabled
        newMenuItem.style.opacity = '1';
        openMenuItem.style.opacity = '1';
        openMenuItem.style.pointerEvents = 'auto';
    }
}
```

### 5. Modify File > New Handler

Replace existing `menu-new` handler in `setupMenuHandlers()`:
```javascript
if (newMenuItem) {
    newMenuItem.addEventListener('click', async (e) => {
        e.preventDefault();

        try {
            // Check if user is authenticated
            if (!auth.isAuthenticated()) {
                // Show registration dialog
                const result = await showRegistrationDialog('To create a project, please register:');
                await auth.register(result.email, result.name, result.initials);
            }

            // Show identity selection
            const identities = await auth.getIdentities();
            const identity = await showIdentityDialog(
                identities,
                'Select Identity for New Project',
                'Choose which identity to use:',
                async (name, initials) => {
                    // Conflict checker - for new project, no conflicts possible
                    return { conflict: false };
                }
            );

            // Create project
            const projectId = generateProjectId();

            // Set current identity
            auth.setCurrentIdentity(identity.name, identity.initials);

            // Join project with this identity
            await auth.joinProject(projectId, identity.name, identity.initials);

            // Open project
            openProject(projectId);

        } catch (err) {
            if (err.message !== 'Registration cancelled' && err.message !== 'Identity selection cancelled') {
                console.error('Error creating project:', err);
                alert('Failed to create project: ' + err.message);
            }
        }
    });
}
```

### 6. Modify populateOpenSubmenu Function

Update to show two sections: user's projects + unclaimed projects:
```javascript
async function populateOpenSubmenu() {
    const submenu = document.querySelector('#menu-open + .submenu');
    if (!submenu) return;

    submenu.innerHTML = '<li class="submenu-loading">Loading...</li>';

    try {
        const knownProjects = getKnownProjects();
        let userProjects = [];
        let unclaimedProjects = [];

        if (auth.isAuthenticated()) {
            // Get user's projects from server
            userProjects = await auth.getProjects();
        }

        // Get list of all projects with user counts
        // We need a new API endpoint for this
        const response = await fetch('/api/projects/list');
        const { projects } = await response.json();

        // Separate into user's projects and unclaimed
        const userProjectSet = new Set(userProjects);

        projects.forEach(project => {
            if (userProjectSet.has(project.id)) {
                // Already in user's list
            } else if (project.userCount === 0) {
                // Unclaimed project
                unclaimedProjects.push(project);
            }
            // Projects with users that aren't this user are not shown
        });

        // Build submenu
        submenu.innerHTML = '';

        // Section 1: User's Projects
        if (userProjects.length > 0) {
            const userHeader = document.createElement('li');
            userHeader.className = 'submenu-header';
            userHeader.textContent = 'My Projects';
            submenu.appendChild(userHeader);

            userProjects.forEach(projectId => {
                const li = document.createElement('li');
                li.className = 'submenu-item';
                li.textContent = knownProjects[projectId] || 'Unnamed Project';
                li.addEventListener('click', async () => {
                    await openProjectWithIdentitySelection(projectId);
                });
                submenu.appendChild(li);
            });
        }

        // Section 2: Unclaimed Projects
        if (unclaimedProjects.length > 0) {
            const unclaimedHeader = document.createElement('li');
            unclaimedHeader.className = 'submenu-header';
            unclaimedHeader.textContent = 'Unclaimed Projects';
            submenu.appendChild(unclaimedHeader);

            unclaimedProjects.forEach(project => {
                const li = document.createElement('li');
                li.className = 'submenu-item';
                li.textContent = knownProjects[project.id] || 'Unnamed Project';
                li.addEventListener('click', async () => {
                    // Open unclaimed project (will open read-only, then prompt to join)
                    openProject(project.id);
                });
                submenu.appendChild(li);
            });
        }

        // No projects at all
        if (userProjects.length === 0 && unclaimedProjects.length === 0) {
            submenu.innerHTML = '<li class="submenu-item submenu-empty">No projects available</li>';
        }

    } catch (err) {
        console.error('Error populating projects:', err);
        submenu.innerHTML = '<li class="submenu-item submenu-error">Error loading projects</li>';
    }
}
```

**Note:** This requires a new server endpoint (see step 6a below).

### 6a. Add Server Endpoint for Project List

Add to server.js after the existing user API endpoints:
```javascript
// Get list of all projects with user counts
app.get('/api/projects/list', (req, res) => {
    // Read all project files from disk
    const projectFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));

    const projects = projectFiles.map(file => {
        const projectId = file.replace('.json', '');
        const project = getProject(projectId);

        // Count users
        const userCount = project.users ? project.users.size : 0;

        return {
            id: projectId,
            name: project.projectName || 'Unnamed Project',
            userCount: userCount
        };
    });

    res.json({ projects });
});
```

### 6b. Add CSS for Submenu Headers

Add to style.css:
```css
.submenu-header {
    padding: 8px 12px;
    font-weight: bold;
    font-size: 11px;
    color: #666;
    background-color: #f0f0f0;
    border-bottom: 1px solid #ddd;
    cursor: default;
    text-transform: uppercase;
}

.submenu-header:hover {
    background-color: #f0f0f0;
}
```

### 7. Create openProjectWithIdentitySelection Function

```javascript
async function openProjectWithIdentitySelection(projectId) {
    try {
        // Check if user has identities in this project
        const projectIdentities = await auth.getProjectIdentities(projectId);

        if (projectIdentities.length > 0) {
            // User is already a member - select identity
            const identity = await showIdentityDialog(
                projectIdentities.map(id => ({
                    name: id.name,
                    initials: id.initials,
                    isDefault: false
                })),
                'Select Identity',
                'You are a member of this project as:',
                async (name, initials) => {
                    // Check conflicts in this project
                    const result = await auth.checkIdentityConflict(projectId, name, initials);
                    if (result.conflict) {
                        return {
                            conflict: true,
                            message: `Initials "${initials}" already used by ${result.existingName}`
                        };
                    }
                    return { conflict: false };
                }
            );

            auth.setCurrentIdentity(identity.name, identity.initials);

            if (identity.isNew) {
                // Adding new identity to existing project membership
                await auth.joinProject(projectId, identity.name, identity.initials);
            }
        } else {
            // Not a member yet - should not happen if filtering worked
            alert('You do not have access to this project');
            return;
        }

        // Open project
        openProject(projectId);

    } catch (err) {
        if (err.message !== 'Identity selection cancelled') {
            console.error('Error opening project:', err);
            alert('Failed to open project: ' + err.message);
        }
    }
}
```

### 8. Modify openProject Function for Read-Only Mode

At the start of `openProject()` function, add:
```javascript
async function openProject(projectId) {
    debugLog.info('Opening project', { projectId });

    // Check authentication and handle project joining
    if (!auth.isAuthenticated()) {
        // User not authenticated - open in read-only mode
        auth.setReadOnly(true);
        debugLog.info('Opening project in read-only mode (not authenticated)');
    } else {
        // Check if user is member of this project
        const projectIdentities = await auth.getProjectIdentities(projectId);

        if (projectIdentities.length === 0) {
            // Not a member - read-only mode
            auth.setReadOnly(true);
            debugLog.info('Opening project in read-only mode (not a member)');
        } else {
            // Is a member
            auth.setReadOnly(false);
            // Current identity should already be set from openProjectWithIdentitySelection
            // or from URL open flow
        }
    }

    // ... rest of existing openProject code
}
```

At the END of `openProject()` function, add:
```javascript
    // Update UI based on auth state
    updateUIForAuthState();
}
```

### 9. Add Write Operation Detection

Create wrapper function to check write access before any modification:
```javascript
async function requireWriteAccess() {
    if (auth.hasWriteAccess()) {
        return true; // Already has access
    }

    // User needs to authenticate
    try {
        if (!auth.isAuthenticated()) {
            // Register first
            const result = await showRegistrationDialog('To edit this project, please register:');
            await auth.register(result.email, result.name, result.initials);
        }

        // Select identity
        const identities = await auth.getIdentities();
        const identity = await showIdentityDialog(
            identities,
            'Select Identity',
            'Choose which identity to use for this project:',
            async (name, initials) => {
                const result = await auth.checkIdentityConflict(currentProjectId, name, initials);
                if (result.conflict) {
                    return {
                        conflict: true,
                        message: `Initials "${initials}" already used by ${result.existingName}`
                    };
                }
                return { conflict: false };
            }
        );

        // Join project
        await auth.joinProject(currentProjectId, identity.name, identity.initials);
        auth.setCurrentIdentity(identity.name, identity.initials);

        // Update UI
        updateUIForAuthState();

        return true;
    } catch (err) {
        if (err.message !== 'Registration cancelled' && err.message !== 'Identity selection cancelled') {
            console.error('Error getting write access:', err);
        }
        return false;
    }
}
```

### 10. Wrap Write Operations

Add `requireWriteAccess()` check to:
- Palette card drag start
- Card edit operations
- Card creation
- Palette modification
- Wormhole creation

Example for palette drop:
```javascript
// In setupPaletteDropZone, at start of drop handler:
const hasAccess = await requireWriteAccess();
if (!hasAccess) {
    return; // User cancelled auth
}
```

### 11. Update Card Creation to Use Current Identity

In card creation code, replace `currentUserInitials` with:
```javascript
const identity = auth.getCurrentIdentity();
const authorInitials = identity ? identity.initials : '';
```

## Testing Checklist

- [ ] New user visits site - UI disabled except File > New
- [ ] Click File > New - registration dialog appears
- [ ] After registration - identity selection appears
- [ ] Project creates successfully
- [ ] File > Open shows only user's projects
- [ ] Open existing project - identity selection if multiple identities
- [ ] Click project link (no cookie) - opens read-only
- [ ] Try to drag card in read-only - triggers registration
- [ ] After auth - gains write access
- [ ] Logout and rejoin - works correctly
- [ ] Multiple identities in same project - works
- [ ] Conflict detection - prevents duplicate initials
